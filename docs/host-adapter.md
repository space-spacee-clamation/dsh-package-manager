# 进程宿主适配器

## 为什么需要这一层

论文中的 coeffect 思路是：组件不直接抓取 `git` / `pnpm` / shell，而是**声明能力**，
由上下文提供实现。Cordis 教程第 3 章给出同一模式：

- 硬依赖：`inject: ['subprocess']`，服务不在则插件保持 PENDING；
- 可选依赖：`ctx.get('subprocess')`，服务不在则插件降级运行。

包管理器的指令依赖只有三种能力：

```text
pnpm    安装/卸载包依赖
git     clone / pull / remote 操作
shell   自定义 adapter 的 command / check step
```

旧实现直接在 core 内 `spawnSync('pnpm')`、`spawnSync('git')`、`spawnSync(command,
{ shell })`，因此 CLI、Web、headless、容器环境共用同一套本地 PATH 假设，也无法
复用 harness 的执行世界（scrub 环境、进程树管理、输出上限）。

## 适配器接口

```ts
export interface PackageManagerHost {
  readonly name: string
  pnpm(args, cwd, env): Promise<SpawnResult>
  git(args, cwd): Promise<SpawnResult>
  shell(command, cwd, env): Promise<SpawnResult>
}
```

core 只依赖这三个方法，不关心实现来自哪里。

## 内置实现

| 实现 | 行为 |
| --- | --- |
| `LocalHost` | 当前机器 PATH + 本地进程；CLI、测试和无 harness 部署的默认值 |
| `HarnessHost` | 通过 `ctx.get('subprocess')` 解析可执行文件并 spawn；继承 harness 的 scrub 环境、bounded output、进程树清理；服务不存在或命令解析失败时回退 `LocalHost` |

`PackageManagerService` 构造时：

```ts
new PackageManager({
  host: createHost(ctx), // ctx.subprocess 存在则 HarnessHost，否则 LocalHost
})
```

CLI 没有 Cordis Context，因此 `createHost()` 直接返回 `LocalHost`。热装卸
不经过任何 runtime 对象：dsh-bundle 的托管块写入 profile
`cordis.patch.yml`，由宿主 `watchUserPatches` 完成 Loader diff。

## 与 coeffect 的对应

| coeffect | 包管理器实现 |
| --- | --- |
| 能力声明 | `PackageManagerHost.pnpm / git / shell` |
| 上下文提供实现 | `PackageManagerService` 从 `ctx.get('subprocess')` 选择宿主 |
| 提供方缺席时降级 | `HarnessHost` 回退 `LocalHost` |
| 组件不依赖具体提供方 | `manager.ts` 只 import `createHost`，不 import `dsh-subprocess-local` |

## 后续环境适配

新增环境只需要实现 `PackageManagerHost`：

- 容器内：把 `pnpm` / `git` 路由到容器 CLI；
- 远程开发机：把能力路由到远端进程；
- 受限沙箱：用 harness 自己的 `ctx.shell` 或沙箱 policy；
- CI：用带缓存的 runner。

安装/卸载/回滚逻辑无需改动。
