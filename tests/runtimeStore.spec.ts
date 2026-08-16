import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { workspaceHistoryPath } from '../src/paths.ts'
import { clearWorkspaceHistory, forgetWorkspaceHistory, loadWorkspaceHistory, recordWorkspaceHistory } from '../src/runtimeStore.ts'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-runtime-store-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('package-manager runtime store', () => {
  it('persists workspace history under <home>/package-manager/runtime', () => {
    const home = tempDir()
    const first = join(home, 'workspaces', 'one')
    const second = join(home, 'workspaces', 'two')

    expect(loadWorkspaceHistory(home)).toEqual([])
    expect(recordWorkspaceHistory(home, first)).toEqual([first])
    expect(recordWorkspaceHistory(home, second)).toEqual([second, first])
    expect(recordWorkspaceHistory(home, first)).toEqual([first, second])

    const path = workspaceHistoryPath(home)
    expect(path).toBe(join(home, 'package-manager', 'runtime', 'workspace-history.json'))
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toContain('"version": 1')

    expect(forgetWorkspaceHistory(home, second)).toEqual([first])
    expect(clearWorkspaceHistory(home)).toEqual([])
    expect(loadWorkspaceHistory(home)).toEqual([])
  })
})
