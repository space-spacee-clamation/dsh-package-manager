# dsh-package-manager

`@dsh-ext/dsh-package-manager` 是 DSH 的插件包管理器。每个插件拥有一个可配置的
专属工作区，工作区内是类似 Python `.venv` 的隔离依赖层；设置页只需粘贴一个
链接并“派发给 AI 安装”。`dsh-bundle` 插件通过 Cordis 热挂载/热卸载。

> DSH plugin package manager. Every plugin gets a configurable workspace with a
> `.venv`-style isolated dependency layer; the settings tab takes one link and
> dispatches the install to an AI session. dsh-bundle plugins hot-plug through
> Cordis.

## 功能

- **两种安装通道**：`channel: profile`(默认)把插件装成 profile 依赖并由宿主在
  boot 时组合；`channel: workspace` 把插件装进专属工作区，由本包在运行时经
  Cordis Include 子树挂载，**profile manifest 零修改**。
- **AI 安装**：只填一个链接，自动创建插件工作区和 AI 会话，会话自动出现在
  前端历史记录中。
- **随时热插拔**：`dsh-bundle` 安装后按 `dsh.bundle.patch` 的稳定 id 挂载补丁
  行——workspace 通道挂进独立的 workspace loader（与主 context 故障隔离），
  profile 通道挂进主 loader；disable/enable 走补丁行语义，无需卸载重装。
- **事务与回滚**：每个安装 step 记录显式 inverse，失败与卸载都按 LIFO 回放。
- **requirements 复原**：`deps.yaml` 声明插件集合（含 `channel` 字段），按最小
  差集 `install / keep / update / uninstall`；restore / workspace switch 对
  workspace 条目保持通道不翻转。
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

## 插件原理

### DSH 的组合模型

DSH 的每个 profile 是一棵**补丁栈组合**：profile 目录里有一个空根
`cordis.yml`，根上叠多层 loader 补丁（`dsh.profile.bundles` 里的组合包层 →
profile 用户层 → home 用户层 → launcher overlay），由 root Include 条目挂载。
一个**组合包（bundle）**就是一个 npm 包 + 一份 `dsh.bundle.patch`——loader
条目补丁列表，声明它贡献哪些行（insert）与行覆盖（id 定向 config/disabled）。

### 两条安装通道

| 维度 | profile 通道（默认） | workspace 通道（`channel: workspace`） |
| --- | --- | --- |
| 已安装真相 | profile package.json（dependencies + bundles） | ledger 条目 + 工作区 `.venv` |
| 安装动作 | 一次 pnpm add + bundles reconcile | file.copy + carrier pnpm install，零 profile 修改 |
| 组合单位 | 宿主 boot 时由 `loadProfile` 组合 | 运行时 per-workspace Include 子树 |
| 挂载位置 | 主 loader 树 | 独立 workspace loader（隔离子上下文） |
| disable/enable | profile `cordis.patch.yml` disable 块 | 补丁行 + ledger 标记 |
| 重启后 | 宿主原生恢复 | pm 服务 boot reconcile 从 ledger 重建 |
| 官方 CLI 视角 | `dsh plugin add/remove`、`--dump-config` 可见 | 不可见（仅 pm 运行时） |

### workspace 通道原理

一个插件工作区是 profile 组合的**缩小版**：

```text
<workspaceRoot>/<profile>/<id>/.venv/
  cordis.yml        # 组合根（空列表，每次挂载重写，镜像 prepareProfile）
  pkg/              # 物化源码快照
  package.json      # carrier：dependencies 声明 { <bundle>: "file:./pkg" }
  node_modules/     # pnpm install 结果——bundle 及其依赖在此可解析
```

挂载时，运行时创建 `cordis:include` 条目，`config.patches` 直接携带 bundle 的
`dsh.bundle.patch` 原文（每次 `structuredClone`，防 include 的 insert-aliasing
烤盘）。Include 把 `baseUrl` 锚到 `.venv`，补丁行里的裸包名从
`.venv/node_modules` 解析——与 profile 从自己的 node_modules 解析完全同构。
disable/enable 就是在补丁列表里增删 `{ id, disabled: true }` 行。卸载=移除
include 条目 + LIFO 回放 ledger 逆操作，`.venv` 随 `pluginEnv.create` 的逆操作
整体消失。重启后，pm 服务构造时异步 reconcile，从 ledger 重建全部子树。

### 故障隔离：workspace loader 子上下文

所有工作区 Include 挂在**独立的 Loader 服务实例**上：
`ctx.isolate('loader', 私有 label)` 创建子上下文，`wsCtx.plugin(Loader)` 把
第二个 loader 提供到私有隔离槽位（主 loader 不被覆盖）。只有 `'loader'` 一个
服务名被隔离，事件总线全局共享，因此：

- 工作区插件照常注册进共享的 tools/agents/... 服务，功能不受影响；
- 主 context 的监听器（client-modules registry）照样收到工作区行的事件；
- **行失败只污染 workspace loader 自己的 await()**——主 loader 树看不到这些
  行，宿主 boot、用户层 HMR 从不 await 它们。工作区炸了，主 context 照常
  打开和使用。

### 与宿主的关系

本包**不改宿主源码**：只消费宿主已提供的 Loader 与 `cordis:include` 机制，
所有状态（ledger、工作区文件、include 配置）都由本包自己读写。profile 通道
的 disable 块写在 profile `cordis.patch.yml`（宿主原生语义）；workspace 通道
完全不碰 profile 的任何文件。

## 工作方式

### 布局

```text
<workspaceRoot>/<profile>/<safe-id>/
  .venv/                  # 隔离依赖层：源码快照（pkg/）+ carrier + pnpm 依赖
  requirements/           # AI 生成的自定义 adapter（如有）
  package-manager.json    # 工作区 manifest：profile/id/source
  AGENTS.md               # 给 AI 会话的任务说明（AI 派发时写入）
```

`workspaceRoot` 默认为 `<home>/package-manager/plugin-workspaces`，可在设置页
修改或一键恢复默认。设置页默认进入全屏工作区布局：顶部路径栏带本地历史，
中间是插件卡片列表，底部固定链接输入栏与“派发给 AI 安装”。切换路径时，
如果目标目录包含 `requirements/deps.yaml`，包管理器会自动对齐插件集合：
安装缺失项，关闭多余项。

Git 与文件源会集中缓存到 `<home>/package-manager/runtime/packages`；同一个
git 源只需远程 clone 一次，后续工作区从本地 mirror clone，避免重复克隆。

### 安装与卸载

workspace 通道的 `dsh-bundle` 安装顺序：

```text
materialize source（git/file 源，npm 源 Phase 2）
  -> probe dsh.bundle.patch + validateBundleSource（装前校验：ESM、无
     workspace: 依赖、patch 可解析、入口产物存在）
  -> file.copy 源码到 .venv/pkg + file.write carrier package.json
  -> (allowBuild 时) pluginEnv.allowBuild.add + pnpm install（.venv 内）
  -> 运行时 mount：workspace loader 上创建 include 子树，config.patches =
     bundle patch 原文（每次 structuredClone；无模块钩子时裸包名改写为
     file URL 兜底）
  -> ledger 记录 steps（含逆操作），失败 LIFO 回滚
```

profile 通道的 `dsh-bundle` 安装顺序（兼容路径，与宿主 `dsh plugin` 同语义）：

```text
materialize source -> validateBundleSource
  -> 一次 pnpm add（profile 依赖）+ dsh.profile.bundles reconcile
  -> 运行时按稳定 id 把补丁行挂进主 loader（无 loader 时回退 import +
     ctx.plugin）
```

卸载顺序（两条通道一致）：

```text
热卸载（workspace：移除 include 条目；profile：从主 loader 移除条目）
  -> LIFO 回放 ledger 中记录的 inverse step
  -> 清理工作区/依赖残留
```

常规 `dsh-bundle` 安装/卸载不需要重启；只有 custom adapter、CLI 独立进程
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
| [docs/workspace-tree-design.md](docs/workspace-tree-design.md) | workspace 通道与隔离 loader 的设计 |
| [docs/workspace-tree-draft.md](docs/workspace-tree-draft.md) | 分阶段实施草案（Phase 1 已完成） |
| [docs/usage.md](docs/usage.md) | 日常使用：设置页、CLI、Web API、程序化 API、source spec、requirements 仓库 |
| [docs/ai-tools.md](docs/ai-tools.md) | AI 安装流程、`pm_install` / `pm_scaffold` 工具契约 |
| [docs/adapter-spec.md](docs/adapter-spec.md) | 自定义 adapter 的 step 词汇表、占位符、逆操作规则 |
| [docs/requirements-spec.md](docs/requirements-spec.md) | `requirements/deps.yaml` 字段、路径解析与校验 |
| [docs/cordis-design.md](docs/cordis-design.md) | 与 Cordis / DSH 论文相关工作的概念对应 |
| [docs/host-adapter.md](docs/host-adapter.md) | pnpm / git / shell 宿主适配器与 coeffect 映射 |
| [docs/development.md](docs/development.md) | 构建、测试与本地开发 |

## License

[MIT](LICENSE)。
