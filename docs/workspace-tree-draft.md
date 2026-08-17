# workspace-tree 实施草案(分阶段)

> 依据:[workspace-tree-design.md](workspace-tree-design.md)。目标状态:workspace 通道成为 dsh-bundle 安装的默认路径,profile 通道降级为兼容/遗留。

## Phase 1(已完成 ✅)运行时 + 通道接线

**交付物**:

- `src/workspaceTree.ts`:`WorkspaceTreeRuntime`(mount/unmount/setDisabled/reconcile)、`workspaceBundleInstallSteps`(carrier 安装步)、`disablePatchesFor`、`resolveBareRows` 兜底、`prepareWorkspaceComposition`(空根重写)。
- `src/types.ts`:`LedgerEntry.channel/disabled`、`InstallRequest.channel`、`PackageManagerRuntime.channel`、`InstallResult.channel`。
- `src/bundlePatch.ts`:`BundlePatchDocument.raw`(原样补丁列表)。
- `src/manager.ts`:install 按 channel 分支(workspace 步 vs builtin 步)、mount 的 runtime channel 匹配、uninstall/disable/enable 的 workspace 分支(ledger disabled 标记,不写 profile 文件)。
- `src/ledger.ts`:`isEntryEffective` 对 workspace 条目直接有效。
- `src/index.ts`:`Config.runtime`(auto/workspace-tree/legacy)+ `createRuntime` + boot reconcile。
- `package.json`:声明 `@deepseek-ai/cordis-plugin-include`(dev + optional peer)。
- 测试:`tests/workspaceTree.spec.ts`(6)+ `tests/workspaceChannel.spec.ts`(2)。

**验证**:`pnpm run check` 全绿,66/66 测试,typecheck + build 通过。

**关键调试结论**(写进代码注释,防再犯):

1. include 条目 id 不能用冒号(`loader.resolve` 用 `:` 做嵌套分隔,`pm:ws:...` 会被当成嵌套路径)。
2. 每次应用补丁必须 `structuredClone`(include 按引用推入 insert 行,id 定向 patch 原地改写 → 不克隆就把 disable 烤进缓存)。
3. vitest/无钩子环境 `loader.internal === undefined`,裸包名必须走 `resolveBareRows` 兜底。

## Phase 2:安装管线迁移

- `SpecEntry.channel` + deps.yaml 语法(`channel: workspace`),`SpecFingerprint` 纳入 channel;restore/switch 批路径按 channel 分流(`installFastBundleBatch` 的 workspace 变体)。
- workspace 通道支持 npm 源:carrier package.json 声明 `dependencies: { <pkg>: <version> }` 后 `pnpm add`,让 .venv/node_modules 可解析。
- custom adapter 的 workspace 形态:env-only 步集(无 profile.dependency.add),verify 检查 .venv/node_modules 解析。
- `doctor()` 扩展:检查 workspace 条目(组合根缺失、carrier 失效),heal 时从 ledger 重建而不是改 profile。
- 迁移工具:`dpm migrate --channel workspace`,把 profile 通道条目转 workspace(反向逆操作保留)。

## Phase 3:默认翻转与 UI

- `Config.runtime` 默认改 `workspace-tree`;新安装默认 channel workspace(设置页加通道选择)。
- Web 设置页:条目卡片显示通道;workspace 条目展示「已通过子上下文加载」状态;disable/enable 走新语义(不再依赖重启提示)。
- AI 派发 prompt/AGENTS 更新:工作区安装的约束(可物化源、已构建产物、carrier 布局)。
- client 面验证:workspace 行的 `internal/plugin` 事件是否被宿主 registry 增量出图(预期是,需要真机确认)。

## Phase 4:真机集成验证

- 在真实 profile(web)里安装 pm 插件,用 workspace 通道装一个真实 bundle(git 源),验证:热挂载、disable/enable、重启后 reconcile、`--dump-config` 视角、client 面刷新。
- 与宿主 `watchUserPatches` 并发编辑 profile cordis.patch.yml,确认互不干扰。
- 双 profile(web + tui)各挂不同工作区,验证条目隔离与全局唯一 id。
- 卸载/回滚路径的 Windows 真机验证(EPERM、junction)。

## 验收清单(全部 Phase 完成后)

- [ ] workspace 通道安装零 profile 修改(依赖 + bundles 都不变)。
- [ ] 重启后 pm 自动重建全部 workspace 子树,插件行为与热挂载一致。
- [ ] disable/enable 不写任何 profile 文件,重启后状态保持。
- [ ] restore/switch/doctor 对 workspace 条目正确收敛。
- [ ] profile 通道回归:现有 66 测试 + 双通道混合安装不双重组合。
- [ ] `dsh plugin remove` 对 workspace 条目无副作用(它不认识这些条目,必须 no-op)。

