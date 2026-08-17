# dsh-package-manager 交接文档（热重载单管线重构）

## 方向

用户定稿：**只保留一条管线**——dsh-bundle 安装为 profile 依赖，然后把它声明
的 `dsh.bundle.patch` 写进 profile 自己的 `cordis.patch.yml` 托管块。热挂载、
热卸载、禁用/启用全部交给宿主 boot 时挂好的 `watchUserPatches`，本包不导入
Loader、不创建 Include 子树、不重算 profile 组合。

已删除：

- `src/workspaceTree.ts`、`src/cordisRuntime.ts`、`src/injectedProfileComposer.ts`、
  `src/compositeRuntime.ts`、`src/adopt.ts`
- `tests/workspaceTree.spec.ts`、`tests/workspaceChannel.spec.ts`、
  `tests/runtime.spec.ts`、`tests/adopt.spec.ts`
- `docs/workspace-tree-*.md`、`docs/cordis-design.md`
- `channel` 字段（types/spec/manager/requirements）、`Config.runtime`
- 安装步骤里的 `profile.bundles.reconcile`（改为 `profile.bundles.removeMany`：
  托管块是 bundle patch 行唯一所有者，避免 bundle 层 + 用户层双重组合同一批行）

新增/重写：

- `src/profilePatch.ts`：`cordis.patch.yml` 托管块管理。写块=热挂载，删块=
  热卸载，块尾增删 `{ id, disabled: true }` = 开关；保留用户注释/补丁行，
  `!!js` 表达式 round-trip；删除唯一块后把文件恢复成合法的 `[]`。
- `src/manager.ts`：从约 1400 行砍到单管线实现。dsh-bundle 安装顺序：
  `allowBuild? -> pnpm add -> writeManagedPatch`；卸载顺序：
  `removeManagedPatch -> 逆操作回放`。custom adapter 保留原 step/rollback 语义。
- `tests/profilePatch.spec.ts`：官方热重载验收测试。用 root Include 的
  `config.patches` 更新复刻 `watchUserPatches`，验证热挂载/禁用/启用/卸载。

## 关键不变量

1. dsh-bundle **不写** `dsh.profile.bundles`。
2. 安装/卸载/恢复/开关全部经 `enqueue` 串行化。
3. 托管块有 `# >>> dsh-package-manager: "<id>"` / `# <<< ...` 标记，
   删除时按整块文本移除，不解析用户内容。
4. `isEntryEffective` 的真相 = profile `package.json` dependencies；
   stale 条目在 uninstall/doctor 时同时清托管块，防止悬空行卡死 boot。
5. `hotMounted`/`hotUnmounted` 表示“托管块已写/已删”，真实 Loader diff 由
   宿主 watcher 完成；这是刻意的，不通过 `ctx.loader` 验证。

## 验证

```bash
cd /d/DSHarness/dsh-package-manager
pnpm run typecheck
pnpm run test
pnpm run build
```

当前状态：64/64 测试 + typecheck + build 全绿。

真机切换已跑通：`dsh-p-manager-sample` -> `m_profile`（dsh-ads /
dsh-vision-toolkit 热禁用）-> 回到 sample（热启用 + 安装 dsh-tui）。
dsh-tui 的 custom adapter 已把 allowBuild 选择器改为
`@deepseek-harness-tui/dsh-tui@file:pkg`（pnpm 11 要求）。

## 真机升级

旧 ledger 里的 workspace-channel dsh-bundle 条目（例如 `dsh-ads`）没有 profile
dependency，新代码会视为 stale：`dpm doctor` 会删 ledger 记录并清理旧
`pluginEnvDir`；随后用更新过的 requirements（已无 `channel`）`dpm restore`
会按 profile 依赖 + `cordis.patch.yml` 托管块重装。

## 尚未做

- UI 文案还可进一步去掉“工作区”术语（已改主要字符串，页面变量名未改名）。
- `docs/adapter-spec.md` 仍描述 custom adapter 的 `${DSH_PLUGIN_ENV}` 布局；
  该语义仅适用于 custom adapter，不适用于 dsh-bundle 单管线。
- `package.json` 的 optional peer `cordis-plugin-include` /
  `cordis-plugin-loader` 已移除；devDependencies 保留给测试和类型。
