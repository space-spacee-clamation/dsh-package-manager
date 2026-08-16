import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureProfile, readManifest, writeManifest } from '../src/profile.ts'
import { StepExecutor, validateStepSpec, type PnpmRunner } from '../src/steps.ts'
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
  return (args, cwd): SpawnResult => {
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
    const executor = new StepExecutor(fakePnpm(), () => ({ exitCode: 0, stdout: '', stderr: '' }))
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
    const executor = new StepExecutor(fakePnpm(), () => ({ exitCode: 0, stdout: '', stderr: '' }))
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
    const executor = new StepExecutor(fakePnpm(), () => ({ exitCode: 0, stdout: '', stderr: '' }))
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
  it('adds and removes dependencies with pnpm, recording the resolved package name', async () => {
    const dir = tempDir()
    ensureProfile(dir, 'web')
    const executor = new StepExecutor(fakePnpm(), () => ({ exitCode: 0, stdout: '', stderr: '' }))
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

  it('reconcile records the previous bundle list as its inverse', async () => {
    const dir = tempDir()
    ensureProfile(dir, 'custom')
    const manifest = readManifest(dir)
    manifest.dependencies = { 'fixture-bundle': 'file:../fixture' }
    writeManifest(dir, manifest)
    const executor = new StepExecutor(fakePnpm(), () => ({ exitCode: 0, stdout: '', stderr: '' }))
    const records = await executor.run(
      [{ uses: 'profile.bundles.reconcile' }],
      ctx(dir, dir),
      join(dir, 'backups'),
    )
    // No node_modules here: reconcile adds nothing, but still snapshots the list.
    expect(records[0]?.inverse.uses).toBe('profile.bundles.set')
    await executor.rollback(records, ctx(dir, dir), join(dir, 'backups'))
    expect(readManifest(dir).dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base'])
  })
})
