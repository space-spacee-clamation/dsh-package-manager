import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { CordisRuntime } from '../src/runtime.ts'
import type { LedgerEntry } from '../src/types.ts'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-runtime-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function entry(packageName: string): LedgerEntry {
  return {
    id: 'hot-fixture',
    profile: 'web',
    source: packageName,
    sourceKind: 'npm',
    ref: '',
    adapter: 'dsh-bundle',
    adapterDir: '',
    packageName,
    materializedDir: '',
    resolvedCommit: '',
    steps: [],
    spec: { source: packageName, adapter: 'dsh-bundle', adapterDir: '', ref: '' },
    installedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
}

describe('CordisRuntime hot plug', () => {
  it('mounts a plugin through ctx.plugin and unmounts it by disposing the fiber', async () => {
    const code = `
      globalThis.__dshHotEvents = []
      export default {
        name: 'hot-fixture',
        apply(ctx) {
          globalThis.__dshHotEvents.push('apply')
          ctx.effect(() => {
            globalThis.__dshHotEvents.push('effect')
            return () => { globalThis.__dshHotEvents.push('dispose') }
          }, 'hot-fixture: effect')
        },
      }
    `
    const specifier = `data:text/javascript,${encodeURIComponent(code)}`
    const ctx = new Context()
    const runtime = new CordisRuntime(ctx)
    const target = entry(specifier)

    const mounted = await runtime.mount(target)
    expect(mounted.mounted).toBe(true)
    const events = (globalThis as Record<string, unknown>).__dshHotEvents as string[]
    expect(events).toContain('apply')
    expect(events).toContain('effect')

    const unmounted = await runtime.unmount(target)
    expect(unmounted.mounted).toBe(true)
    expect(events).toContain('dispose')

    const again = await runtime.unmount(target)
    expect(again.mounted).toBe(false)
  })

  it('resolves a package through the target profile node_modules when profileDir is recorded', async () => {
    const profileDir = tempDir()
    const root = join(profileDir, 'node_modules', 'profile-fixture')
    mkdirSync(join(root, 'lib'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'profile-fixture', version: '1.0.0', type: 'module', main: 'lib/index.js' }))
    writeFileSync(join(root, 'lib', 'index.js'), `
      globalThis.__dshProfileHotEvents = []
      export default {
        name: 'profile-fixture',
        apply(ctx) {
          globalThis.__dshProfileHotEvents.push('profile-apply')
          ctx.effect(() => {
            globalThis.__dshProfileHotEvents.push('profile-effect')
            return () => { globalThis.__dshProfileHotEvents.push('profile-dispose') }
          }, 'profile-fixture: effect')
        },
      }
    `)
    const ctx = new Context()
    const target = entry('profile-fixture')
    target.profileDir = profileDir
    const runtime = new CordisRuntime(ctx)

    const mounted = await runtime.mount(target)
    expect(mounted.mounted).toBe(true)
    const events = (globalThis as Record<string, unknown>).__dshProfileHotEvents as string[]
    expect(events).toContain('profile-apply')
    await runtime.unmount(target)
    expect(events).toContain('profile-dispose')
  })

  it('refuses non-bundle entries', async () => {
    const ctx = new Context()
    const target = entry('whatever')
    target.adapter = 'custom'
    const result = await new CordisRuntime(ctx).unmount(target)
    expect(result.mounted).toBe(false)
    expect(result.reason).toContain('not a hot-loadable')
  })
})
