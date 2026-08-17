# 开发

## 命令

```bash
pnpm install
pnpm run typecheck   # tsc -p tsconfig.json && tsc -p tsconfig.client.json
pnpm run test        # vitest run
pnpm run build       # tsdown
pnpm run check       # typecheck + test + build
```

## 构建产物

| 路径 | 内容 |
| --- | --- |
| `lib/index.js` / `lib/index.d.ts` | Node 侧：`PackageManagerService`、core API、AI dispatch、类型 |
| `lib/web.js` / `lib/web.d.ts` | Web 路由：`/pm-api/*` |
| `lib/tools.js` / `lib/tools.d.ts` | AI 工具行：`pm_install` / `pm_scaffold` / `pm_switch_workspace` |
| `lib/client.js` | 浏览器侧：Settings 页面 |
| `bin/dpm.mjs` | 独立 CLI |
| `cordis.patch.yml` | bundle patch：注入三个 loader 行 |

`cordis.patch.yml` 注入：

```text
package-manager        核心服务（所有 profile 可用）
package-manager-tools  注册 pm_install / pm_scaffold / pm_switch_workspace（依赖 tools 服务）
package-manager-web    挂载 /pm-api/*（依赖 webServer）
```

## 测试覆盖

- requirements 解析与 diff plan；
- profile 与 custom adapter step 的事务/回滚；
- **官方热重载验收**：测试直接复刻 `watchUserPatches` 的 root Include
  `config.patches` 更新，验证托管块增删/disabled 行的热挂载、热禁用、热启用、
  热卸载；
- AI dispatch（workspace + session 创建与 attach）；
- AI 工具注册与执行；
- `adapter-init → restore → uninstall` 端到端流程。

## 本地调试

```bash
# 在目标 profile 中链接本地源码
cd <home>/profiles/web
pnpm add "link:/path/to/dsh-package-manager"
pnpm install

# 直接跑 CLI
node /path/to/dsh-package-manager/bin/dpm.mjs state
```

浏览器侧构建后由 harness 以 `/plugins/<id>/client.js` 提供；开发时可刷新页面
观察 client-hmr。



## 热重载实现（只写 cordis.patch.yml）

- `src/profilePatch.ts` 负责 profile `cordis.patch.yml` 托管块的写入、删除、
  禁用行生成与 `!!js` 表达式 round-trip；用户原有注释与补丁行保持不变。
- `src/manager.ts` 的 dsh-bundle 路径：
  `pnpm add 依赖 -> 从 bundle patch 生成托管块 -> 写 profile cordis.patch.yml`。
  之后无需任何 Loader 调用：宿主 `watchUserPatches` 会解析文件并更新 root
  Include 的 `config.patches`。
- 卸载先删托管块（热卸载），再回放 profile 依赖/allowBuild 逆操作。
- `disable/enable` 只重写同一托管块，在末尾增删 `{ id, disabled: true }`
  补丁行，安装依赖保持不变。
- 本包不把 dsh-bundle 写入 `dsh.profile.bundles`：托管块是补丁行的唯一
  所有者，重启后也由用户层挂载，不会双重组合同一批行。
