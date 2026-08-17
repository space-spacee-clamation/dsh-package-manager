# workspace-tree 设计:插件工作区即 Cordis 子上下文

> 状态:设计定稿,Phase 1 已实现(见 [workspace-tree-draft.md](workspace-tree-draft.md))。

## 1. 背景:拆转包链路的代价

旧实现的安装链是 `materialize source -> .venv(pnpm install) -> stage 拷贝(排除锁文件) -> profile file: 依赖 -> bundles.reconcile`,热挂载则走 `InjectedProfileComposer`(计数切片保留 launcher overlay)+ 对 profile `cordis.patch.yml` 的正则增删 disable 块。这条链在真实工作流里已发生三起事故:

- **悬空软链卡死 boot**:`link:` 指向被清理的 .venv,宿主 `resolveBundleDir` fail-loud,整个 profile 起不来(dsh-ads 事故)。
- **Windows ERR_PNPM_EPERM**:`file:` 指向带内部依赖链接的 .venv,pnpm 复制时重建符号链接失败;stage 里残留 pnpm 锁文件还会把 peer 解析毒进 .venv 内部路径。
- **双写竞态**:宿主 `watchUserPatches` 与我们的 recompose 都整体替换 root Include 的 `config.patches`,窗口极小但真实存在;overlay 计数切片依赖宿主 flatten 顺序,宿主一变就静默错位。

## 2. 核心设计:工作区 = 一个 Include 子树

DSH 的 profile 组合是「空根 cordis.yml + 补丁栈」,由一个 root Include 条目挂载。插件工作区是同一形状降一层:

```text
profile 目录                         插件工作区 .venv
  cordis.yml(空根,每次 boot 重写)     cordis.yml(空根,每次挂载重写)
  node_modules/                        node_modules/(carrier 声明 file:./pkg,pnpm 链接)
  root Include(config.patches)         per-workspace Include(config.patches = bundle patch)
```

- **Include 条目**是 loader 树的子上下文:构造时把 `ctx.baseUrl` 锚到 .venv,子树内所有裸包名、相对路径都从 .venv 解析 —— 这就是「加载不同包的子上下文」。
- **组合根**是 .venv/cordis.yml,由运行时每次挂载前重写为空列表(镜像宿主的 `prepareProfile`),避免 Include 写回把组合后的行烤进文件;持久真相在 include 的 config.patches,每次从 ledger/bundle patch 文件重算。
- **补丁列表**就是 bundle 自己的 `dsh.bundle.patch` 原文,加 disable 时追加 `{id, disabled: true}` 行;每次应用前 `structuredClone`(include 把 insert 行按引用推入树,id 定向 patch 会原地改写行对象 —— 宿主文档明确警告的 insert-aliasing,不克隆就会把 disable 状态烤进缓存)。
- **disable/enable** = 增删补丁行,纯 loader 语义,不碰 profile 文件、不碰行条目本身(行条目更新会触发 tree.write 烤盘)。
- **unmount** = 移除 include 条目(其子树随纤维释放),再按 ledger LIFO 回放文件逆操作。

## 3. 为什么拦截点在 loader,不在 registry

Cordis 的 `RegistryService` 没有任何 before/after 钩子:`ctx.plugin()` 直接 `new Fiber()`。真正存在的「挂载前」通道是 loader 层的 `internal/config`(config 插值前)与 `loader/patch-context`(条目激活前,isolate/intercept 挂在这里)。工作区行从生到死不进宿主根树,registry 永远看不到它们 —— 分流发生在「创建哪个 include 条目」这一步,不需要任何注册表钩子。

「子上下文」要拆成两层,且默认只用第一层:

- **加载层**(模块解析、行组合、baseUrl):工作区 Include 子树,即本设计。
- **服务可见性层**(`ctx.isolate` / entry `isolate` 选项):只有确实要隔离服务实现时才用。DSH 插件几乎都要注册进根服务(tools/agents/llm),默认不能隔离。

## 4. 通道契约:profile 通道与 workspace 通道互斥

一个插件要么走 profile 通道(宿主在 boot 时从 `dsh.profile.bundles` 组合它的 patch),要么走 workspace 通道(运行时由本包管理器挂载它的 Include)。两条通道都挂会双重组合。

| 维度 | profile 通道(默认,现状) | workspace 通道(新增) |
| --- | --- | --- |
| 已安装真相 | profile package.json(dependencies + bundles) | ledger 条目 + 工作区 .venv |
| 安装动作 | 一次 pnpm add + bundles reconcile | file.copy + carrier pnpm install,零 profile 修改 |
| 组合单位 | 宿主 boot 时由 loadProfile 组合 | 运行时 per-workspace Include |
| disable | profile cordis.patch.yml disable 块 + recompose | 补丁行 + ledger disabled 标记 |
| 重启后 | 宿主原生恢复 | pm 插件 boot reconcile 从 ledger 重建 |
| 官方 CLI 视角 | `dsh plugin add/remove`、`--dump-config` 可见 | 不可见(仅 pm 运行时) |

选择方式:`InstallRequest.channel`(install/API 层)、ledger 条目 `channel` 字段(持久化)、服务配置 `runtime: auto | workspace-tree | legacy`(auto 在 ledger 出现 workspace 条目后自动升级,保证重启后不丢)。

## 4.5 故障隔离:工作区挂在独立的 loader 子上下文

workspace 内容(所有 include 子树及其行)运行在**独立的 Loader 服务实例**上:
`wsCtx = ctx.isolate('loader', <私有 symbol>)` 创建子上下文,`wsCtx.plugin(Loader)`
把第二个 loader 提供到私有隔离 label(`ReflectService.store` 按 label 键控,主
loader 不被覆盖),include builtin 注册在这个 workspace loader 上。

隔离语义(Cordis 机制):

- **只有 'loader' 一个服务名被隔离**:行条目 ctx 继承 wsCtx 的 isolate 映射,`ctx.loader`
  解析到 workspace loader,其它服务(tools/agents/llm/...)从主域解析 —— 插件注册进
  共享服务,功能不受影响;
- **事件总线是 root 单例的全局 `_hooks`**:主 ctx 的监听器(clientModules registry)
  照样收到 workspace 行的事件 —— client 面可达;
- **故障封闭**:行失败只污染 workspace loader 自己的 `await()`;主 loader 树看不到
  这些行,宿主 boot 与用户层 HMR 从不 await 它们 —— 工作区炸了,主 context 照常
  打开和使用。

## 5. 生命周期

```text
mount(entry)
  -> 找 include(workspace loader.entries 按稳定 id pm-ws-<profile>-<id>,无冒号:loader 用 : 做嵌套分隔)
  -> 没有则 workspaceLoader.create({ id, name: cordis:include, config: { path: <ws>/.venv/cordis.yml, initial: [] } })
  -> 重写组合根为 [] -> include.update({ config: { ...cfg, patches } }) -> workspaceLoader.await()

setDisabled(entry, disabled)
  -> patches = raw + (disabled ? disablePatchesFor(raw) : [])
  -> include.update(...) -> workspaceLoader.await()

unmount(entry)
  -> include.parent.remove(include.id) -> workspaceLoader.await()

reconcile(entries)(boot)
  -> 遍历 ledger 的 workspace 条目逐个 mount(disabled 条目带禁用补丁)
```

## 6. 已知限制与残余风险

- **无 loader 环境**(CLI、裸测试):`available` 为 false,服务回退 legacy runtime;裸包名行在 `loader.internal` 缺失时由 `resolveBareRows` 改写为 .venv 内的 file URL(与 legacy `resolvePluginUrl` 同款兜底,真实 dsh boot 有模块钩子,不走此路径)。
- **disable 需要稳定 id**:`disablePatchesFor` 只收集有 id 的行;真实 bundle 的行都有 id,无 id 行无法被补丁禁用(宿主同语义)。
- **restore/switch 批路径**:目前仍走 profile 通道创建条目(channel 默认 profile);workspace 条目的批处理与 deps.yaml 的 channel 声明是 Phase 2。
- **npm 源**:workspace 通道要求可物化源(git/file);npm 源需要 carrier 改造,Phase 2。
- **include 的 tree.write 烤盘**:宿主用「每次 boot 重写空根」免疫,我们在每次挂载前重写,窗口内(挂载中)行配置变更可能落盘,下一次挂载重写即清除。
- **与 watchUserPatches 的关系**:我们只写自己的 include,root Include 从不相交,竞态从结构上消除。

