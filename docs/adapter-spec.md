# adapter-spec

自定义 adapter 是放在 requirements 仓库里的声明式 YAML。安装时顺序执行
`install`，随后执行 `verify`；任一步失败都会按已记录逆操作 LIFO 回滚。
成功安装后，ledger 保存每次执行记录的逆操作，卸载时自动重放。

## 文件结构

```yaml
id: my-plugin          # 必填，非空字符串

install:               # 至少一个 step；缺失或空列表会报错
  - uses: file.copy
    from: ${DSH_WORKDIR}/source/README.md
    to: ${DSH_HOME}/plugins/my-plugin/README.md

verify:                # 可选；每个 step 必须以退出码 0 表示通过
  - uses: check
    run: node -e "process.exit(0)"

uninstall: []          # 可选；额外卸载 step。安装记录的逆操作会自动重放，
                       # 这里只放那些无法由逆操作表达的一次性清理。
```

## 占位符

adapter 加载时，在解析相对路径之前展开以下占位符：

| 占位符 | 含义 |
| --- | --- |
| `${DSH_HOME}` | harness home（`$DSH_HOME` 或 `~/.dsh`） |
| `${DSH_PROFILE}` | 当前 profile 目录 `<home>/profiles/<name>` |
| `${DSH_WORKDIR}` | 本次安装的工作目录；git/file 源码被 materialize 到 `<workdir>/source` |
| `${DSH_WORKSPACE}` | 插件专属工作区（AI 会话 cwd） |
| `${DSH_PLUGIN_ENV}` | 工作区内的隔离依赖层 `<workspace>/.venv` |

`env` 映射中的字符串值同样会展开。未知的 `${NAME}` 保持不变，交给 shell
处理。请始终用这些占位符表达 home/profile/workdir，不要写死绝对路径。

## 路径锚定

`from`、`to`、`backup`、`path`、`cwd` 若为相对路径，会先展开占位符，再
相对 `adapter.yaml` 所在目录解析。绝对路径原样使用。

## step 词汇表

| uses | 字段 | 说明 |
| --- | --- | --- |
| `noop` | | 什么都不做 |
| `profile.dependency.add` | `spec` | 优先用现有 `dsh plugin --profile <name> add <spec>` 在 profile 加依赖并同步 bundle；没有 `dsh` 时回退 `pnpm add`。记录依赖名 |
| `profile.dependency.remove` | `packageName` | 优先用现有 `dsh plugin --profile <name> remove <name>`；没有 `dsh` 时回退 `pnpm remove` |
| `profile.bundles.add` | `package` | 把包名追加到 `dsh.profile.bundles` |
| `profile.bundles.remove` | `package` | 从 `dsh.profile.bundles` 移除包名 |
| `profile.bundles.removeMany` | `packages: string[]` | 从 `dsh.profile.bundles` 批量移除包名（reconcile 未声明 packageName 时的自动逆操作） |
| `profile.bundles.reconcile` | `packageName?` | 按已安装依赖自动补充 bundle 声明；逆操作只移除本次实际添加的行（声明了 `packageName` 就只移除那一行，否则移除全部本次添加的行） |
| `profile.bundles.set` | `bundles: string[]` | 整体替换 bundle 列表 |
| `profile.allowBuild.add` | `package` | 把包名追加到 pnpm `allowBuilds` |
| `profile.allowBuild.set` | `packages: string[]`, `dir?` | 整体替换 allowBuilds；`dir` 缺省为 profile 目录 |
| `pluginEnv.create` | `path` | 创建隔离 `.venv` 目录；逆操作为整体移除 |
| `pluginEnv.remove` | `path` | 把目录移入备份（内部逆操作） |
| `pluginEnv.restore` | `backup`, `to` | 从备份恢复目录（内部逆操作） |
| `pluginEnv.allowBuild.add` | `dir`, `package` | 把包名追加到指定目录的 pnpm `allowBuilds` |
| `pnpm` | `args: string[]`, `cwd`, `unargs?: string[]` | 在 `cwd` 执行 `pnpm <args>`；`unargs` 为空时逆操作为 noop（由 `.venv` 整体移除兜底） |
| `file.copy` | `from`, `to` | 复制文件或整个目录（目录复制会排除 `.git`） |
| `file.write` | `path`, `content` | 写入文本文件 |
| `file.remove` | `path` | 删除文件或目录；缺失视为成功 |
| `file.restore` | `backup`, `to` | 从备份恢复到目标（内部逆操作） |
| `command` | `run`, `unrun`, `cwd?`, `env?` | 执行 shell 命令；`unrun` 是逆命令 |
| `check` | `run`, `cwd?`, `env?` | 执行验证命令，退出码非 0 视为失败 |

所有 step 必须提供表中列出的字符串字段；`command` / `check` 的 `env` 是
字符串值到字符串值的映射。`cwd` 缺省为 profile 目录。

## 逆操作与回滚

- 包管理器不信任单独编写的 uninstall 脚本：每个 `install` step 在执行时
  记录显式 inverse。
- `file.copy`/`file.write` 会备份被覆盖的旧文件或旧目录；不存在的新目标则
  逆操作为 `file.remove`。
- `command` 的逆操作是交换 `run` 与 `unrun` 的 `command`。
- 失败回滚按 LIFO 执行，任一逆操作失败仍继续清扫其余步骤，最后汇总报错。
- `uninstall` 段仅在已记录逆操作全部重放后执行，适合放额外清理。

## 建议写法

- 自定义 adapter 中优先复用包管理器已经 materialize 到
  `${DSH_WORKDIR}/source` 的源码，避免再 clone 一次。
- 把插件依赖放进 `${DSH_PLUGIN_ENV}`；不要把全局依赖直接写进 profile。
- 验证用 `check` + `node -e` 或平台无关命令；不要写 `rmdir /s /q` 这类
  绑定单个平台的逆命令。
- **profile 依赖用 `file:` 指向 staging 拷贝，不要把 `.venv` 本身直接
  `file:`/`link:` 给 profile**。两个原因：
  1. `link:` 指向工作区 `.venv`，目录被清理后变成悬空软链，宿主 boot 时
     解析 bundles 行 fail-loud，**整个 profile 起不来**；
  2. `file:` 直接指向 `.venv` 时，pnpm 要复制 `.venv` 内部 node_modules 的
     依赖链接，Windows 无符号链接权限时 `ERR_PNPM_EPERM` 直接失败。
  正确写法（staging 模式）：`file.copy` 会把 `node_modules` 与 `.git` 从
  递归拷贝中排除，所以先把构建产物拷进 staging 目录再喂给 profile：

  ```yaml
  - uses: file.copy
    from: ${DSH_PLUGIN_ENV}
    to: ${DSH_WORKSPACE}/stage
  - uses: profile.dependency.add
    spec: 'file:${DSH_WORKSPACE}/stage'
    packageName: '@scope/pkg'
  ```

  staging 树没有依赖链接，pnpm 复制永不 EPERM；profile 持有的是 pnpm store
  里的真实拷贝，工作区被清理也不会悬空。
- 卸载必须能清干净：`profile.dependency.remove` 会自动清除悬空软链；
  `profile.bundles.reconcile` 的逆操作会自动移除它本次添加的 bundle 行，
  无需在 `uninstall` 段手写清理。

## 修复命令

宿主的 profile 组合对"bundle 行解析不到"是 fail-loud 的（boot 直接失败）。
如果 profile 已经坏了（历史残留），先跑：

```bat
dpm doctor
```

它会：移除依赖已消失且无法解析的 bundle 行、删除悬空的 node_modules 软链、
丢弃 ledger 里的 stale 记录。workspace 切换前也会自动执行同样的修复。

## 带 Web 界面的插件（client 行）

宿主（deepseek-harness）的 client-modules registry 扫描 Loader 事件增量出图，
`dsh.client.platform` 必须是 `'web'`，客户端产物由 `./client` 导出（默认
`lib/client.js`，需先构建）。热激活 client 行的宿主原生做法是往 profile 或
home 的 `cordis.patch.yml` 追加 insert 行——宿主 watch 该文件并即时重组。
custom adapter 的等价写法：

```yaml
install:
  - uses: profile.dependency.add
    spec: file:${DSH_WORKDIR}/source
  - uses: file.write
    path: ${DSH_PROFILE}/cordis.patch.yml
    content: |-
      - insert:
          - id: my-plugin-client
            name: my-plugin
```

注意：dsh-bundle 插件不要用这个模式（bundle 层已声明行，重复 insert 会在
下次启动双重组合）；该模式只用于没有 `dsh.bundle.patch`、仅带 client 面的
普通插件。宿主对"同一包名曾经没有 client 面"的判定有缓存（重启才失效），
同名重装改变 client 面时需要重启 host。
