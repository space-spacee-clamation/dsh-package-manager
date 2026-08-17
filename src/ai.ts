/**
 * AI dispatch: one settings action turns a plugin link into a live agent
 * session. The session's cwd is the per-plugin workspace; the workspace is
 * registered with `ctx.workspaceRegistry`, and the created session is attached
 * to it, so the frontend history/sidebar receives it through the normal
 * host/workspace and session/created live event streams. The first prompt
 * points the model at the `pm_install` / `pm_scaffold` tools registered by
 * this package's `./tools` row, keeping installation in-process (and therefore
 * hot-pluggable through Cordis).
 * @module @dsh-ext/dsh-package-manager/ai
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { idFromSource, type PackageManager } from './manager.ts'
import { ensurePluginWorkspace } from './pluginWorkspace.ts'
import type { AiInstallRequest, AiInstallResult } from './types.ts'

const AGENTS_FILE = 'AGENTS.md'

export async function dispatchAiInstall(
  ctx: Context,
  manager: PackageManager,
  request: AiInstallRequest,
): Promise<AiInstallResult> {
  const agents = ctx.root.get('agents') as AgentRegistry | undefined
  if (agents === undefined) {
    throw new Error('AI install is unavailable: this deployment mounts no dsh-agent registry')
  }
  const workspaceRegistry = ctx.root.get('workspaceRegistry') as WorkspaceRegistry | undefined
  if (workspaceRegistry === undefined) {
    throw new Error('AI install is unavailable: this deployment mounts no dsh-workspace registry')
  }

  const source = request.source.trim()
  if (source === '') throw new Error('plugin source link must not be empty')
  const profile = (request.profile ?? inferProfile(manager)).trim()
  const id = idFromSource(source)

  const workspaceDir = ensurePluginWorkspace(manager.workspaceRoot(), profile, id, source)
  writeAgentsFile(workspaceDir, profile, id, source)

  const workspace = await workspaceRegistry.resolveByPath(workspaceDir)
    ?? await workspaceRegistry.create(workspaceDir, `插件 · ${id}`)
  const sessionId = SessionId(request.sessionId ?? `session-${randomUUID()}`)
  const handle = await agents.create({
    sessionId,
    meta: { cwd: workspaceDir },
  })

  try {
    await workspace.attachSession(handle.agent.id)
  } catch (error) {
    await handle.dispose()
    throw new Error(`AI install session was created but could not attach to workspace ${workspace.path}: ${messageOf(error)}`)
  }

  const prompt = buildPrompt(profile, id, source, workspaceDir)
  handle.agent.followup(createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'plugin', plugin: 'dsh-package-manager' },
  }))

  return {
    profile,
    id,
    source,
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    sessionId: String(handle.agent.id),
    prompt,
  }
}

function inferProfile(manager: PackageManager): string {
  const profiles = manager.state().profiles.map(item => item.name)
  return profiles.includes('web') ? 'web' : profiles[0] ?? 'web'
}

function buildPrompt(profile: string, id: string, source: string, workspaceDir: string): string {
  return [
    '你是 DSH 插件工作区的安装智能体。你的 cwd 就是这个插件的专属工作区。',
    '',
    `任务：安装插件 "${id}"`,
    `来源：${source}`,
    `目标 profile：${profile}`,
    `工作区：${workspaceDir}`,
    '',
    '约束：产出的插件包必须遵守宿主 harness 的包规范（docs/cookbook/adding-a-package.zh.md）：',
    'ESM（type: module）、入口与 exports 指向已构建的 lib/ 产物、内部依赖不得使用 workspace: 协议',
    '（只发布 registry 版或自包含构建）、带 UI 的插件需声明 dsh.client 并构建 lib/client.js。',
    '',
    '安装步骤：',
    '1. 调用 `pm_install` 工具执行安装（无需参数，来源从工作区 manifest 读取）。该工具由当前进程内的包管理器执行，',
    '   dsh-bundle 插件安装完成后会立即通过 Cordis 热挂载，不需要重启。',
    '2. 如果 `pm_install` 返回错误说该插件需要自定义 adapter：',
    '   a. 调用 `pm_scaffold` 生成 adapter 骨架；',
    '   b. 阅读本目录 `requirements/adapters/<id>/adapter.yaml`，补全 install/uninstall/verify 步骤；',
    '      每一个 install 步骤都必须有显式逆操作（包管理器按 LIFO 回放，卸载不依赖单独脚本）；',
    '   c. 再次调用 `pm_install`，并传入该 adapter 目录。',
    '3. dsh-bundle 由包管理器直接安装为 profile 依赖并热挂载；custom adapter 的依赖只允许安装在 `' + join(workspaceDir, '.venv') + '` 内，禁止直接修改全局 profile。',
    '4. 完成后报告：安装方式（内置/custom adapter）、是否已热挂载、以及用户如何验证。',
  ].join('\n')
}

function writeAgentsFile(workspaceDir: string, profile: string, id: string, source: string): void {
  const text = [
    '# 插件安装任务',
    '',
    `- 插件 id: ${id}`,
    `- 来源: ${source}`,
    `- 目标 profile: ${profile}`,
    '',
    '优先调用 `pm_install` 工具；需要自定义 adapter 时调用 `pm_scaffold`，',
    '补全 adapter 后再次调用 `pm_install`。依赖统一放在 `.venv/` 中。',
    '',
    '包规范：ESM（type: module）、入口指向已构建产物、不用 workspace: 协议、',
    '带 UI 的插件需声明 dsh.client 并构建 lib/client.js（见宿主 docs/cookbook/adding-a-package.zh.md）。',
    '',
  ].join('\n')
  writeFileSync(join(workspaceDir, AGENTS_FILE), text)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
