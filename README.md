# dsh-package-manager

`@dsh-ext/dsh-package-manager` 是 DSH 的插件包管理器。它只保留一条安装管线：
把 dsh-bundle 插件安装为 profile 依赖，然后把它声明的 `dsh.bundle.patch`
写入 profile 自己的 `cordis.patch.yml`。热挂载、热卸载、禁用/启用都不再碰
Loader API，而是完全交给宿主启动时已经挂好的 `watchUserPatches`。

> One pipeline only: profile dependency install + a managed block in
> `cordis.patch.yml`. The host's own `watchUserPatches` diffs the root Include
> and hot-mounts/unmounts the rows. dsh-bundle plugins never need a restart.

## 为什么这样设计

DSH 的每个 profile 在 boot 时会把以下补丁层合成为一棵 Loader 树：

```text
bundle 层（dsh.profile.bundles 顺序）
-> profile cordis.patch.yml
-> home cordis.patch.yml
-> --patch overlays
```

`apps/cli/src/profile-boot.ts` 里的 `watchUserPatches` 监听 profile/home 两级
`cordis.patch.yml`，每次文件变化都会重新解析该层，并调用 root Include 的
`entry.update({ config: { ...config, patches } })`。Loader 随后按行 id 做增量
diff——这就是官方热重载路径，新增行即挂载，删行即卸载，`disabled: true` 即禁用。

因此本包**不导入 `cordis-plugin-loader`、不创建 Include 子树、不重算 profile
组合**。安装 dsh-bundle 时只做两件事：

1. `pnpm add <source>`（或 `dsh plugin` 的等价 pnpm 路径），让包可以从
   profile 的 `node_modules` 解析；
2. 把该包的 `dsh.bundle.patch` 归一化后写进 profile `cordis.patch.yml` 的一个
   **带标记的托管块**：

```yaml
# 用户自己的补丁行保持原样
- id: user-row
  name: ./user-row.mjs

# >>> dsh-package-manager: "my-plugin"
- insert:
    - id: my-plugin-row
      name: my-plugin
      config:
        token: !!js process.env.MY_TOKEN
# <<< dsh-package-manager: "my-plugin"
```

写块 = 热挂载；删块 = 热卸载；把块重写为“原补丁行 + `{ id, disabled: true }`”
= 热禁用/启用。重启后托管块仍在用户层，所以插件照常启动，**不需要把包名写进
`dsh.profile.bundles`**——这也避免了 bundle 层和托管块双重组合同一批行。

## 功能

- **dsh-bundle 单管线热装卸**：安装为 profile 依赖 + 写入托管块；装/卸/开关
  都走官方 `watchUserPatches`，无需重启。
- **开关即禁用行**：禁用保留依赖和 ledger 记录，只在托管块尾部增删
  `disabled` 补丁行。
- **检查更新**：对 git 源插件执行 `git ls-remote`，有更新时自动同步
  mirror 并完成热更新。
- **无 bundle 插件仍可用 custom adapter**：声明式 YAML adapter 执行任意
  安装/卸载步骤；这类插件没有 dsh-bundle 的热重载保证。
- **requirements 复原与同步**：`deps.yaml` 按 id 做最小差集
  `install / keep / update / uninstall / disable / enable`。
- **本地运行插件发现**：监听 Cordis `internal/plugin`（注册激活前）并遍历已存在 fiber，自动展示非系统本地插件。
- **CLI + Web + API**：`dpm`、`/pm-api/*` 与程序化 API 共用同一 core。
- **装前校验**：拒绝 `workspace:` 依赖、非 ESM、缺 `dsh.bundle.patch`、未构建
  入口的包，任何 profile 修改之前失败。
- **doctor**：清理 ledger stale 记录、托管块残留与 profile pnpm 树。

## 快速开始

前提：已有 DSH profile（例如 `<home>/profiles/web`），其中还没有本包。

```bash
cd <home>/profiles/web
pnpm add github:space-spacee-clamation/dsh-package-manager
pnpm install
```

或直接编辑 `<home>/profiles/web/package.json`，只加依赖，**不要加进
`dsh.profile.bundles`**：

```json
{
  "dependencies": {
    "@dsh-ext/dsh-package-manager": "github:space-spacee-clamation/dsh-package-manager"
  }
}
```

然后把包管理器自己迁入 profile `cordis.patch.yml` 托管块：

```bash
dpm self-managed --repo /path/to/dsh-package-manager --profile web
```

重启 DSH 后，包管理器由用户层托管块挂载。之后包管理器自己的源码/产物变化
就可以通过官方 `watchUserPatches` 热更新。

未发布到 profile 时，也可以直接执行 `node bin/dpm.mjs ...` 使用 CLI。

## 使用

```bash
dpm state
dpm install --profile web --source github:owner/repo --adapter auto --dry-run
dpm install --profile web --source github:owner/repo --allow-build
dpm uninstall --profile web --id repo
dpm check-update --profile web --id repo
dpm disable --profile web --id repo
dpm enable --profile web --id repo
dpm restore --file ./requirements/deps.yaml
dpm sync --repo . --modes web,headless
dpm doctor
```

Web 设置页的链接输入会创建 AI 会话并派发 `pm_install`。详细 API 与 adapter
规范见 `docs/`。

## 目录

| 路径 | 含义 |
| --- | --- |
| `<home>/profiles/<name>/package.json` | profile 依赖真相（安装） |
| `<home>/profiles/<name>/cordis.patch.yml` | 热装卸真相（本包只编辑其中的托管块） |
| `<home>/package-manager/ledger.json` | 本包元数据：source/id/packageName/steps |
| `<home>/package-manager/runtime/*` | 工作区历史、git 源缓存与 scratch |

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/usage.md](docs/usage.md) | 设置页、CLI、Web API、程序化 API、source spec、requirements |
| [docs/adapter-spec.md](docs/adapter-spec.md) | custom adapter step 词汇表、占位符、逆操作 |
| [docs/requirements-spec.md](docs/requirements-spec.md) | `requirements/deps.yaml` 字段与校验 |
| [docs/ai-tools.md](docs/ai-tools.md) | AI 安装流程与工具契约 |
| [docs/development.md](docs/development.md) | 构建、测试与本地开发 |

## UI 参考

设置页视觉样式参考
[Dannimations/Browser-extensions-manager-ui](https://github.com/Dannimations/Browser-extensions-manager-ui)
（Frontend Mentor 的 Browser extensions manager UI challenge）：
浅蓝渐变背景、白色卡片、中性描边、红/灰开关状态。交互与业务逻辑为本项目独立实现。

## License

[MIT](LICENSE)。
