# dsh-package-manager

`@dsh-ext/dsh-package-manager` 是 DSH 的插件包管理器。每个插件拥有一个可配置的
专属工作区，工作区内是类似 Python `.venv` 的隔离依赖层；设置页只需粘贴一个
链接并“派发给 AI 安装”。`dsh-bundle` 插件通过 Cordis 热挂载/热卸载。

> DSH plugin package manager. Every plugin gets a configurable workspace with a
> `.venv`-style isolated dependency layer; the settings tab takes one link and
> dispatches the install to an AI session. dsh-bundle plugins hot-plug through
> Cordis.

## 功能

- **插件工作区 + `.venv`**：插件安装在
  `<workspaceRoot>/<profile>/<id>`，依赖只进入 `.venv`，profile 仅保存一个
  `link:` 依赖。
- **AI 安装**：只填一个链接，自动创建插件工作区和 AI 会话，会话自动出现在
  前端历史记录中。
- **随时热插拔**：`dsh-bundle` 插件安装后立即通过 `ctx.plugin()` 挂载，卸载
  时先 dispose fiber，再回放逆操作。
- **事务与回滚**：每个安装 step 记录显式 inverse，失败与卸载都按 LIFO 回放。
- **requirements 复原**：`deps.yaml` 声明插件集合，按最小差集
  `install / keep / update / uninstall`。
- **CLI + Web + API**：`dpm`、`/pm-api/*` 和程序化 API 共用同一 core。
- **可移植 adapter**：自定义插件用声明式 YAML adapter 安装，支持
  `${DSH_HOME}` / `${DSH_PROFILE}` / `${DSH_WORKDIR}` /
  `${DSH_WORKSPACE}` / `${DSH_PLUGIN_ENV}` 占位符。

## 快速开始：在没有包管理器的工作区安装本包

前提：你已经有一个 DSH profile（例如 `<home>/profiles/web`），但其中还没有
`@dsh-ext/dsh-package-manager`。

### 方式 A：git 依赖（推荐）

在 profile 目录执行：

```bash
cd <home>/profiles/web
pnpm add github:space-spacee-clamation/dsh-package-manager
pnpm install
```

或直接编辑 `<home>/profiles/web/package.json`：

```json
{
  "dependencies": {
    "@dsh-ext/dsh-package-manager": "github:space-spacee-clamation/dsh-package-manager"
  },
  "dsh": {
    "profile": {
      "bundles": ["@dsh-ext/dsh-package-manager"]
    }
  }
}
```

重启 DSH 后，设置列表中会出现“插件工作区”菜单；Plugins 设置区也会出现
“包管理”tab。

### 方式 B：本地开发链接

```bash
cd <home>/profiles/web
pnpm add "link:/path/to/dsh-package-manager"
pnpm install
```

未发布到 profile 时，也可以直接执行 `node bin/dpm.mjs ...` 使用 CLI。

## 工作方式

### 布局

```text
<workspaceRoot>/<profile>/<safe-id>/
  .venv/                  # 隔离依赖层：源码快照 + pnpm 依赖
  requirements/           # AI 生成的自定义 adapter（如有）
  package-manager.json    # 工作区 manifest：profile/id/source
  AGENTS.md               # 给 AI 会话的任务说明（AI 派发时写入）
```

`workspaceRoot` 默认为 `<home>/package-manager/plugin-workspaces`，可在设置页
修改或一键恢复默认。

### 安装与卸载

`dsh-bundle` 插件的安装顺序：

```text
materialize source
  -> probe dsh.bundle.patch
  -> 把源码放进 <workspace>/.venv 并安装依赖
  -> profile 增加 link: 依赖并 reconcile bundle
  -> import(packageName) + ctx.plugin(package)   ← 立即热挂载
```

卸载顺序：

```text
dispose Cordis fiber
  -> LIFO 回放 ledger 中记录的 inverse step
  -> 移除 .venv / profile link / bundle entry
```

因此常规 `dsh-bundle` 安装/卸载不需要重启；只有 custom adapter、CLI 独立进程
或导入失败才会写 restart marker。

### AI 派发安装

设置页的“派发给 AI 安装”会：

1. 创建插件工作区并写入 manifest / AGENTS.md；
2. 把工作区注册进 `workspaceRegistry`；
3. 创建 `cwd` 为该工作区的 agent session 并 attach；
4. 发送安装任务，AI 调用 `pm_install` / `pm_scaffold` 完成安装。

理论映射见 [docs/cordis-design.md](docs/cordis-design.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/usage.md](docs/usage.md) | 日常使用：设置页、CLI、Web API、程序化 API、source spec、requirements 仓库 |
| [docs/ai-tools.md](docs/ai-tools.md) | AI 安装流程、`pm_install` / `pm_scaffold` 工具契约 |
| [docs/adapter-spec.md](docs/adapter-spec.md) | 自定义 adapter 的 step 词汇表、占位符、逆操作规则 |
| [docs/requirements-spec.md](docs/requirements-spec.md) | `requirements/deps.yaml` 字段、路径解析与校验 |
| [docs/cordis-design.md](docs/cordis-design.md) | 与 Cordis / DSH 论文相关工作的概念对应 |
| [docs/development.md](docs/development.md) | 构建、测试与本地开发 |

## License

[MIT](LICENSE)。
