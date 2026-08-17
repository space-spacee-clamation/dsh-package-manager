# AI 安装与工具

## 入口

设置页“派发给 AI 安装”对应：

```text
POST /pm-api/ai-install
Content-Type: application/json
x-dsh-pm: 1

{ "source": "github:owner/repo", "profile": "web" }
```

响应：

```json
{
  "ok": true,
  "value": {
    "profile": "web",
    "id": "dsh-visualize",
    "source": "github:owner/repo",
    "workspaceId": "…",
    "workspacePath": "<workspaceRoot>/web/dsh-visualize",
    "sessionId": "session-…",
    "prompt": "你是 DSH 插件工作区的安装智能体…"
  }
}
```

服务端会：

1. 创建插件工作区并写入 `package-manager.json` / `AGENTS.md`；
2. 用 `workspaceRegistry` 注册该目录；
3. 创建 `cwd` 为工作区的 agent session；
4. `workspace.attachSession(sessionId)`；
5. 发送第一条安装指令。

前端历史记录通过宿主标准的 `session/created` 与 workspace 域事件自动更新，
无需额外客户端代码。

## 工具

`package-manager-tools` loader 行注册三个全局工具：

### `pm_install`

- 只接受包管理器创建的插件工作区会话调用；
- 来源固定从工作区 `package-manager.json` 读取，不接受模型任意指定 URL；
- 参数：
  - `adapter`: `auto`（默认）/ `dsh-bundle` / `custom`
  - `adapterDir`: custom adapter 目录
  - `ref`: 可选 git ref
  - `allowBuild`: 是否允许 `.venv` 内 pnpm build script
- 安装在本进程内执行，`dsh-bundle` 插件因此能立即 Cordis 热挂载。

### `pm_switch_workspace`

- 切换 `workspaceRoot` 并按目标目录的 `requirements/deps.yaml`（或根目录
  `deps.yaml`）对齐插件集合；
- 目标声明但未安装 → 安装；已安装但 spec 变化 → 更新；目标未声明 →
  卸载（包括目标文件完全没有的 profile）；
- 目标目录没有 requirements 文件时只切换根目录，不动已安装集合；
- 参数：
  - `path`: 目标工作区根目录，空字符串 = 默认根目录
  - `dryRun`: 只输出 diff，不实际执行。

### `pm_scaffold`

- 为没有 `dsh.bundle.patch` 的插件生成：

```text
<workspace>/requirements/deps.yaml
<workspace>/requirements/adapters/<id>/adapter.yaml
```

- AI 补全 adapter 后再次调用 `pm_install`，传入 `adapterDir`。

## 工作区 manifest

`package-manager.json`：

```json
{
  "version": 1,
  "profile": "web",
  "id": "anchored-standard",
  "source": "https://github.com/xiaobright/dsh-anchored-standard.git",
  "createdAt": "…"
}
```

工具执行前会校验 session cwd 下存在该 manifest；没有 manifest 的普通会话不能
调用安装工具。
