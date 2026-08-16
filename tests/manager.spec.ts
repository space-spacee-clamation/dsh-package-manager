import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPackageManager } from '../src/manager.ts'
import { readManifest } from '../src/profile.ts'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-manager-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A dsh-visualize-shaped bundle fixture with zero dependencies. */
function makeBundleFixture(dir: string, name = 'fixture-bundle'): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(dir, 'cordis.patch.yml'), '# fixture\n- insert:\n    - id: fixture-row\n      name: fixture-row\n')
  return dir
}

function depsYaml(dir: string, content: string): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'deps.yaml')
  writeFileSync(file, content)
  return file
}

describe('PackageManager integration (real pnpm)', () => {
  it('installs a local dsh-bundle plugin, records steps, and uninstalls cleanly', async () => {
    const home = tempDir()
    const fixture = makeBundleFixture(join(home, 'fixture'))
    const manager = createPackageManager({ home })

    const installed = await manager.install({
      profile: 'web', id: 'fixture', source: fixture, adapter: 'dsh-bundle',
    })
    expect(installed.adapter).toBe('dsh-bundle')
    expect(installed.packageName).toBe('fixture-bundle')

    const manifest = readManifest(join(home, 'profiles', 'web'))
    expect(manifest.dependencies?.['fixture-bundle']).toBeTruthy()
    expect(manifest.dsh?.profile?.bundles).toContain('fixture-bundle')

    const state = manager.state()
    expect(state.entries.map(entry => entry.id)).toContain('fixture')
    expect(state.restartNeeded).toBe(true)

    const removed = await manager.uninstall({ profile: 'web', id: 'fixture' })
    expect(removed.steps.length).toBeGreaterThan(0)
    const after = readManifest(join(home, 'profiles', 'web'))
    expect(after.dependencies?.['fixture-bundle']).toBeUndefined()
    expect(after.dsh?.profile?.bundles).not.toContain('fixture-bundle')
    expect(manager.state().entries).toEqual([])
  }, 120_000)

  it('restores from a requirements file idempotently and uninstalls removed entries', async () => {
    const home = tempDir()
    const fixture = makeBundleFixture(join(home, 'fixture'))
    const manager = createPackageManager({ home })
    const file = depsYaml(join(home, 'requirements'), `version: 1
modes:
  web:
    - id: fixture
      source: ${fixture}
      adapter: dsh-bundle
`)

    const first = await manager.restore({ file })
    expect(first.installed.map(result => result.id)).toEqual(['fixture'])

    const second = await manager.restore({ file })
    expect(second.actions.find(action => action.id === 'fixture')?.action).toBe('keep')
    expect(second.installed).toEqual([])

    depsYaml(join(home, 'requirements'), 'version: 1\nmodes:\n  web: []\n')
    const third = await manager.restore({ file })
    expect(third.uninstalled.map(result => result.id)).toEqual(['fixture'])
    expect(readManifest(join(home, 'profiles', 'web')).dependencies?.['fixture-bundle']).toBeUndefined()
  }, 180_000)
})

  it('switches a plugin off and back on through the disabled store', async () => {
    const home = tempDir()
    const fixture = makeBundleFixture(join(home, 'fixture'))
    const manager = createPackageManager({ home })
    await manager.install({ profile: 'web', id: 'fixture', source: fixture, adapter: 'dsh-bundle' })

    await manager.disable({ profile: 'web', id: 'fixture' })
    expect(manager.state().entries.map(entry => entry.id)).toEqual([])
    expect(manager.state().disabled.map(entry => entry.id)).toEqual(['fixture'])

    await manager.enable({ profile: 'web', id: 'fixture' })
    expect(manager.state().entries.map(entry => entry.id)).toEqual(['fixture'])
    expect(manager.state().disabled).toEqual([])

    await manager.uninstall({ profile: 'web', id: 'fixture' })
  }, 120_000)

  it('records switched workspace roots into the runtime history', () => {
    const home = tempDir()
    const manager = createPackageManager({ home })
    const root = join(home, 'workspaces')

    manager.setConfig({ storagePath: '', remoteUrl: '', autoSync: false, workspaceRoot: root })
    expect(manager.workspaceHistory()).toEqual([root])
    expect(manager.state().workspaceHistory).toEqual([root])

    manager.setConfig({ storagePath: '', remoteUrl: '', autoSync: false, workspaceRoot: '' })
    expect(manager.state().workspaceRoot).toBe(join(home, 'package-manager', 'plugin-workspaces'))
    expect(manager.state().workspaceHistory).toEqual([root])
  })

  it('clones and restores the configured requirements repo via syncConfigured', async () => {
    const home = tempDir()
    const fixture = makeBundleFixture(join(home, 'fixture'))
    const remote = join(home, 'remote-repo')
    mkdirSync(join(remote, 'requirements'), { recursive: true })
    writeFileSync(join(remote, 'requirements', 'deps.yaml'), `version: 1
modes:
  web:
    - id: fixture
      source: ${fixture}
      adapter: dsh-bundle
`)
    execFileSync('git', ['init', '-q'], { cwd: remote })
    execFileSync('git', ['add', '.'], { cwd: remote })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: remote })

    const local = join(home, 'local-repo')
    const manager = createPackageManager({ home })
    manager.setConfig({ storagePath: local, remoteUrl: remote, autoSync: false, workspaceRoot: '' })
    const result = await manager.syncConfigured()

    expect(result.installed.map(item => item.id)).toEqual(['fixture'])
    expect(existsSync(join(local, 'requirements', 'deps.yaml'))).toBe(true)
    expect(readManifest(join(home, 'profiles', 'web')).dependencies?.['fixture-bundle']).toBeTruthy()
  }, 120_000)

describe('PackageManager custom adapter', () => {
  it('installs through a declarative adapter and uninstalls through its recorded inverse', async () => {
    const home = tempDir()
    const manager = createPackageManager({ home })
    const marker = join(home, 'profiles', 'web', 'marker.txt')
    const adapterDir = join(home, 'adapter')
    mkdirSync(adapterDir, { recursive: true })
    writeFileSync(join(adapterDir, 'adapter.yaml'), `id: custom-fixture
install:
  - uses: file.write
    path: ${marker}
    content: hello
`)
    const installed = await manager.install({
      profile: 'web', id: 'custom', source: adapterDir, adapter: 'custom', adapterDir,
    })
    expect(installed.adapter).toBe('custom')
    expect(readFileSync(marker, 'utf8')).toBe('hello')

    await manager.uninstall({ profile: 'web', id: 'custom' })
    expect(existsSync(marker)).toBe(false)
    expect(manager.state().entries).toEqual([])
  })

  it('rolls back a failed custom install transactionally', async () => {
    const home = tempDir()
    const manager = createPackageManager({ home })
    const marker = join(home, 'profiles', 'web', 'marker.txt')
    const adapterDir = join(home, 'adapter')
    mkdirSync(adapterDir, { recursive: true })
    writeFileSync(join(adapterDir, 'adapter.yaml'), `id: broken-fixture
install:
  - uses: file.write
    path: ${marker}
    content: hello
verify:
  - uses: check
    run: node -e "process.exit(1)"
`)
    await expect(manager.install({
      profile: 'web', id: 'broken', source: adapterDir, adapter: 'custom', adapterDir,
    })).rejects.toThrow('command failed')
    expect(existsSync(marker)).toBe(false)
    expect(manager.state().entries).toEqual([])
  })
})

describe('PackageManager adapterInit', () => {
  it('detects dsh-bundle plugins and writes a deps.yaml entry without an adapter file', async () => {
    const home = tempDir()
    const fixture = makeBundleFixture(join(home, 'fixture'))
    const out = join(home, 'requirements')
    const result = await createPackageManager({ home }).adapterInit({ source: fixture, id: 'fixture', outDir: out, profile: 'web' })
    expect(result.adapter).toBe('dsh-bundle')
    expect(existsSync(join(out, 'requirements', 'deps.yaml'))).toBe(true)
    const text = readFileSync(join(out, 'requirements', 'deps.yaml'), 'utf8')
    expect(text).toContain('fixture')
    expect(text).toContain('dsh-bundle')
  })

  it('scaffolds a custom adapter for plain plugins', async () => {
    const home = tempDir()
    const plain = join(home, 'plain')
    mkdirSync(plain, { recursive: true })
    writeFileSync(join(plain, 'package.json'), JSON.stringify({ name: 'plain-plugin', version: '1.0.0' }))
    const out = join(home, 'requirements')
    const result = await createPackageManager({ home }).adapterInit({ source: plain, id: 'plain', outDir: out })
    expect(result.adapter).toBe('custom')
    expect(existsSync(join(out, 'requirements', 'adapters', 'plain', 'adapter.yaml'))).toBe(true)
    expect(readFileSync(join(out, 'requirements', 'deps.yaml'), 'utf8')).toContain('custom')
  })

  it('restores a scaffolded custom adapter from the generated requirements layout', async () => {
    const home = tempDir()
    const manager = createPackageManager({ home })
    const plain = join(home, 'plain')
    mkdirSync(plain, { recursive: true })
    writeFileSync(join(plain, 'package.json'), JSON.stringify({ name: 'plain-plugin', version: '1.0.0' }))
    const out = join(home, 'requirements')
    await manager.adapterInit({ source: plain, id: 'plain', outDir: out })

    const adapterPath = join(out, 'requirements', 'adapters', 'plain', 'adapter.yaml')
    writeFileSync(adapterPath, `id: plain
install:
  - uses: file.copy
    from: \${DSH_WORKDIR}/source/package.json
    to: \${DSH_HOME}/profiles/web/plain-package.json
verify:
  - uses: check
    run: >-
      node -e "process.exit(require('node:fs').existsSync(process.env.DSH_HOME + '/profiles/web/plain-package.json') ? 0 : 1)"
    env:
      DSH_HOME: \${DSH_HOME}
`)

    const installed = await manager.restore({ file: join(out, 'requirements', 'deps.yaml') })
    expect(installed.installed.map(result => result.id)).toEqual(['plain'])
    expect(existsSync(join(home, 'profiles', 'web', 'plain-package.json'))).toBe(true)

    await manager.uninstall({ profile: 'web', id: 'plain' })
    expect(existsSync(join(home, 'profiles', 'web', 'plain-package.json'))).toBe(false)
  })
})
