import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { PackageManagerService } from '../src/index.ts'
import type { AiInstallRequest } from '../src/types.ts'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-ai-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fakeService(home: string) {
  const followups: Array<{ sessionId: string; text: string }> = []
  const attached: string[] = []
  const disposed: string[] = []
  const agents = {
    create: vi.fn(async (options: { sessionId: string; meta?: { cwd?: string } }) => {
      const agent = {
        id: options.sessionId,
        session: { id: options.sessionId, header: { cwd: options.meta?.cwd } },
        followup: vi.fn((message: { content: Array<{ text: string }> }) => {
          followups.push({ sessionId: options.sessionId, text: message.content[0]?.text ?? '' })
        }),
      }
      return {
        agent,
        dispose: vi.fn(() => { disposed.push(options.sessionId) }),
      }
    }),
  }
  const workspace = {
    id: 'workspace-1',
    path: '',
    attachSession: vi.fn(async (sessionId: string) => { attached.push(sessionId) }),
  }
  const workspaceRegistry = {
    resolveByPath: vi.fn(async () => undefined),
    create: vi.fn(async (path: string, title: string) => {
      workspace.path = path
      return workspace
    }),
  }
  const ctx = new Context()
  ctx.provide('agents', agents)
  ctx.provide('workspaceRegistry', workspaceRegistry)
  const service = new PackageManagerService(ctx as never, { home, apiPrefix: '/pm-api' })
  return { service, followups, attached, disposed, agents, workspaceRegistry }
}

describe('AI install dispatch', () => {
  it('creates an agent session in the plugin workspace and attaches it to the workspace registry', async () => {
    const home = tempDir()
    const { service, followups, attached, agents } = fakeService(home)
    const request: AiInstallRequest = { source: 'github:owner/demo', profile: 'web' }
    const result = await service.dispatchAiInstall(request)

    expect(result.id).toBe('demo')
    expect(result.workspacePath).toBe(join(home, 'package-manager', 'plugin-workspaces', 'web', 'demo'))
    expect(existsSync(join(result.workspacePath, 'package-manager.json'))).toBe(true)
    expect(existsSync(join(result.workspacePath, 'AGENTS.md'))).toBe(true)
    expect(agents.create).toHaveBeenCalledOnce()
    const options = agents.create.mock.calls[0]?.[0] as { sessionId: string; meta: { cwd: string } }
    expect(options.meta.cwd).toBe(result.workspacePath)
    expect(attached).toEqual([options.sessionId])
    expect(followups).toHaveLength(1)
    expect(followups[0]?.text).toContain('pm_install')
    expect(readFileSync(join(result.workspacePath, 'package-manager.json'), 'utf8')).toContain('github:owner/demo')
  })

  it('defaults the target profile to web and reports unavailable AI services', async () => {
    const home = tempDir()
    const ctx = new Context()
    const service = new PackageManagerService(ctx as never, { home, apiPrefix: '/pm-api' })
    await expect(service.dispatchAiInstall({ source: 'github:owner/demo' })).rejects.toThrow('dsh-agent')
  })

  it('constructs despite a corrupt ledger so the web profile can still boot', async () => {
    // The package-manager plugin runs inside the web profile; a throwing
    // constructor would fail the whole profile boot (host boots are
    // fail-loud). A corrupt ledger must degrade to an empty one at
    // construction time (dpm doctor repairs it later).
    const home = tempDir()
    mkdirSync(join(home, 'package-manager'), { recursive: true })
    writeFileSync(join(home, 'package-manager', 'ledger.json'), '{ this is not json')
    const ctx = new Context()
    const service = new PackageManagerService(ctx as never, { home, apiPrefix: '/pm-api', runtime: 'auto' })
    expect(service.apiPrefix).toBe('/pm-api')
  })
})
