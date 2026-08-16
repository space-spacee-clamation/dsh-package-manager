# requirements-spec

`deps.yaml` 是机器可复原的依赖声明。`restore` 会把它与 ledger 中的已安装
状态按 id 求最小差集；`sync` 默认读取 `<repo>/requirements/deps.yaml`。

## 顶层字段

```yaml
version: 1            # 必填，当前唯一支持 1
repo: .               # 可选，requirements 仓库根；默认 .
modes:                # 必填：profile 名 -> 插件列表（可为空）
  web: []
```

- `repo` 保留给仓库级操作（如 sync），当前解析不强制校验。
- `modes` 的 key 是 profile 名，值必须是列表。

## entry 字段

```yaml
- id: my-plugin               # 必填，profile 内唯一，稳定主键
  source: github:o/r          # 必填，git/npm/本地目录/file: 均可
  adapter: auto               # 可选：auto | dsh-bundle | custom，默认 auto
  adapterDir: adapters/my     # custom 时必填；相对 deps.yaml 所在目录解析
  ref: main                   # 可选：git 分支/tag/commit，默认远端默认分支
  allowBuild: false           # 可选：是否允许该 git 依赖的 pnpm build script
```

`adapter` 规则：

- `dsh-bundle`：源码包 `package.json` 里声明 `dsh.bundle.patch`，走
  `pnpm add` + bundle reconcile。
- `custom`：使用 `adapterDir` 指向的 `adapter.yaml`。
- `auto`：探测源码；有 bundle 声明按 dsh-bundle，否则要求提供 custom
  adapter（通常先用 `adapter-init` 生成）。

## 路径解析

- `adapterDir` 相对 `deps.yaml` 所在目录解析；绝对路径原样使用。
- 因此推荐布局是：

```text
<repo>/requirements/deps.yaml
<repo>/requirements/adapters/<id>/adapter.yaml
```

## 示例

```yaml
version: 1
repo: .
modes:
  web:
    - id: visualize
      source: github:o/dsh-visualize
      adapter: auto
    - id: anchored-standard
      source: https://github.com/xiaobright/dsh-anchored-standard.git
      adapter: custom
      adapterDir: adapters/anchored-standard
      allowBuild: false
  headless: []
```

## 校验错误

解析失败会立即抛错并包含路径（如 `modes.web[0].adapter`），不会静默跳过。
