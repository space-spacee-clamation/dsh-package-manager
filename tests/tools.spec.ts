import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createPackageManager } from '../src/manager.ts'
import { ensurePluginWorkspace } from '../src/pluginWorkspace.ts'
import { apply, name } from '../src/tools.ts'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-tools-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('package-manager AI tools', () => {
  it('registers pm_install and pm_scaffold for the tools runtime', () => {
    const home = tempDir()
    const manager = createPackageManager({ home })
    const registered: ToolDefinition[] = []
    const ctx = {
      packageManager: { manager, install: (request: never) => manager.install(request), adapterInit: (request: never) => manager.adapterInit(request) },
      tools: { register: vi.fn((definition: ToolDefinition) => { registered.push(definition) }) },
    }
    apply(ctx as never)
    expect(name).toBe('package-manager-tools')
    expect(registered.map(definition => definition.name).sort()).toEqual(['pm_install', 'pm_restart_backend', 'pm_scaffold', 'pm_switch_workspace'])
  })

  it('pm_scaffold only acts on package-manager plugin workspaces', async () => {
    const home = tempDir()
    const manager = createPackageManager({ home })
    const registered: ToolDefinition[] = []
    const ctx = {
      packageManager: { manager, install: (request: never) => manager.install(request), adapterInit: (request: never) => manager.adapterInit(request) },
      tools: { register: vi.fn((definition: ToolDefinition) => { registered.push(definition) }) },
    }
    apply(ctx as never)
    const scaffold = registered.find(definition => definition.name === 'pm_scaffold')
    expect(scaffold).toBeDefined()
    const plain = join(home, 'plain')
    mkdirSync(plain, { recursive: true })
    writeFileSync(join(plain, 'package.json'), JSON.stringify({ name: 'plain-plugin', version: '1.0.0' }))
    const workspace = ensurePluginWorkspace(manager.workspaceRoot(), 'web', 'plain', plain)
    const result = await scaffold!.execute({}, { agent: { session: { header: { cwd: workspace } } }, signal: new AbortController().signal } as never) as {
      ok: boolean
      adapter: string
      adapterDir: string
    }
    expect(result.ok).toBe(true)
    expect(result.adapter).toBe('custom')
    expect(result.adapterDir).toBe(join(workspace, 'requirements', 'adapters', 'plain'))

    await expect(scaffold!.execute({}, {
      agent: { session: { header: { cwd: home } } },
      signal: new AbortController().signal,
    } as never)).rejects.toThrow('package-manager plugin workspace')
  })
})
