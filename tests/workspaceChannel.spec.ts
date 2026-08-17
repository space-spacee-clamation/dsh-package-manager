import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPackageManager } from '../src/manager.ts'
import { readManifest } from '../src/profile.ts'
import type { LedgerEntry, PackageManagerRuntime, RuntimeMountResult } from '../src/types.ts'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-ws-channel-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A built bundle source: package.json declares the patch and a built lib/ entry. */
function makeBundleSource(dir: string): string {
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'fixture-bundle',
    version: '1.0.0',
    type: 'module',
    main: 'lib/index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(dir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: fixture-row',
    '      name: fixture-bundle',
  ].join('\n'))
  writeFileSync(join(dir, 'lib', 'index.js'), "export default { name: 'fixture-bundle', apply() {} }\n")
  return dir
}

describe('PackageManager workspace channel', () => {
  it('installs into the plugin .venv, mounts via the workspace runtime, and never touches the profile manifest', async () => {
    const home = tempDir()
    const source = makeBundleSource(join(home, 'fixture-src'))

    // Mock pnpm: the carrier install links .venv/pkg into .venv/node_modules,
    // which is what the workspace include's bare-name rows resolve from.
    const pnpm = async (args: string[], cwd: string) => {
      if (args[0] === 'install') {
        const pkg = join(cwd, 'pkg')
        const installed = join(cwd, 'node_modules', 'fixture-bundle')
        if (!existsSync(installed)) cpSync(pkg, installed, { recursive: true })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    const calls: string[] = []
    const runtime: PackageManagerRuntime = {
      channel: 'workspace',
      composesProfile: false,
      async mount(_entry: LedgerEntry): Promise<RuntimeMountResult> { calls.push('mount'); return { mounted: true, reason: 'stub' } },
      async unmount(_entry: LedgerEntry): Promise<RuntimeMountResult> { calls.push('unmount'); return { mounted: true, reason: 'stub' } },
      async setDisabled(_entry: LedgerEntry, disabled: boolean): Promise<RuntimeMountResult> {
        calls.push('setDisabled:' + String(disabled))
        return { mounted: true, reason: 'stub' }
      },
    }

    const manager = createPackageManager({ home, pnpm, runtime })

    const installed = await manager.install({
      profile: 'web',
      id: 'fixture',
      source,
      adapter: 'dsh-bundle',
      channel: 'workspace',
    })
    expect(installed.channel).toBe('workspace')
    expect(installed.hotMounted).toBe(true)
    expect(calls).toContain('mount')

    // The profile manifest is untouched by the install: the template bundles
    // exist (profile init), but no fixture dependency and no fixture bundle row.
    const manifest = readManifest(join(home, 'profiles', 'web'))
    expect(manifest.dependencies?.['fixture-bundle']).toBeUndefined()
    expect(manifest.dsh?.profile?.bundles ?? []).not.toContain('fixture-bundle')

    // The workspace env carries the source and the resolvable install.
    const envDir = installed.pluginEnvDir
    expect(existsSync(join(envDir, 'pkg', 'cordis.patch.yml'))).toBe(true)
    expect(existsSync(join(envDir, 'node_modules', 'fixture-bundle', 'package.json'))).toBe(true)
    expect(readFileSync(join(envDir, 'package.json'), 'utf8')).toContain('fixture-bundle')
    expect(manager.state().restartNeeded).toBe(false)

    // Disable/enable toggle the ledger flag through the runtime.
    await manager.disable({ profile: 'web', id: 'fixture' })
    expect(calls).toContain('setDisabled:true')
    expect(manager.state().entries.map(entry => entry.id)).toContain('fixture')
    expect(manager.state().entries.find(entry => entry.id === 'fixture')?.disabled).toBe(true)
    expect(manager.state().disabled).toEqual([])

    await manager.enable({ profile: 'web', id: 'fixture' })
    expect(calls).toContain('setDisabled:false')
    expect(manager.state().entries.find(entry => entry.id === 'fixture')?.disabled).toBe(false)

    // Uninstall unmounts, replays the env inverses, and leaves the profile clean.
    const removed = await manager.uninstall({ profile: 'web', id: 'fixture' })
    expect(removed.hotUnmounted).toBe(true)
    expect(calls).toContain('unmount')
    expect(manager.state().entries).toEqual([])
    expect(existsSync(envDir)).toBe(false)
    expect(readManifest(join(home, 'profiles', 'web')).dependencies ?? {}).toEqual({})
  }, 120_000)

  it('rejects npm-only sources for the workspace channel before any profile edit', async () => {
    const home = tempDir()
    const manager = createPackageManager({ home })
    await expect(manager.install({
      profile: 'web',
      id: 'npm-only',
      source: 'some-npm-package',
      adapter: 'dsh-bundle',
      channel: 'workspace',
    })).rejects.toThrow('workspace channel requires a git or file source')
    expect(manager.state().entries).toEqual([])
  }, 120_000)

  it('restore keeps, updates, and uninstalls workspace-channel entries without flipping channels', async () => {
    const home = tempDir()
    const source = makeBundleSource(join(home, 'fixture-src'))

    const pnpm = async (args: string[], cwd: string) => {
      if (args[0] === 'install') {
        const pkg = join(cwd, 'pkg')
        const installed = join(cwd, 'node_modules', 'fixture-bundle')
        if (!existsSync(installed)) cpSync(pkg, installed, { recursive: true })
      }
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    const calls: string[] = []
    const runtime: PackageManagerRuntime = {
      channel: 'workspace',
      composesProfile: false,
      async mount(): Promise<RuntimeMountResult> { calls.push('mount'); return { mounted: true, reason: 'stub' } },
      async unmount(): Promise<RuntimeMountResult> { calls.push('unmount'); return { mounted: true, reason: 'stub' } },
      async setDisabled(): Promise<RuntimeMountResult> { calls.push('setDisabled'); return { mounted: true, reason: 'stub' } },
    }
    const manager = createPackageManager({ home, pnpm, runtime })
    const deps = (content: string) => {
      mkdirSync(join(home, 'requirements'), { recursive: true })
      writeFileSync(join(home, 'requirements', 'deps.yaml'), content)
      return join(home, 'requirements', 'deps.yaml')
    }
    const spec = (ref: string) => `version: 1
modes:
  web:
    - id: fixture
      source: ${source}
      adapter: dsh-bundle
${ref === '' ? '' : `      ref: ${ref}
`}`

    await manager.install({ profile: 'web', id: 'fixture', source, adapter: 'dsh-bundle', channel: 'workspace' })
    const envDir = manager.state().entries.find(entry => entry.id === 'fixture')?.pluginEnvDir ?? ''

    // Same spec: keep, channel untouched, manifest untouched.
    const keep = await manager.restore({ file: deps(spec('')) })
    expect(keep.actions.find(action => action.id === 'fixture')?.action).toBe('keep')
    expect(manager.state().entries.find(entry => entry.id === 'fixture')?.channel).toBe('workspace')
    expect(readManifest(join(home, 'profiles', 'web')).dependencies?.['fixture-bundle']).toBeUndefined()

    // Changed ref: update — must stay on the workspace channel and keep the
    // profile manifest clean (this regressed when the batch path flipped it).
    const updated = await manager.restore({ file: deps(spec('v2')) })
    expect(updated.updated.map(result => result.id)).toContain('fixture')
    expect(updated.updated.find(result => result.id === 'fixture')?.channel).toBe('workspace')
    expect(manager.state().entries.find(entry => entry.id === 'fixture')?.channel).toBe('workspace')
    expect(readManifest(join(home, 'profiles', 'web')).dependencies?.['fixture-bundle']).toBeUndefined()
    expect(readManifest(join(home, 'profiles', 'web')).dsh?.profile?.bundles ?? []).not.toContain('fixture-bundle')

    // Removed from the requirements: uninstall, env cleaned.
    const removed = await manager.restore({ file: deps('version: 1\nmodes:\n  web: []\n') })
    expect(removed.uninstalled.map(result => result.id)).toContain('fixture')
    expect(manager.state().entries).toEqual([])
    expect(existsSync(envDir)).toBe(false)
  }, 120_000)
})
