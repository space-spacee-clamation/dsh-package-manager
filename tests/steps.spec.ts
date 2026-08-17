import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureProfile, readManifest, writeManifest } from '../src/profile.ts'
import { StepExecutor, validateStepSpec, type DshRunner, type PnpmRunner } from '../src/steps.ts'
import type { AdapterContext, OperationLog, SpawnResult } from '../src/types.ts'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-steps-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function ctx(profileDir: string, workDir: string): AdapterContext {
  const logs: OperationLog[] = []
  return {
    home: join(profileDir, '..', '..'),
    profileDir,
    workDir,
    source: 'file:fixture',
    ref: '',
    log: (level, message) => { logs.push({ level, message }) },
  }
}

/** Fake pnpm that actually mutates the profile manifest the way pnpm would. */
function fakePnpm(): PnpmRunner {
  return async (args, cwd): Promise<SpawnResult> => {
    const manifest = readManifest(cwd)
    const deps = { ...(manifest.dependencies ?? {}) }
    if (args[0] === 'add') {
      deps['fake-pkg'] = args[1] ?? 'file:fixture'
    } else if (args[0] === 'remove') {
      delete deps[args[1] ?? '']
    }
    manifest.dependencies = deps
    writeManifest(cwd, manifest)
    return { exitCode: 0, stdout: '', stderr: '' }
  }
}

describe('validateStepSpec', () => {
  it('rejects unknown kinds and malformed fields', () => {
    expect(() => validateStepSpec({ uses: 'nope' } as never, 'x')).toThrow('unsupported')
    expect(() => validateStepSpec({ uses: 'file.copy', from: 'a' } as never, 'x')).toThrow('"to"')
    expect(() => validateStepSpec({ uses: 'profile.bundles.set', bundles: [1] } as never, 'x')).toThrow('string array')
  })
})

describe('StepExecutor file steps', () => {
  it('copies, writes, removes, and restores files through recorded inverses', async () => {
    const dir = tempDir()
    const executor = new StepExecutor(fakePnpm(), async () => ({ exitCode: 0, stdout: '', stderr: '' }))
    const target = join(dir, 'target.txt')
    writeFileSync(join(dir, 'from.txt'), 'hello')
    const records = await executor.run(
      [
        { uses: 'file.copy', from: join(dir, 'from.txt'), to: target },
        { uses: 'file.write', path: target, content: 'overwritten' },
      ],
      ctx(dir, dir),
      join(dir, 'backups'),
    )
    expect(readFileSync(target, 'utf8')).toBe('overwritten')
    await executor.rollback(records, ctx(dir, dir), join(dir, 'backups'))
    // LIFO: write-inverse restores the copied file, copy-inverse removes it.
    expect(existsSync(target)).toBe(false)
  })

  it('restores a pre-existing file when a write is rolled back', async () => {
    const dir = tempDir()
    const executor = new StepExecutor(fakePnpm(), async () => ({ exitCode: 0, stdout: '', stderr: '' }))
    const target = join(dir, 'target.txt')
    writeFileSync(target, 'original')
    const records = await executor.run(
      [{ uses: 'file.write', path: target, content: 'new' }],
      ctx(dir, dir),
      join(dir, 'backups'),
    )
    expect(readFileSync(target, 'utf8')).toBe('new')
    await executor.rollback(records, ctx(dir, dir), join(dir, 'backups'))
    expect(readFileSync(target, 'utf8')).toBe('original')
  })

  it('reports every failure during rollback and keeps sweeping', async () => {
    const dir = tempDir()
    const executor = new StepExecutor(fakePnpm(), async () => ({ exitCode: 0, stdout: '', stderr: '' }))
    const target = join(dir, 'a.txt')
    writeFileSync(target, 'original')
    const records = await executor.run(
      [{ uses: 'file.write', path: target, content: 'a' }],
      ctx(dir, dir),
      join(dir, 'backups'),
    )
    // The inverse is file.restore from this backup; deleting it makes rollback fail loudly.
    rmSync(join(dir, 'backups', '0'), { recursive: true, force: true })
    await expect(executor.rollback(records, ctx(dir, dir), join(dir, 'backups'))).rejects.toThrow('rollback incomplete')
  })
})

describe('StepExecutor profile steps', () => {
  it('prefers the existing dsh plugin add/remove tool for profile dependencies', async () => {
    const dir = tempDir()
    ensureProfile(dir, 'web')
    const calls: string[][] = []
    const fakeDsh: DshRunner = async (args, cwd): Promise<SpawnResult> => {
      calls.push(args)
      expect(cwd).toBe(dir)
      const manifest = readManifest(cwd)
      const deps = { ...(manifest.dependencies ?? {}) }
      const verb = args[3]
      if (verb === 'add') deps['fake-pkg'] = args[4] ?? 'file:fixture'
      else if (verb === 'remove') delete deps[args[4] ?? '']
      manifest.dependencies = deps
      writeManifest(cwd, manifest)
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    const executor = new StepExecutor(fakePnpm(), async () => ({ exitCode: 0, stdout: '', stderr: '' }), fakeDsh)
    const records = await executor.run(
      [{ uses: 'profile.dependency.add', spec: 'file:fixture', packageName: 'fake-pkg' }],
      ctx(dir, dir),
      join(dir, 'backups'),
    )
    expect(calls).toEqual([['plugin', '--profile', basename(dir), 'add', 'file:fixture']])
    expect(readManifest(dir).dependencies?.['fake-pkg']).toBe('file:fixture')
    await executor.rollback(records, ctx(dir, dir), join(dir, 'backups'))
    expect(calls[1]).toEqual(['plugin', '--profile', basename(dir), 'remove', 'fake-pkg'])
    expect(readManifest(dir).dependencies?.['fake-pkg']).toBeUndefined()
  })

  it('adds and removes dependencies with pnpm, recording the resolved package name', async () => {
    const dir = tempDir()
    ensureProfile(dir, 'web')
    const executor = new StepExecutor(fakePnpm(), async () => ({ exitCode: 0, stdout: '', stderr: '' }))
    const records = await executor.run(
      [{ uses: 'profile.dependency.add', spec: 'file:fixture' }],
      ctx(dir, dir),
      join(dir, 'backups'),
    )
    expect(readManifest(dir).dependencies?.['fake-pkg']).toBe('file:fixture')
    expect(records[0]?.params.packageName).toBe('fake-pkg')
    await executor.rollback(records, ctx(dir, dir), join(dir, 'backups'))
    expect(readManifest(dir).dependencies?.['fake-pkg']).toBeUndefined()
  })

  it('reconcile records a noop inverse when it adds nothing', async () => {
    const dir = tempDir()
    ensureProfile(dir, 'custom')
    const manifest = readManifest(dir)
    manifest.dependencies = { 'fixture-bundle': 'file:../fixture' }
    writeManifest(dir, manifest)
    const executor = new StepExecutor(fakePnpm(), async () => ({ exitCode: 0, stdout: '', stderr: '' }))
    const records = await executor.run(
      [{ uses: 'profile.bundles.reconcile', packageName: 'fixture-bundle' }],
      ctx(dir, dir),
      join(dir, 'backups'),
    )
    // No node_modules here: reconcile adds nothing, and the host may already
    // have reconciled on its own path — restoring a list snapshot would
    // clobber rows the host or the user added later, so the inverse is a noop.
    expect(records[0]?.inverse.uses).toBe('noop')
    await executor.rollback(records, ctx(dir, dir), join(dir, 'backups'))
    expect(readManifest(dir).dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base'])
  })

  it('reconcile records a targeted remove inverse for the row it added', async () => {
    const dir = tempDir()
    ensureProfile(dir, 'custom')
    mkdirSync(join(dir, 'node_modules', 'fixture-bundle'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'fixture-bundle', 'package.json'), JSON.stringify({
      name: 'fixture-bundle',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    const manifest = readManifest(dir)
    manifest.dependencies = { 'fixture-bundle': 'file:../fixture' }
    writeManifest(dir, manifest)
    const executor = new StepExecutor(fakePnpm(), async () => ({ exitCode: 0, stdout: '', stderr: '' }))
    const records = await executor.run(
      [{ uses: 'profile.bundles.reconcile', packageName: 'fixture-bundle' }],
      ctx(dir, dir),
      join(dir, 'backups'),
    )
    expect(records[0]?.inverse).toEqual({ uses: 'profile.bundles.remove', package: 'fixture-bundle' })
    expect(readManifest(dir).dsh?.profile?.bundles).toContain('fixture-bundle')
    await executor.rollback(records, ctx(dir, dir), join(dir, 'backups'))
    const after = readManifest(dir).dsh?.profile?.bundles ?? []
    expect(after).not.toContain('fixture-bundle')
    expect(after).toContain('@deepseek-ai/dsh-base')
  })

  it('reconcile without a declared packageName removes every row it added on rollback', async () => {
    const dir = tempDir()
    ensureProfile(dir, 'custom')
    for (const name of ['pkg-a', 'pkg-b']) {
      mkdirSync(join(dir, 'node_modules', name), { recursive: true })
      writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({
        name,
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }))
    }
    const manifest = readManifest(dir)
    manifest.dependencies = { 'pkg-a': 'file:../a', 'pkg-b': 'file:../b' }
    writeManifest(dir, manifest)
    const executor = new StepExecutor(fakePnpm(), async () => ({ exitCode: 0, stdout: '', stderr: '' }))
    const records = await executor.run(
      [{ uses: 'profile.bundles.reconcile' }],
      ctx(dir, dir),
      join(dir, 'backups'),
    )
    expect(records[0]?.inverse).toEqual({ uses: 'profile.bundles.removeMany', packages: ['pkg-a', 'pkg-b'] })
    await executor.rollback(records, ctx(dir, dir), join(dir, 'backups'))
    const after = readManifest(dir).dsh?.profile?.bundles ?? []
    expect(after).not.toContain('pkg-a')
    expect(after).not.toContain('pkg-b')
    expect(after).toContain('@deepseek-ai/dsh-base')
  })
})
