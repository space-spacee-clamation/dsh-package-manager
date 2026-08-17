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
- profile 与 pluginEnv step 的事务/回滚；
- Cordis 热挂载/卸载 runtime；
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



## 完整分层热挂载（profileComposer）

`src/cordisRuntime.ts` 优先探测宿主已有的 `profileComposer` 服务；没有时由
插件自身注入 `InjectedProfileComposer`：读取当前 profile 的 bundle 层 +
用户 patch，并用 boot include 的 patch 列表长度差保留 launcher overlay，
然后让 root Include 按稳定 id 增量 diff。没有 include（CLI/测试）时回退
到包管理器直接挂 patch 条目。