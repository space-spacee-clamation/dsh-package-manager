# 使用手册

本文假设包管理器已经安装到 DSH profile。安装方式见 README 的“快速开始”。

## 设置页

### 包管理菜单

安装后会出现两个入口：

- 设置列表一级菜单 **插件管理**（`settings.section`，id `package-manager`）；
- Plugins 设置区的 **包管理** tab。

两个入口共用同一页面。

### 工作区页面

默认进入“插件管理”页：

- 顶部路径栏显示当前 `workspaceRoot`，可从本地历史路径或默认路径切换；
- 历史路径写入 `<home>/package-manager/runtime/workspace-history.json`，最多保留 20 条；
- **切换路径会自动对齐**：目标目录存在 `requirements/deps.yaml` 时，安装目标声明但未安装的插件，关闭目标未声明的插件（包括目标文件里完全没有的 profile）；目标目录没有 requirements 文件时只切换 `workspaceRoot`，不动已安装集合；
- 中间插件列表为卡片布局，只有该区域滚动；开关立即启用/关闭，删除需二次确认；
- 底部固定“链接输入栏 + 派发给 AI 安装”。

“详细设置”页保留原有表单布局。

### 工作区根目录设置

- `workspaceRoot` 是 AI 安装会话与 custom adapter 的工作根目录；空 =
  `<home>/package-manager/plugin-workspaces`；
- dsh-bundle 不使用这个目录：依赖装在 profile，热装卸块在 profile
  `cordis.patch.yml`；
- 相对路径按 `$DSH_HOME` 解析；
- 页面显示当前生效路径，并提供“使用默认”一键恢复；
- `config.json` 示例：

```json
{
  "workspaceRoot": "D:/dsh-plugin-workspaces",
  "storagePath": "D:/dsh-profiles/default",
  "remoteUrl": "ssh://git@gitlab.example.com/group/profile.git",
  "autoSync": true
}
```

### 从链接安装

1. 粘贴一个链接，例如 `github:owner/dsh-visualize`；
2. 点击“派发给 AI 安装”；
3. 前端历史记录出现新的 AI 会话，并按插件工作区分组；
4. AI 调用 `pm_install` 完成安装；需要自定义 adapter 时调用 `pm_scaffold`。

对应 HTTP 调用见下文 `/pm-api/ai-install`。

路径栏切换调用 `POST /pm-api/workspace/switch`，等价于先写
`workspaceRoot`，再对目标 `requirements/deps.yaml` 做一次包含全部已知
profile 的对齐。

## CLI

`dpm` 在包安装后由 `bin` 暴露；未安装时执行 `node bin/dpm.mjs`。

```text
state          查看 home / workspaceRoot / profiles / ledger 条目
install        --profile <name> --source <spec> [--id <id>]
               [--adapter auto|dsh-bundle|custom] [--adapter-dir <dir>]
               [--ref <ref>] [--allow-build] [--dry-run]
uninstall      --profile <name> --id <id> [--dry-run]
restore        --file <requirements.yaml> [--modes a,b] [--dry-run]
sync           --repo <path> [--file <requirements.yaml>] [--modes a,b] [--dry-run]
adapter-init   --source <spec> --id <id> --out-dir <dir>
               [--profile web] [--ref <ref>]
config         [--workspace-root <dir>] [--storage-path <dir>]
               [--remote-url <url>] [--auto-sync]
sync-configured
disable        --profile <name> --id <id>
enable         --profile <name> --id <id>
```

示例：

```bash
dpm state
dpm install --profile web --source github:owner/repo --adapter auto --dry-run
dpm install --profile web --source github:owner/repo --allow-build
dpm uninstall --profile web --id repo
dpm disable --profile web --id repo
dpm enable --profile web --id repo
dpm adapter-init --source https://github.com/o/r.git --id r --out-dir .
dpm sync --repo . --modes web,headless --dry-run
dpm config --workspace-root D:\dsh-plugin-workspaces \
  --storage-path D:\dsh-profiles \
  --remote-url ssh://git@gitlab.example.com/group/profile.git --auto-sync
dpm sync-configured
```

CLI 使用纯 core：dsh-bundle 安装同样写 profile `cordis.patch.yml` 托管块。
如果 DSH 正在运行，宿主 watcher 会直接热挂载；如果 DSH 未运行，下次启动由
用户层托管块恢复，无需 restart marker。只有 custom adapter 会写 restart 提示。

## Web API

默认前缀 `/pm-api`。所有写操作需要请求头 `x-dsh-pm: 1`（同源客户端防护）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/pm-api/state` | 读取 home / workspaceRoot / workspaceDefault / profiles / entries / disabled / config |
| `GET` | `/pm-api/config` | 读取工作区根目录、包存储与自动同步配置 |
| `POST` | `/pm-api/config` | 保存配置（`PackageManagerConfig`） |
| `POST` | `/pm-api/ai-install` | 创建插件工作区 + AI 会话并派发安装（`AiInstallRequest`） |
| `POST` | `/pm-api/install` | 安装插件（`InstallRequest`） |
| `POST` | `/pm-api/uninstall` | 卸载插件（`UninstallRequest`） |
| `POST` | `/pm-api/disable` | 关闭插件（dsh-bundle 热禁用补丁行并保留安装；其余记录参数后卸载） |
| `POST` | `/pm-api/enable` | 重新打开已关闭插件 |
| `POST` | `/pm-api/restore` | 从 requirements 文件复原 |
| `POST` | `/pm-api/sync` | 拉取 requirements 仓库并复原 |
| `POST` | `/pm-api/sync-configured` | 按已保存配置 clone / pull 并复原 |
| `POST` | `/pm-api/adapter-init` | 探测源码并生成 adapter 骨架 |
| `POST` | `/pm-api/restart/clear` | 清除“需要重启”提示 |

统一响应：

```json
{ "ok": true, "value": { } }
```

`/pm-api/ai-install` 请求体：

```json
{ "source": "github:owner/repo", "profile": "web" }
```

完整 AI 安装响应和工具契约见 [docs/ai-tools.md](ai-tools.md)。

## Programmatic API

```ts
import { createPackageManager, PackageManagerService } from '@dsh-ext/dsh-package-manager'

const manager = createPackageManager({ home: '/path/to/dsh-home' })

manager.state()
await manager.install({
  profile: 'web',
  source: 'github:owner/repo',
  adapter: 'auto',
  allowBuild: false,
})
await manager.uninstall({ profile: 'web', id: 'repo' })
await manager.disable({ profile: 'web', id: 'repo' })
await manager.enable({ profile: 'web', id: 'repo' })
await manager.restore({ file: './requirements/deps.yaml', dryRun: false })
await manager.sync({ repo: '.', modes: ['web'] })
manager.setConfig({
  workspaceRoot: '',
  storagePath: './profile-repo',
  remoteUrl: 'ssh://git@host/group/repo.git',
  autoSync: true,
})
await manager.syncConfigured()
manager.adapterInit({ source: 'github:owner/repo', id: 'repo', outDir: '.' })
```

- `createPackageManager()`：纯 core，适合 CLI、脚本和测试。dsh-bundle 安装
  总是把托管块写进 profile `cordis.patch.yml`；如果 DSH 正在运行，宿主的
  `watchUserPatches` 会直接热挂载，CLI 进程本身不接触 Loader。
- `PackageManagerService`：在 Cordis Context 中创建 service。它不导入
  Loader、不建 Include 子树、不重算 profile；热装卸完全由宿主
  `watchUserPatches` 完成。
- 导出：`PackageManager`、`createPackageManager`、`idFromSource`、
  `PackageManagerService`、`Config` 及全部 wire 类型。

## source spec

| 写法 | 示例 | 类型 |
| --- | --- | --- |
| GitHub 简写 | `github:owner/repo`、`github:owner/repo#main` | git |
| git URL | `git+https://...`、`ssh://git@...`、带 `.git` 的 HTTPS URL | git |
| npm 包名 | `some-pkg`、`@scope/pkg`、`npm:...` | npm |
| 本地目录 | `./repo`、`D:\src\repo`、`file:...`、`link:...` | file |

`--ref` 可固定 git 分支 / tag / commit。git 源默认不自动允许 pnpm build
script；遇到 build script 错误时按提示重跑并加 `--allow-build`。允许列表写在
profile 自己的 `pnpm-workspace.yaml` 中，卸载时撤销。

## requirements 仓库

```text
<repo>/
  requirements/
    deps.yaml                 # 声明；sync 默认读取
    adapters/
      <id>/
        adapter.yaml          # 自定义 adapter
```

`deps.yaml` 示例：

```yaml
version: 1
repo: .
modes:
  web:
    - id: dsh-visualize
      source: github:owner/dsh-visualize
      adapter: auto
    - id: my-preset
      source: https://github.com/o/r.git
      adapter: custom
      adapterDir: adapters/my-preset
      ref: main
      allowBuild: false
  headless: []
```

字段与解析规则见 [docs/requirements-spec.md](requirements-spec.md)，adapter
写法见 [docs/adapter-spec.md](adapter-spec.md)。

## 目录与环境约定

| 路径 | 含义 |
| --- | --- |
| `$DSH_HOME` | harness home；未设置时为 `~/.dsh` |
| `<home>/profiles/<name>` | profile 目录（package.json、cordis.patch.yml、pnpm-workspace.yaml） |
| `<workspaceRoot>/<profile>/<id>` | 插件专属工作区（AI 会话 cwd） |
| `<workspaceRoot>/<profile>/<id>` | AI 安装会话的 cwd（custom adapter 可用 `${DSH_PLUGIN_ENV}` 指向其 `.venv`；dsh-bundle 不使用它） |
| `<home>/package-manager/ledger.json` | 已安装插件 ledger |
| `<home>/package-manager/config.json` | 工作区根目录、包存储路径、远程 URL、自动同步开关 |
| `<home>/package-manager/disabled.json` | 已关闭插件的原安装参数 |
| `<home>/package-manager/runtime/workspace-history.json` | 工作区根目录历史 |
| `<home>/package-manager/runtime/packages` | 集中包存储：git mirror 与文件源快照 |
| `<home>/package-manager/runtime/work` | 每次安装/卸载的 scratch 与回滚备份 |
