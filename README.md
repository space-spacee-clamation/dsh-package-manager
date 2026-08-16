# dsh-package-manager

`@dsh-ext/dsh-package-manager` 是 DSH 的插件包管理器。每个插件拥有一个可配置的
专属工作区，工作区内是类似 Python `.venv` 的隔离依赖层；设置页只需粘贴一个
链接并“派发给 AI 安装”。`dsh-bundle` 插件通过 Cordis 热挂载/热卸载，卸载时先
dispose 运行时 fiber，再按 ledger 中记录的显式逆操作 LIFO 回滚。

> DSH plugin package manager. Every plugin gets a configurable workspace with a
> `.venv`-style isolated dependency layer; the settings tab takes one link and
> dispatches the install to an AI session. dsh-bundle plugins hot-plug through
> Cordis, and uninstall replays recorded inverse steps LIFO.

## 设计对应关系

实现直接对应 DSH/Cordis 论文第 7 章相关工作中的两条主线：

- **7.3 时间组合性 / revertible effect**：每个安装 step 在运行时生成显式
  `inverse`；失败与卸载都按 LIFO 重放，不依赖单独的卸载脚本。
- **7.4 空间组合性 / reactive coeffect**：profile 是插件的上下文；插件装在
  自己的 `.venv` 中，profile 只声明最小依赖，并由 Cordis fiber 负责挂载和
  dispose。

完整映射见 [docs/cordis-design.md](docs/cordis-design.md)。

## 功能

- **插件工作区 + `.venv`**：每个插件位于
  `<workspaceRoot>/<profile>/<id>`，依赖只进入其 `.venv`，profile 仅保存一个
  `link:` 依赖。
- **AI 安装**：设置页只填一个链接。服务创建插件工作区、注册
  `workspaceRegistry`、创建 `cwd` 为该工作区的 agent session 并 attach；会话
  会通过宿主事件流自动出现在前端历史记录中。
- **随时热插拔**：`dsh-bundle` 插件安装成功后立即 `ctx.plugin()` 挂载；卸载
  时先 dispose fiber，再回放逆操作。常规安装/卸载无需重启。
- **事务与回滚**：安装失败按 LIFO 回滚；卸载重放 ledger，不信任单独维护的
  卸载脚本。
- **requirements 复原**：`deps.yaml` 声明每个 mode 应有的插件，`restore`
  按 `id` 计算 `install / keep / update / uninstall` 最小差集。
- **git 同步**：`sync` 先 `git pull --ff-only`，再执行 restore。
- **CLI + Web + API**：`dpm`、`/pm-api/*` 和程序化 API 共用同一 core。
- **可移植 adapter**：支持 `${DSH_HOME}` / `${DSH_PROFILE}` /
  `${DSH_WORKDIR}` / `${DSH_WORKSPACE}` / `${DSH_PLUGIN_ENV}` 占位符。
- **开关功能**：插件可“关闭”（记住参数后卸载）并一键重新打开。
- **设置菜单**：除了 Plugins 下的“包管理”tab，还注册了设置列表一级菜单
  “插件工作区”，两个入口共用同一个页面。
- **虚拟环境默认值**：工作区根目录默认
  `<home>/package-manager/plugin-workspaces`；设置页显示当前生效路径，并可
  一键“使用默认”。
- **开发者模式**：直接安装、requirements、sync、adapter 生成等高级表单默认
  隐藏，避免普通用户面对过多字段。

## 快速开始：从链接安装

1. 打开 DSH **Settings → 插件工作区**（或 **Plugins → 包管理**）。
2. 可选：设置“插件工作区根目录”。默认是
   `<home>/package-manager/plugin-workspaces`，页面显示当前生效路径并可一键
   恢复默认。
3. 粘贴一个链接，例如 `github:owner/dsh-visualize`，点击
   **“派发给 AI 安装”**。
4. 前端历史记录中会出现新的 AI 会话，并按插件工作区分组。
5. AI 调用 `pm_install` 完成安装：

   - `dsh-bundle` 插件立即热挂载，无需重启；
   - 需要自定义 adapter 的插件，AI 会调用 `pm_scaffold` 生成骨架，补全后
     继续调用 `pm_install`。

对应 HTTP 调用：

```bash
curl -X POST http://localhost:<port>/pm-api/ai-install \
  -H 'content-type: application/json' \
  -H 'x-dsh-pm: 1' \
  -d '{"source":"github:owner/dsh-visualize"}'
```

响应：

```json
{
  "ok": true,
  "value": {
    "profile": "web",
    "id": "dsh-visualize",
    "source": "github:owner/dsh-visualize",
    "workspaceId": "…",
    "workspacePath": "<workspaceRoot>/web/dsh-visualize",
    "sessionId": "session-…",
    "prompt": "你是 DSH 插件工作区的安装智能体…"
  }
}
```

## 插件工作区与配置

默认布局：

```text
<workspaceRoot>/<profile>/<safe-id>/
  .venv/                  # 隔离依赖层：源码快照 + pnpm 依赖
  requirements/           # AI 生成的自定义 adapter（如有）
  package-manager.json    # 工作区 manifest：profile/id/source
  AGENTS.md               # 给 AI 会话的任务说明（AI 派发时写入）
```

- `workspaceRoot` 空 = `<home>/package-manager/plugin-workspaces`。
- 相对路径按 `$DSH_HOME` 解析。
- profile 的 `package.json` 只出现 `link:<...>.venv` 形式的依赖；
  不会把第三方依赖树直接写进 profile。
- `config.json` 示例：

```json
{
  "workspaceRoot": "D:/dsh-plugin-workspaces",
  "storagePath": "D:/dsh-profiles/default",
  "remoteUrl": "ssh://git@gitlab.example.com/group/profile.git",
  "autoSync": true
}
```

## dsh-bundle 安装顺序

对声明了 `dsh.bundle.patch` 的插件：

```text
materialize source
  -> probe dsh.bundle.patch
  -> copy source into <workspace>/.venv        (git/file)
     或 create .venv linker project + pnpm add (npm)
  -> pnpm install inside .venv
  -> profile.dependency.add link:<.venv>
  -> profile.bundles.reconcile
  -> import(packageName) + ctx.plugin(package)  ← 热挂载
```

卸载顺序：

```text
dispose Cordis fiber
  -> LIFO replay inverse steps
  -> remove .venv / profile link / bundle entry
  -> remove ledger entry
```

只有无法热挂载的路径会写 restart marker：custom adapter、CLI 独立进程、模块
导入失败或插件依赖未满足。

## 安装到 DSH profile

**方式 A：作为 git 依赖（推荐分发方式）**

在 profile 目录执行：

```bash
pnpm add github:space-spacee-clamation/dsh-package-manager
```

或编辑 `<home>/profiles/<name>/package.json`：

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

重新 `pnpm install` 并启动 DSH。包自带的 `dsh.bundle.patch` 会注入三个
loader 行：

```text
package-manager        核心服务（所有 profile 可用）
package-manager-tools  注册 pm_install / pm_scaffold（依赖 tools 服务）
package-manager-web    挂载 /pm-api/*（依赖 webServer）
```

**方式 B：本地开发链接**

```bash
pnpm add "link:/path/to/dsh-package-manager"
```

本地开发可直接执行 `node bin/dpm.mjs ...`。

## requirements 仓库

requirements 仓库只提交声明和自定义 adapter，不提交第三方依赖本体。

```bash
# 1. 为新插件生成 entry 与 adapter 骨架
dpm adapter-init --source github:owner/repo --id my-plugin --out-dir .

# 2. dsh-bundle 无需 adapter；其他插件编辑
#    ./requirements/adapters/my-plugin/adapter.yaml

# 3. 预演
dpm restore --file ./requirements/deps.yaml --dry-run

# 4. 复原
dpm restore --file ./requirements/deps.yaml

# 5. 拉取 requirements 仓库并同步
git clone <requirements-repo-url> profile-repo
cd profile-repo
dpm sync --repo .
```

`sync` 默认读取 `<repo>/requirements/deps.yaml`。

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

## Web API

默认前缀 `/pm-api`。所有写操作需要请求头 `x-dsh-pm: 1`（同源客户端防护）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/pm-api/state` | 读取 home / workspaceRoot / profiles / entries / disabled / config |
| `GET` | `/pm-api/config` | 读取工作区根目录、包存储与自动同步配置 |
| `POST` | `/pm-api/config` | 保存配置（`PackageManagerConfig`） |
| `POST` | `/pm-api/ai-install` | 创建插件工作区 + AI 会话并派发安装（`AiInstallRequest`） |
| `POST` | `/pm-api/install` | 安装插件（`InstallRequest`） |
| `POST` | `/pm-api/uninstall` | 卸载插件（`UninstallRequest`） |
| `POST` | `/pm-api/disable` | 关闭插件（记录参数后卸载，可重新打开） |
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

## AI 工具

`package-manager-tools` 行注册两个全局工具：

### `pm_install`

- 只接受包管理器自己创建的插件工作区会话调用；
- 来源固定从工作区 `package-manager.json` 读取，不接受模型任意指定 URL；
- 参数：`adapter`、`adapterDir`、`ref`、`allowBuild`；
- 安装在本进程内执行，因此 `dsh-bundle` 插件能真正热挂载。

### `pm_scaffold`

- 为没有 `dsh.bundle.patch` 的插件生成 `requirements/deps.yaml` 与
  `requirements/adapters/<id>/adapter.yaml`；
- AI 补全 adapter 后再次调用 `pm_install`，传入 `adapterDir`。

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

- `createPackageManager()`：纯 core，适合 CLI、脚本和测试；不会热挂载，会写
  restart marker。
- `PackageManagerService`：在 Cordis Context 中创建 service，自动携带
  `CordisRuntime`，因此 Web UI 和 AI 工具路径支持热插拔。
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
插件 `.venv` 的 pnpm-workspace 中，卸载时撤销。

## requirements 仓库布局

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

字段、默认值与路径解析规则见
[docs/requirements-spec.md](docs/requirements-spec.md)。

## 自定义 adapter

`adapter.yaml` 由 `id / install / uninstall / verify` 组成。安装时顺序执行
`install`，再执行 `verify`；失败自动回滚。

新工作区布局推荐写法：

```yaml
id: my-plugin
install:
  - uses: file.copy
    from: ${DSH_WORKDIR}/source
    to: ${DSH_PLUGIN_ENV}
  - uses: file.copy
    from: ${DSH_PLUGIN_ENV}/preset/agent.cordis.yml
    to: ${DSH_HOME}/.agent-presets/my-plugin/agent.cordis.yml
verify:
  - uses: check
    run: >-
      node -e "const fs=require('node:fs');process.exit(fs.existsSync(process.env.DSH_PLUGIN_ENV) ? 0 : 1)"
    env:
      DSH_PLUGIN_ENV: ${DSH_PLUGIN_ENV}
uninstall: []
```

完整 step 语义、占位符和路径锚定规则见
[docs/adapter-spec.md](docs/adapter-spec.md)。

## 目录与环境约定

| 路径 | 含义 |
| --- | --- |
| `$DSH_HOME` | harness home；未设置时为 `~/.dsh` |
| `<home>/profiles/<name>` | profile 目录（package.json、cordis.patch.yml、pnpm-workspace.yaml） |
| `<workspaceRoot>/<profile>/<id>` | 插件专属工作区（AI 会话 cwd） |
| `<workspaceRoot>/<profile>/<id>/.venv` | 插件隔离依赖层（类似 Python venv） |
| `<home>/package-manager/ledger.json` | 已安装插件 ledger |
| `<home>/package-manager/config.json` | 工作区根目录、包存储路径、远程 URL、自动同步开关 |
| `<home>/package-manager/disabled.json` | 已关闭插件的原安装参数 |
| `<home>/package-manager/cache` | clone / 下载 / 备份 scratch 目录 |

## 开发

```bash
pnpm install
pnpm run check   # typecheck + vitest + tsdown build
pnpm run test    # vitest run
pnpm run build   # 生成 lib/index.js、lib/web.js、lib/tools.js、lib/client.js 与类型
```

测试覆盖：requirements 解析与 diff plan、profile 与 pluginEnv step、Cordis
热挂载/卸载 runtime、AI dispatch、AI 工具注册，以及
`adapter-init → restore → uninstall` 的端到端流程。

## License

[MIT](LICENSE)。
