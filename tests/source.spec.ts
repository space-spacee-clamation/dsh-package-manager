import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { materializeSource } from '../src/source.ts'
import type { GitRunner } from '../src/source.ts'
import type { SpawnResult } from '../src/types.ts'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-source-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fakeGit(calls: string[][]): GitRunner {
  return async (args, cwd): Promise<SpawnResult> => {
    calls.push(args)
    if (args[0] === 'clone') {
      const destination = args[args.length - 1]
      if (destination !== undefined) mkdirSync(destination, { recursive: true })
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    if (args[0] === 'rev-parse') return { exitCode: 0, stdout: 'abc123\n', stderr: '' }
    if (args[0] === 'remote') return { exitCode: 0, stdout: '', stderr: '' }
    throw new Error(`unexpected git command in cwd ${cwd}: ${args.join(' ')}`)
  }
}

describe('centralized git package store', () => {
  it('mirrors a remote once and clones later installs from the local mirror', async () => {
    const home = tempDir()
    const packageRoot = join(home, 'package-manager', 'runtime', 'packages')
    const calls: string[][] = []
    const git = fakeGit(calls)

    const first = await materializeSource(join(home, 'work-1'), 'github:owner/plugin', 'main', git, packageRoot)
    const second = await materializeSource(join(home, 'work-2'), 'github:owner/plugin', 'main', git, packageRoot)

    expect(first.dir).toContain(join('work-1', 'source'))
    expect(second.dir).toContain(join('work-2', 'source'))
    expect(first.resolvedCommit).toBe('abc123')
    expect(calls.filter(args => args[0] === 'clone' && args[1] === '--mirror')).toHaveLength(1)

    const mirror = calls.find(args => args[0] === 'clone' && args[1] === '--mirror')?.[4]
    expect(mirror).toBeDefined()
    expect(existsSync(mirror ?? '')).toBe(true)
    const localClones = calls.filter(args => args[0] === 'clone' && args[1] !== '--mirror')
    expect(localClones).toHaveLength(2)
    expect(localClones[0]?.[4]).toBe(mirror)
    expect(localClones[1]?.[4]).toBe(mirror)
  })
})
