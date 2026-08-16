# dsh-package-manager

`@dsh-ext/dsh-package-manager` 是 DSH 的插件包管理器：从 git / 本地目录 / npm
安装插件，用 `requirements/deps.yaml` 声明并复原整套 profile（模式），所有安装
与卸载都由内置或自定义 adapter 包装，并带事务回滚。

> DSH plugin package manager. Installs plugins from git / local / npm, restores
> whole profile modes from a requirements file, and wraps every install and
> uninstall with a built-in or declarative custom adapter.

## 功能

- **安装 / 卸载**：`dsh-bundle` 插件走 `pnpm add/remove` + bundle 列表同步；
  普通仓库可生成自定义 adapter。
- **requirements 复原**：`deps.yaml` 声明每个 mode 应有的插件，`restore`
  按 `id` 计算 `install / keep / update / uninstall` 最小差集。
- **git 同步**：`sync` 先 `git pull --ff-only` requirements 仓库，再执行
  restore；第三方依赖在 restore 时自动 clone。
- **事务与回滚**：每一步都记录显式逆操作；安装失败按 LIFO 回滚；卸载重放
  记录，不依赖单独维护的卸载脚本。
- **CLI + Web + API**：`dpm` 命令、Settings → Plugins 页面、`/pm-api/*`
  HTTP 接口共用同一个 core。
- **可移植 adapter**：adapter 使用 `${DSH_HOME}` / `${DSH_PROFILE}` /
  `${DSH_WORKDIR}` 占位符，可在机器和用户之间复用。
- **包存储与自动同步**：设置界面可直接配置本地 requirements 仓库路径和
  远程 URL；开启后服务启动时自动 clone / pull 并 restore。
- **开关功能**：每个插件可“关闭”（按记录卸载但记住原安装参数），之后可
  一键重新打开；彻底删除仍走卸载按钮。
- **开发者模式**：设置界面可切换开发者模式，显示原始 state、`ref` 输入和
  API 清单。

## 构建产物

| 路径 | 内容 |
| --- | --- |
| `lib/index.js` / `lib/index.d.ts` | Node 侧：`PackageManagerService`、core API、类型 |
| `lib/web.js` / `lib/web.d.ts` | Web 路由：在 `webServer` 上挂载 `/pm-api/*` |
| `lib/client.js` | 浏览器侧：Settings 的 Plugins 标签页 |
| `bin/dpm.mjs` | 独立 CLI |
| `cordis.patch.yml` | bundle patch：注入 `package-manager` 与 `package-manager-web` 两个 loader 行 |

## 安装到 DSH profile

**方式 A：作为 git 依赖（推荐分发方式）**

在 profile 目录执行：

```bash
pnpm add github:space-spacee-clamation/dsh-package-manager
```

或直接编辑 `<home>/profiles/<name>/package.json`：

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

然后重新 `pnpm install` 并重启 DSH。包自带 `dsh.bundle.patch`，若由本包管理器
安装，安装完成后会自动 reconcile 进 `dsh.profile.bundles`。

**方式 B：本地开发链接**

```bash
pnpm add "link:/path/to/dsh-package-manager"
```

本地开发时可直接运行 `node bin/dpm.mjs ...`，无需发布。

## 快速开始：建立 requirements 仓库

requirements 仓库只提交声明和自定义 adapter，不提交第三方依赖本体。

```bash
# 1. 为一个新插件生成 entry 与 adapter 骨架
dpm adapter-init --source github:owner/repo --id my-plugin --out-dir .

# 2. 自定义插件编辑 ./requirements/adapters/my-plugin/adapter.yaml
#    dsh-bundle 插件无需 adapter

# 3. 预演
dpm restore --file ./requirements/deps.yaml --dry-run

# 4. 复原
dpm restore --file ./requirements/deps.yaml

# 5. 日常使用：拉取 requirements 仓库后自动同步
git clone <requirements-repo-url> profile-repo
cd profile-repo
dpm sync --repo .
```

`sync` 默认读取 `<repo>/requirements/deps.yaml`。

## CLI

`dpm` 在包安装后由 `bin` 暴露；未安装时可执行 `node bin/dpm.mjs`。

```text
state          查看 home / profiles / ledger 条目
install        --profile <name> --source <spec> [--id <id>]
               [--adapter auto|dsh-bundle|custom] [--adapter-dir <dir>]
               [--ref <ref>] [--allow-build] [--dry-run]
uninstall      --profile <name> --id <id> [--dry-run]
restore        --file <requirements.yaml> [--modes a,b] [--dry-run]
sync           --repo <path> [--file <requirements.yaml>] [--modes a,b] [--dry-run]
adapter-init   --source <spec> --id <id> --out-dir <dir>
               [--profile web] [--ref <ref>]
config         [--storage-path <dir>] [--remote-url <url>] [--auto-sync]
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
dpm config --storage-path D:\dsh-profiles --remote-url ssh://git@gitlab.example.com/group/profile.git --auto-sync
dpm sync-configured
```

## Web API

核心路由默认挂在 `apiPrefix`（默认 `/pm-api`）。所有写操作需要请求头
`x-dsh-pm: 1`（同源客户端防护）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/pm-api/state` | 读取 home / profiles / entries / disabled / config |
| `GET` | `/pm-api/config` | 读取包存储与自动同步配置 |
| `POST` | `/pm-api/config` | 保存包存储与自动同步配置 |
| `POST` | `/pm-api/install` | 安装插件 |
| `POST` | `/pm-api/uninstall` | 卸载插件 |
| `POST` | `/pm-api/disable` | 关闭插件（记录参数后卸载，可重新打开） |
| `POST` | `/pm-api/enable` | 重新打开已关闭插件 |
| `POST` | `/pm-api/restore` | 从 requirements 文件复原 |
| `POST` | `/pm-api/sync` | 拉取 requirements 仓库并复原 |
| `POST` | `/pm-api/sync-configured` | 按已保存配置 clone / pull 并复原 |
| `POST` | `/pm-api/adapter-init` | 探测源码并生成 adapter 骨架 |
| `POST` | `/pm-api/restart/clear` | 清除“需要重启”提示 |

请求体与 `InstallRequest / UninstallRequest / RestoreRequest / SyncRequest /
AdapterInitRequest` 对应，响应统一为：

```json
{ "ok": true, "value": { } }
```

## Programmatic API

```ts
import { createPackageManager } from '@dsh-ext/dsh-package-manager'

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
manager.setConfig({ storagePath: './profile-repo', remoteUrl: 'ssh://git@host/group/repo.git', autoSync: true })
await manager.syncConfigured()
manager.adapterInit({ source: 'github:owner/repo', id: 'repo', outDir: '.' })
```

导出：`PackageManager`、`createPackageManager`、`idFromSource`、
`PackageManagerService`、`Config` 及全部 wire 类型。

## source spec

`source` 支持以下写法：

| 写法 | 示例 | 类型 |
| --- | --- | --- |
| GitHub 简写 | `github:owner/repo`、`github:owner/repo#main` | git |
| git URL | `git+https://...`、`ssh://git@...`、带 `.git` 的 HTTPS URL | git |
| npm 包名 | `some-pkg`、`@scope/pkg`、`npm:...` | npm |
| 本地目录 | `./repo`、`D:\src\repo`、`file:...`、`link:...` | file |

`--ref` 可固定 git 分支 / tag / commit。git 源默认不会自动允许 pnpm build
script；遇到 build script 错误时按提示重跑并加 `--allow-build`。

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

`adapter.yaml` 由 `id / install / uninstall / verify` 组成，step 词汇表包括
`file.copy`、`file.write`、`file.remove`、`command`、`check`、`profile.*` 等。
安装时顺序执行 install，再执行 verify；失败自动回滚。

```yaml
id: my-plugin
install:
  - uses: file.copy
    from: ${DSH_WORKDIR}/source/README.md
    to: ${DSH_HOME}/plugins/my-plugin/README.md
verify:
  - uses: check
    run: node -e "process.exit(require('node:fs').existsSync(process.env.DSH_HOME + '/plugins/my-plugin/README.md') ? 0 : 1)"
    env:
      DSH_HOME: ${DSH_HOME}
uninstall: []
```

完整 step 语义、占位符和路径锚定规则见
[docs/adapter-spec.md](docs/adapter-spec.md)。

## 目录与环境约定

| 路径 | 含义 |
| --- | --- |
| `$DSH_HOME` | harness home；未设置时为 `~/.dsh` |
| `<home>/profiles/<name>` | profile 目录（package.json、cordis.patch.yml、pnpm-workspace.yaml） |
| `<home>/package-manager/ledger.json` | 已安装插件 ledger |
| `<home>/package-manager/config.json` | 包存储路径、远程 URL、自动同步开关 |
| `<home>/package-manager/disabled.json` | 已关闭插件的原安装参数 |
| `<home>/package-manager/cache` | clone / 下载 / 备份 scratch 目录 |

## 开发

```bash
pnpm install
pnpm run check   # typecheck + vitest + tsdown build
pnpm run test    # vitest run
pnpm run build   # 生成 lib/index.js、lib/web.js、lib/client.js 与类型
```

测试覆盖 requirements 解析、diff plan、profile 文件 step、自定义 adapter
安装回滚，以及 `adapter-init → restore → uninstall` 的端到端流程。

## License

[MIT](LICENSE)。
