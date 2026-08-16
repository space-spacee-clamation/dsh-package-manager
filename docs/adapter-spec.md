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
| `profile.dependency.add` | `spec` | 在 profile 中 `pnpm add <spec>`，记录依赖名 |
| `profile.dependency.remove` | `packageName` | 在 profile 中 `pnpm remove <name>` |
| `profile.bundles.add` | `package` | 把包名追加到 `dsh.profile.bundles` |
| `profile.bundles.remove` | `package` | 从 `dsh.profile.bundles` 移除包名 |
| `profile.bundles.reconcile` | | 按已安装依赖自动补充 bundle 声明 |
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
