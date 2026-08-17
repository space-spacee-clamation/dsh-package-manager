# dsh-package-manager 重构交接文档

> 用途：新会话接手。目标、约束、已完成改动、当前错误、下一步都在这里。

## 1. 背景与目标

- 项目：`D:\DSHarness\dsh-package-manager`
- 宿主参考实现：`D:\DSHarness\codemaker2deepseek-harness\vendor\deepseek-harness`
- 原始问题：包管理器插件的热重载又复杂又慢，且没有完全按
  `vendor/deepseek-harness/docs/architecture.zh.md` 与 Cordis/Loader 的核心机制实现。

### 目标架构（已经按这个方向改）

1. dsh-bundle 安装走**单次 profile 依赖安装**，不再复制源码到 `.venv` 跑第二次 pnpm。
2. 热挂载的单位是 **`dsh.bundle.patch` 里的 loader 条目**，不是把 bundle 包本身当插件 import。
3. 热挂载/卸载/禁用优先走 **root Include 的按 id 增量 diff**，以保留
   `bundle 层 -> profile 用户层 -> home 用户层 -> launcher overlay` 的分层语义。
4. `disable/enable` 使用 Cordis 原生 `disabled` + 在 profile `cordis.patch.yml`
   写 `{ id, disabled: true }`，不卸载重装。
5. restore / workspace switch 对同一 profile 的 dsh-bundle 依赖做 **pnpm/dsh 批处理**。
6. 所有进程调用尽量异步，避免 `spawnSync` 阻塞 DSH 事件循环。

## 2. 硬约束

- **不允许修改宿主 deepseek-harness 源码**。只能通过插件运行时 API 注入。
- 别人电脑上的 DSH 是原版，包管理器必须独立工作。
- 当前环境中 AI 无法直接跑 shell（bash 工具报 win32 unsupported），所以类型检查/
  测试由用户在本机执行并把输出贴回来。

## 3. 关键新文件（dsh-package-manager/src）

| 文件 | 作用 |
|---|---|
| `adapters/builtinBundle.ts` | dsh-bundle 快路径 adapter：装前校验（`validateBundleSource`）、`clientFaceOf`、一次 profile 依赖 + bundle reconcile |
| `bundlePatch.ts` | 解析 `dsh.bundle.patch`，支持 `!!js`（`{ __jsExpr }` 与宿主 vendor/include 一致）；提供 `parsePatchObjects` |
| `cordisRuntime.ts` | 热挂载 runtime：有 root Include 时经注入 composer 重组 profile，否则直接挂 patch 条目；disable/enable/unmount |
| `injectedProfileComposer.ts` | 插件自注入的 composer：**优先委托 `@deepseek-ai/dsh-app-boot` 的 `loadProfile`/`loadOptionalPatches` 计算层**，保留 launcher overlay，经 root Include entry 的 `config.patches` 更新重组；宿主包不可用时走自建解析（CLI/测试） |
| `hostAsync.ts` | 异步 LocalHost/HarnessHost（`ctx.subprocess` 优先，本地回退） |
| `process.ts` | 异步 spawn 辅助，带超时/输出上限；`quoteShellArg` 消除 DEP0190 |
| `profilePatch.ts` | 对 profile `cordis.patch.yml` 做 comment-preserving 的 disable 块增删（`{ id, disabled: true }` 是宿主原生语义） |

旧文件 `runtime.ts`、`adapters/builtin-bundle.ts`、`host.ts` 已删除。
入口使用 `cordisRuntime.ts` 和 `hostAsync.ts`。

## 4. 已修改核心逻辑

### `manager.ts`（大改）
- dsh-bundle install：`builtinInstallSteps` 只做
  `allowBuild.add? -> profile.dependency.add -> profile.bundles.reconcile`。
- 热 mount 在 profile 依赖安装并 reconcile 后调用 `runtime.mount(entry)`。
- `uninstall`：
  - `runtime.composesProfile === true` 时先回滚文件/deps，再 `runtime.unmount`
    （触发 profile recompose）；
  - 其他 runtime 保持先 unmount 再回滚。
- `disable/enable`：
  - composer 路径先写/删 `cordis.patch.yml` 的 disable 块，再 recompose；
  - 非 composer 路径用 `entry.update({disabled})`；
  - 无 runtime 时保留旧卸载式 disable 行为。
- 批处理：
  - `reconcilePlanBatched()`：restore/switch 的实际执行路径（dryRun 仍走旧循环）。
  - `uninstallFastBundleBatch()`：同 profile 一次 remove + `pruneBundles` + allowBuild 恢复。
  - `installFastBundleBatch()`：同 profile 一次 add + reconcile；ledger 仍按 entry 记录 inverse。
- `profileSpecFor()`：本地目录默认转成 `file:<absolute>`，显式 `link:` 保持 link。

### `steps.ts`
- 新增公开方法 `runProfileDependencies(action, specs, ctx)`。

### `profile.ts`
- 新增 `pruneBundles(dir, removedPackageNames)`，供 pnpm fallback 卸载后清 bundle 行。

### `spec.ts` / `types.ts`
- fingerprint 加入 `allowBuild`。
- `PackageManagerRuntime` 增加可选 `composesProfile` 和 `setDisabled()`。

### `runtime.spec.ts`
- 改为 import `../src/cordisRuntime.ts`。
- 新增 patch-row 热挂载测试。

## 5. 注入式 profileComposer 原理（无宿主源码修改）

宿主没有 profileComposer 服务；`CordisRuntime` 构造时：

1. `ctx.loader` 存在则 `new InjectedProfileComposer(ctx, home)`。
2. 只有能通过 `loader.entries()` 找到 `options.id === 'include'` 的 root Include entry
   （宿主固定 id），才启用 composer；否则回退直接挂 patch 条目（CLI/测试）。

`InjectedProfileComposer`：

- 在**服务构造时**（尚未安装新插件）计算：
  - 当前 profile 的 bundle patch 数量；
  - profile `cordis.patch.yml` patch 数量；
  - home `cordis.patch.yml` patch 数量；
  - 从 boot Include 的 `config.patches` 切出已知数量之后的 suffix，作为
    **launcher overlay** 保存（宿主不暴露 overlay 列表，计数切片是唯一带内机制）。
- `recompose()`：
  - 动态解析 `@deepseek-ai/dsh-app-boot`；可用时用宿主的
    `loadProfile`（bundle 层，安装锚点=app-boot 自身 package.json）+
    `loadOptionalPatches`（profile/home 用户层）计算；
  - 不可用时走自建 `parsePatchObjects` 解析（CLI/测试）；
  - 拼接 `bundle + profile user + home user + overlay`；
  - `includeEntry.update({ config: { ...config, patches } })` 让 Loader 增量 diff
    （与宿主 `watchUserPatches` 同通道）。

## 6. 当前状态

用户本机跑过，且本会话已在本机复跑全部通过：

- `pnpm run check`（typecheck + test + build）✅，52/52 测试

本会话修复（两轮）：

**第一轮（parse/类型/测试）**

1. `src/manager.ts` `writeDepsEntry` 之后的 `patchRowsFor` 区域残留两段重复/
   半注释的旧代码（`/*` 提前闭合、`/**` 未闭合），导致 20 个 parse 错误。
   已删成唯一一份干净实现。
2. `src/cordisRuntime.ts:124` `owned.push({ rowId, entryId })` 在
   `exactOptionalPropertyTypes` 下 `rowId: string | undefined` 不能赋给
   `rowId?: string`。改为条件展开。
3. `src/manager.ts` `reconcilePlanBatched` 末尾残留 `if (false) for` 死代码块，
   已删除。
4. `disable()` 无 runtime 兜底路径：`uninstall` 会清掉刚写入的 disabled 记录。
   已在 uninstall 成功后重新 `upsertDisabledEntry`。

**第二轮（对照 cookbook 收敛回宿主，见 §10）**

5. allowBuild 指纹参与 change detection；装前校验（workspace: 依赖、ESM、
   patch 可解析、入口产物存在）；批路径事务化（patch 解析前置 + 失败补偿）。
6. client 面：`webRefreshNeeded` 标记 + 产物缺失告警 + UI 横幅/路由/文案；
   宿主 client-modules registry 自动扫 Loader 事件，我们只提示刷新标签。
7. ledger 与 profile manifest 收敛：`loadEffectiveLedger` + stale uninstall。
8. `InjectedProfileComposer` 改为委托宿主 `@deepseek-ai/dsh-app-boot` 的
   `loadProfile`/`loadOptionalPatches`（动态解析，不可用才自建）；
   `cordisRuntime` 删除永不命中的 `ctx.get('profileComposer')` 探测。
9. DEP0190 全消：win32 shell 模式统一 quote-join（process/steps/source 三处）。
10. `profile.dependency.add` 记录 pnpm 落盘的 `resolvedSpec`。
11. AI 派发 prompt/AGENTS 文件补宿主包规范约束。
12. 删除遗留旧文件 `runtime.ts`、`host.ts`、`adapters/builtin-bundle.ts`；
    `tests/host.spec.ts` 切到 `hostAsync.ts`。

**第三轮（宿主调研报告的收尾）**

13. bundles 对账逆操作不再 clobber（宿主调研 §2 的明确警告）：
    `profile.bundles.reconcile` 的逆操作从"恢复整个列表快照（set(before)）"
    改为"只移除本次实际添加的那一行（bundles.remove），否则 noop"。
    宿主路径下宿主已对账 → 逆操作 noop，绝不改写 bundles 列表；卸载不再
    覆盖安装后宿主/用户新增的其它 bundle 行。批路径同样按对账结果逐项记录。
    回归测试：`uninstall removes only its own bundle row, keeping rows added later`
    + steps 两个新测试。
14. 并发防护（宿主调研 §7）：install/uninstall/restore/sync/syncConfigured/
    disable/enable/switchWorkspace 全部串行化（`enqueue` 互斥链）；内部交叉调用
    走 `*Inner` 方法避免死锁。宿主跑 pnpm 没有文件锁，管理器自身必须防并发。

**第四轮（dsh-ads 悬空软链把 profile 卡死在 boot 的事故）**

现象：custom adapter 用 `link:` 把工作区 `.venv` 挂成 profile 依赖并写进
`dsh.profile.bundles`；`.venv` 被清理后留下悬空软链 + 无依赖的 bundle 行，
宿主 boot 时 `resolveBundleDir` fail-loud，整个 profile 起不来（后端打不开）。

修复（全部落在包管理器侧 + 文档，宿主不动）：

15. `profile.bundles.reconcile` 未声明 packageName 时，逆操作 = 新增的
    `profile.bundles.removeMany`（移除本次添加的全部行），卸载/回滚能清干净
    自己写进去的 bundle 行。
16. `profile.dependency.remove` 与批卸载后自动清扫悬空的 node_modules 软链
    （`removeDanglingLink`，lstat 判符号链接 + 目标不存在才删）。
17. 新增 `doctor()`（manager/service/CLI `dpm doctor`/Web `POST /doctor`）：
    healProfiles 移除"依赖已消失且无法解析"的 bundle 行（模板行与
    `$DSH_HOME/profiles/node_modules` farm 可解析的行保留）+ 清悬空链 +
    物理丢弃 ledger 里的 stale 记录；workspace 切换前自动执行。
18. 文档：adapter 规范明确"profile 依赖用 file: 不用 link:"（boot 解析
    fail-loud 的语义 + 悬空风险）、`removeMany` 词条、`dpm doctor` 修复命令。
    样本工作区 dsh-p-manager-sample 三个 adapter 已从 link: 改为 file:。

事故复盘要点：宿主对 bundles 行 fail-loud 是正确行为；问题在我们用
link: + bundles reconcile 制造了"已装但坏"的持久态。修复方向仍是收敛：
不制造悬空指针（file:）、卸载清干净（removeMany + 链清扫）、坏了有工具修
（doctor，boot 前可跑）。

**第五轮（Windows `ERR_PNPM_EPERM`：file: 安装的三种毒源）**

现象：把 `link:` 改成 `file:` 指向 `.venv` 后，`pnpm add file:<.venv>`
在 Windows 报 `ERR_PNPM_EPERM: symlink ... operation not permitted`。
逐层排查出三个叠加原因：

1. `.venv` 内部 node_modules 有 pnpm 依赖链接，`file:` 复制整树时
   pnpm 要重建这些符号链接 → EPERM。
2. 修复 1 用了 staging 拷贝（file.copy 排除 node_modules），仍然 EPERM：
   stage 里带着 `.venv` 的 `pnpm-lock.yaml`/`pnpm-workspace.yaml`，pnpm 处理
   `file:` 依赖时会读依赖自身的锁文件，把 peer 解析到 `.venv` 内部路径。
3. profile 自己的 `pnpm-lock.yaml` 被历史 link: 安装污染（记录了解析到
   `.venv` 内部的路径），`pnpm install` 对账不修，新 add 继续走毒路径。

修复：

19. `file.copy` 新增可选 `exclude: string[]`（默认仍只排除
    `.git`/`node_modules`）；staging 模式必须
    `exclude: [pnpm-lock.yaml, pnpm-workspace.yaml]`。
20. `doctor()` 改为 async，并新增 **profile pnpm 树对账**
    （`executor.reconcileProfile` → 每个有 lockfile/node_modules 的 profile
    跑 `pnpm install`），workspace 切换前自动执行。
21. 文档更新：adapter-spec 的 staging 模式补全 exclude 写法与三个毒源解释；
    样本三个 adapter 已带 exclude。
22. 现场修复（用户机器）：卸载旧 dsh-ads（回滚干净）→ 重置 web/tui profile 的
    lockfile + node_modules（保留 allowBuilds）→ `pnpm install` 重建 →
    重跑 switch。**最终 switch 全绿**：keep ×3 + install dsh-tui，四个插件
    全部以 stage 模式的 `file:` 依赖落盘（profile 持有 pnpm store 里的真实
    拷贝，不再有悬空指针/毒链接），restart-needed 标记已置位。

经验：`file:` 依赖的 staging 拷贝只应含包自身产物（package.json、lib/、
cordis.patch.yml 等），任何 pnpm 元数据（lockfile/workspace yaml）都必须排除。

宿主仓库 `vendor/deepseek-harness` 的 `apps/cli/src/profile-boot.ts` 已
checkout 回原版，嵌套仓库工作区干净。

注意：本机跑 vitest 需要较宽沙箱权限（Vite 配置加载会 `exec('net use')`
捕获子进程输出，workspace-write 模式禁止命名管道会 EPERM）。

## 7. 下一步操作

```bat
cd /d D:\DSHarness\dsh-package-manager
pnpm run typecheck
pnpm run test
pnpm run build
```

如果有错，优先看：

1. `src/manager.ts` 后半段（writeDepsEntry / patchRowsFor 附近）是否还有重复代码；
2. `src/steps.ts` 文件开头的旧注释块是否完整；
3. 批处理新方法里是否有严格类型问题（exactOptionalPropertyTypes 已开启）。

## 8. 宿主源码清理（已完成）

上一轮曾尝试改宿主源码，后来已禁用但留下空行/注释块。**已恢复原文件**：

```bat
cd /d D:\DSHarness\codemaker2deepseek-harness
git checkout -- vendor/deepseek-harness/apps/cli/src/profile-boot.ts
```

`vendor/deepseek-harness` 是带自己 `.git` 的嵌套仓库（不是 submodule），
status 已验证干净。

## 9. 已知取舍 / 风险

- `installFastBundleBatch` 对多个包同时 add 时，若 probe 阶段拿不到 packageName，
  用 `addedDependency()` 只取第一个 diff 兜底；重复同名/别名场景可能分配错 packageName。
- `InjectedProfileComposer` 假设 boot include 的 patch 列表尾部就是 overlay；
  该假设基于 app-boot 的 flatten 顺序，正常成立。宿主不暴露 overlay 列表，
  计数切片是唯一带内机制；boot 后、插件构造前的并发编辑窗口极小。
- 没有 composer/loader 时（CLI、测试）走直接挂 patch 条目，无法完整复现用户 patch 分层；
  这是无宿主合作的降级路径，可接受。

## 10. 对照 `docs/cookbook/adding-a-package.zh.md` 的审计与修复（已完成一轮）

结论方向：**收敛回宿主，不另搞一套**。宿主机制核查（三个只读研究子代理 + 本机验证）：

- 宿主没有 `profileComposer` 服务（全局零匹配）；组合实现是
  `@deepseek-ai/dsh-app-boot` 的纯函数面（`loadProfile` / `loadOptionalPatches` /
  `composeEntries` / `resolveBundleDir`）+ root Include（固定 id `'include'`）的
  `entry.update({ config: { ...config, patches } })` 通道（与 `watchUserPatches` 同机制）。
- 宿主的 `dsh plugin add/remove` = init + pnpm 逐字转发 + 按已装状态对账
  `dsh.profile.bundles`；无 ledger、无回滚；profile package.json 变更不热重载
  （新装 bundle 必须重启，或像我们一样自建 patch 行热挂载）。
- 宿主热监听 profile/home 两级 `cordis.patch.yml`（chokidar + cordis-hmr），
  我们写 disable 块是宿主原生语义（`{ id, disabled: true }` 与 `!!js` disabled 都是）。
- client 面：`ctx.clientModules` 服务增量扫描 Loader `internal/plugin` 事件，
  `dsh.client` + `./client` 导出（默认 `lib/client.js`）经 `/plugins/<id>/client.js`
  提供，图变化即时生效——只需刷新网页标签，无需重启 host。
- `!!js` 解析产物 `{ __jsExpr }` 与宿主 `vendor/include` 的 tag 一致（零漂移）。
- 宿主 bundle 的内部依赖全是 `workspace:^`，只对 monorepo 可解析；用户机器
  预期消费 registry 发布版或自包含构建。
- profile 的 pnpm-workspace.yaml（`packages: ['.']` / hoisted / autoInstallPeers: false）
  与我们的回退路径完全一致（不需要改）。

### 已修复

1. **allowBuild 指纹被忽略**（`spec.ts`）：`sameFingerprint` 补上 allowBuild，
   requirements 改动 allowBuild 现在触发 update。
2. **client 面缺失**：新增 `clientFaceOf`（`builtinBundle.ts`）检测 `dsh.client`
   与产物缺失；manager 增加 `webRefreshNeeded` 标记 + `noteClientFace`（装/卸/启停
   成功后记录"刷新网页标签"提示 + 未构建产物告警）；web 路由 `/web-refresh/clear`、
   服务方法、UI 横幅与中英文案齐全。**不碰宿主 client 机制**——宿主 registry
   自己扫 Loader 事件，我们只负责提示。
3. **probe 不校验**：新增 `validateBundleSource`（装前、任何 profile 修改之前）：
   非 ESM type、`workspace:` 依赖、patch 文件缺失/非法、已声明但缺失的入口产物
   （未构建的 lib/）全部拒装并给出明确原因。
4. **批路径非事务**：批安装把 patch 解析前置到写 ledger 之前，失败时补偿
   `runProfileDependencies('remove')` + `pruneBundles`，不再产生"已装但坏"卡死态。
5. **ledger 与 profile manifest 漂移**：新增 `loadEffectiveLedger` /
   `isEntryEffective`（`ledger.ts`，只读过滤，不动磁盘）；state/restore/switch/
   install/uninstall/disable/enable 的读取点全部切换；uninstall 对 stale 条目
   只清理 ledger 记录并成功返回。
6. **npm 版本不可复现**：`profile.dependency.add` 步骤参数记录 pnpm 实际落盘的
   `resolvedSpec`（单装与批装两条路径都记）。
7. **DEP0190**：`process.ts` 与 `steps.ts` 在 win32 shell 模式下把 args 并入
   命令串（新增 `quoteShellArg`），不再以 args+shell:true 组合 spawn。
8. **自建组合逻辑对齐宿主**：`InjectedProfileComposer` 重写——动态解析
   `@deepseek-ai/dsh-app-boot`，可用时用宿主的 `loadProfile`/`loadOptionalPatches`
   计算 bundle→profile→home 层（安装锚点取 app-boot 自己的 package.json）；
   不可用（CLI/测试）才走自建解析。`cordisRuntime` 删除永不命中的
   `ctx.get('profileComposer')` 探测。
9. **AI 派发提示**：`ai.ts` 的 prompt 与 AGENTS 文件补上宿主包规范约束
   （ESM、已构建产物、无 workspace:、dsh.client + lib/client.js）。
10. **bundles 逆操作 clobber（宿主调研 §2 警告）**：reconcile 逆操作改为
    "只移除本次实际添加的行，否则 noop"（单装与批装两条路径），宿主路径下
    绝不改写 bundles 列表，卸载不覆盖后来新增的行。
11. **并发防护（宿主调研 §7）**：所有改动 profile/ledger 的公开方法经
    `enqueue` 互斥链串行化，内部交叉调用走 `*Inner`。
12. **custom 条目的 stale 检测（真实切换 dsh-p-manager-sample 暴露）**：
    `isEntryEffective` 原本只查 dsh-bundle 条目，custom 条目一律有效。
    实测发现 ledger 里有 `dsh-ads`，但 web profile 早已没有
    `@dsh-external/dsh-ads` 依赖（被宿主/用户移除），switch 却报 keep。
    修复：custom 条目按其记录的 `profile.dependency.add` 步骤的 packageName
    检查 profile manifest；没有任何依赖步骤的 custom 条目（如只拷
    `.agent-presets` 文件的 anchored-standard）保持有效——它们的已装真相
    在 profile 之外。测试 +2（spec.spec.ts `isEntryEffective` 两组）。
    修复后重新切换会正确给出 `install dsh-ads`（自愈补装）。

### 保留 / 已记录（不是问题）

- 一个 entry = 一个包：批安装已把同 profile 的多个包合成一次 pnpm add，与宿主
  `dsh plugin add a b c` 一致；capability seam 的多包组合用多个 entry 表达，
  不新增 group 概念（宿主也没有）。
- npm 源默认判 dsh-bundle：对 `private: true` 包 registry 404 的报错是 pnpm
  原始输出，可接受。
- 自建 ledger / workspace-history 文件只存元数据与 UI 历史，不参与宿主状态；
  installed-truth 已改为 profile manifest（见 #5）。
- overlay 保留仍靠"计数切片"（宿主不暴露 overlay 列表）；boot 后、插件构造前
  的并发编辑窗口极小，记录为残余风险。
- 自己的 package.json 与 monorepo 规范差异（types 路径、files 含 src）：外部
  插件豁免；入 monorepo 前再改。

### 宿主 client 调研（第三份报告）的补充记录

- **同包名负缓存**：宿主 ClientModuleRegistry 对每个包名"是否声明 dsh.client"
  的判定永久缓存（重启才失效）。同名重装改变 client 面时需要重启 host，
  我们无法从外部探测该缓存；已记入 `docs/adapter-spec.md`。
- **热路径等价性**：我们热挂载用 `loader.create` 直接建行（internal/plugin
  事件 → clientModules 增量出图），与宿主"往用户层 cordis.patch.yml 追加
  insert 行"的热路径等价，且**不污染用户层文件**（bundle 包若再写 insert 行
  会在下次启动双重组合）。仅 client 面的普通插件用 custom adapter +
  `file.write` 写用户层 insert（模式已写进 `docs/adapter-spec.md`）。
- **dsh.client.platform**：宿主 registry 只接受 `'web'`；`clientFaceOf` 已同步
  校验，非 web 平台告警且不触发"刷新网页"提示。
- **可选集成（暂不做，记录理由）**：`ctx.settings.register` 存配置、
  `ctx.pluginInventory.list()` 展示 fiber 状态。前者：宿主调研 §5 明确认可
  "外部插件自己的记账放自己目录"（subagent 1 报告），且独立 CLI 需要无宿主
  存储；后者：宿主 Web 已有 plugin-inventory 设置 tab，我们的"已安装"列表
  是补充视图（source/adapter/workspace 元数据宿主没有），重复展示价值有限。
- **dev 构建**：`pnpm run dev:web` 只覆盖仓库内 packages；外部插件包的
  client 产物构建要由包管理器/AI 自己执行（已通过产物缺失告警提示）。

## 11. 第六轮：workspace-tree 子上下文运行时（设计 + Phase 1 实现）

> 设计文档 `docs/workspace-tree-design.md`，实施草案 `docs/workspace-tree-draft.md`。
> 目标：工作区 = Cordis Include 子树（自持 baseUrl 的子上下文），替代
> profile-manifest 通道的拆转包链路；消灭 overlay 计数切片、双写竞态、profile 文件手术。

### 动机（与用户讨论定稿）

- 用户在 registry 前拦截、装进子上下文的设想：**拦截点不在 registry**（
  vendored Cordis 的 RegistryService 无任何 hook，`ctx.plugin()` 直接 new
  Fiber），而在 loader 条目分流层——我们创建哪个 include 条目。
- 「子上下文」分两层：加载层（Include 子树，本实现）与服务可见性层
  （`ctx.isolate`/entry isolate 选项，默认不用——DSH 插件要注册进根服务）。

### 已实现（Phase 1）

- `src/workspaceTree.ts`：`WorkspaceTreeRuntime`（mount/unmount/setDisabled/
  reconcile）+ `workspaceBundleInstallSteps`（carrier 安装步：file.copy 源码到
  .venv/pkg → file.write carrier package.json（dependencies: pkg: file:./pkg）
  → pnpm install，零 profile 修改）+ `disablePatchesFor` + `resolveBareRows` 兜底
  + `prepareWorkspaceComposition`（.venv/cordis.yml 空根重写，镜像 prepareProfile）。
- `src/types.ts`：`LedgerEntry.channel/disabled`、`InstallRequest.channel`、
  `PackageManagerRuntime.channel`、`InstallResult.channel`。
- `src/bundlePatch.ts`：`BundlePatchDocument.raw`（原样补丁列表，供 include 直接应用）。
- `src/manager.ts`：install 按 channel 分支（workspace 走 workspaceBundleInstallSteps
  并跳过 profile 步骤）；mount 校验 runtime.channel；uninstall/disable/enable 的
  workspace 分支（ledger disabled 标记持久化，不写 profile 文件、不建 DisabledEntry）。
- `src/ledger.ts`：`isEntryEffective` 对 workspace 条目恒真（真相在 .venv）。
- `src/index.ts`：`Config.runtime`（auto/workspace-tree/legacy）+ createRuntime
  （auto 在 ledger 有 workspace 条目时自动升级）+ boot reconcile（服务构造后
  从 ledger 重建全部 workspace 子树，先于 auto-sync）。
- package.json：新增 `@deepseek-ai/cordis-plugin-include` dev + optional peer。
- 测试：`tests/workspaceTree.spec.ts`（6）+ `tests/workspaceChannel.spec.ts`（2）。

### 验证

`pnpm run check` 全绿：typecheck + 66/66 测试 + build。新增 8 测试覆盖：
挂载/幂等挂载/卸载、disable/enable（补丁行语义）、模拟重启 reconcile、
disable 状态跨重启保持、manager 级 workspace 通道安装（profile manifest 零修改
断言 + disable/enable/uninstall 全链路）。

### 本轮踩坑（代码注释已固化）

1. include 条目 id 不能用冒号：`loader.resolve` 把 `:` 当嵌套分隔，
   `pm:ws:web:ws-bundle` 被当嵌套路径解析失败 → 改 `pm-ws-<p>-<id>`。
2. 补丁对象必须每次 `structuredClone`：include 把 insert 行按引用推入树，
   id 定向 patch 原地改写行对象，不克隆会把 disabled 烤进缓存（宿主
   profile-boot 注释警告的 insert-aliasing，composeLive 也用 structuredClone）。
3. 无模块钩子环境（vitest）`loader.internal === undefined`，裸包名行解析
   失败 → `resolveBareRows` 兜底：把 insert 行 name 改写为 .venv 内
   require.resolve 的 file URL（与 legacy resolvePluginUrl 同款策略；真实
   dsh boot 有钩子，行保持原样由 include 从 .venv/node_modules 原生解析）。
4. pnpm install 在沙箱 workspace-write 下会静默死在链接阶段（子进程管道
   EPERM）；需要 danger-full-access。中途被杀还会留下内容残缺的 store 拷贝
   （如 typescript 缺 bin/），修复=删 node_modules 全量重装。

### 下一步（草案 Phase 2-4）

- Phase 2：deps.yaml `channel: workspace`、restore/switch 批路径分流、npm 源
  carrier、custom adapter workspace 形态、doctor 扩展、migrate 工具。
- Phase 3：默认翻转（runtime 默认 workspace-tree）、Web UI 通道展示、AI 派发更新。
- Phase 4：真机集成验证（真实 bundle 热挂载/重启 reconcile/client 面）。
- 注意：`Config.runtime` 当前默认 auto，新安装默认仍走 profile 通道，现有
  行为零回归；workspace 通道需显式 `channel: workspace` 或 runtime 配置开启。

## 12. 第七轮：故障隔离（isolated workspace loader）+ deps.yaml channel

> 用户诉求：工作区内容在子 context 里做，即使炸了也不影响主 context 打开和使用。

### 隔离模型（实现）

- `WorkspaceTreeRuntime` 改为在**独立 Loader 服务实例**上挂所有 workspace include：
  `wsCtx = ctx.isolate('loader', Symbol('pm-workspace-loader'))` +
  `wsCtx.plugin(Loader)`，include builtin 注册在 workspace loader 上。
- Cordis 机制依据（查证源码）：
  - `ReflectService.store` 按隔离 label 键控 → 子 ctx provide 'loader' 不覆盖主 loader；
  - 只有 'loader' 一个服务名被隔离，其它服务/事件总线（root 单例 `_hooks`）
    全局共享 → 插件注册进共享服务、主 ctx 监听器（clientModules）照常收到行事件；
  - 行失败只污染 workspace loader 自己的 await()，主 loader 树看不到行。
- 新增测试 3 个（workspaceTree.spec.ts 共 10 个）：主 loader 树保持干净且可正常
  create/await、坏行不炸主 loader.await()、主 ctx 事件总线能看到 workspace 行事件。

### 防「DSH 打不开」加固

- `createRuntime`（auto 模式）同步读 ledger 判断 workspace 条目 —— ledger 损坏
  会抛 → pm 插件构造失败 → web profile boot fail-loud。已改为容错：损坏按空
  ledger 降级 legacy，构造永不抛（`dpm doctor` 事后修复）。测试：损坏 ledger
  下服务仍能构造（ai.spec.ts +1）。

### deps.yaml channel 支持（Phase 2 起点）

- `SpecEntry.channel` + `parseEntry` 校验（profile/workspace）+ `SpecFingerprint`
  纳入 channel（channel 变化 → update 而非 keep）。测试 +1（spec.spec.ts）。
- 两个示例工作区已重写为新规范：`dsh-p-manager-sample`（4 条目全 channel:
  workspace；dsh-ads/dsh-vision-toolkit 改 dsh-bundle 直装，dsh-tui 保留
  custom workspace 形态，删除旧 stage/file: 链路 adapter）与 `m_profile`
  （anchored-standard + channel: workspace）。均通过 `dpm restore --dry-run` 验证。

### 当前状态

`pnpm run check` 全绿：73/73 测试、typecheck、build。

### 下一步

- Phase 2 剩余：npm 源 carrier、custom adapter workspace 形态规范、doctor 扩展、
  migrate 工具。
- Phase 3：默认翻转 + Web UI。Phase 4：真机验证（隔离 loader 在真实 web
  profile 的 boot 时序、client 面事件冒泡确认）。
