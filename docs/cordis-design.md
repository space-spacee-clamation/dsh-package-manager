# 与 Cordis / DSH 论文相关工作的对应关系

`dsh-package-manager` 不是“先改文件、再碰运气重启”的脚本，而是把论文
第 7.3 / 7.4 节讨论的动态组合性落到一个插件管理器上。

## 时间组合性：revertible effect

论文相关工作把“开发者手写清理回调”与“可逆 effect”区分开。本包的做法：

- 每个安装动作是一个 step，执行时立刻生成显式 `inverse`；
- 安装成功或失败都按 LIFO 重放 inverse；
- 卸载不调用任何单独维护的卸载脚本，只重放 ledger 里的 inverse；
- `.venv` 目录的创建/移除、profile `link:` 依赖、bundle reconcile 都走同一
  套 step 记录，因此资源回收是结构保证，而不是开发者自律。

对应关系：

| 论文概念 | 本包实现 |
| --- | --- |
| effect | `StepRecord`（实际执行的 step） |
| inverse effect | `StepRecord.inverse` |
| accumulator / LIFO rollback | `StepExecutor.rollback()` |
| provider 移除传播给依赖方 | 卸载前先 dispose 该插件的 Cordis fiber |

## 空间组合性：reactive coeffect

论文 7.4 节讨论组件如何声明并绑定依赖。DSH profile 本身就是上下文：

- profile 的 `dependencies` + `dsh.profile.bundles` 是组件所需的上下文；
- 包管理器只写最小差集，bundle reconcile 是上下文重新解析；
- 每个插件有自己的工作区（`workspaceRegistry` 中的 workspace）和 `.venv`
  隔离依赖层，插件只消费自己声明的那份上下文。

对应关系：

| 论文概念 | 本包实现 |
| --- | --- |
| component | 一个已安装插件 |
| coeffect 声明 | 插件的 `package.json` / `dsh.bundle.patch` |
| 上下文重新解析 | profile bundle reconcile |
| 组件级生命周期 | Cordis fiber 的 mount / dispose |

## 随时插拔

安装 `dsh-bundle` 插件后，包管理器在**当前进程**内执行：

1. 把源码放进 `<workspace>/<id>/.venv`；
2. 在 `.venv` 内 `pnpm install`；
3. profile 增加 `link:` 依赖并 reconcile bundle；
4. `ctx.loader.create({ name: packageName })` 把插件挂进 DSH 原生 loader tree；
   没有 loader 的合成环境才回退 `import(packageName)` + `ctx.plugin()`。

卸载顺序正好相反：

1. 从 `ctx.loader` 移除插件 entry，由 Cordis 原生卸载路径 dispose fiber；
2. LIFO 重放安装记录的 inverse；
3. 移除 ledger 条目。

因此 UI 不再需要“重启后生效”作为常规路径：只有无法热挂载的情况
（custom adapter、CLI 进程、导入失败）才会保留 restart 提示。
