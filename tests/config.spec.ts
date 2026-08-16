import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  configPath, loadConfig, loadDisabled, removeDisabledEntry, saveConfig, upsertDisabledEntry,
} from '../src/config.ts'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-config-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('package-manager config store', () => {
  it('returns defaults and persists normalized config', () => {
    const home = tempDir()
    expect(loadConfig(home)).toEqual({ storagePath: '', remoteUrl: '', autoSync: false, workspaceRoot: '' })

    const config = saveConfig(home, { storagePath: 'repo', remoteUrl: 'https://example.com/r.git', autoSync: true, workspaceRoot: '' })
    expect(config).toEqual({ storagePath: 'repo', remoteUrl: 'https://example.com/r.git', autoSync: true, workspaceRoot: '' })
    expect(loadConfig(home)).toEqual(config)
    expect(configPath(home)).toContain('config.json')
  })

  it('rejects malformed config files', () => {
    const home = tempDir()
    mkdirSync(join(home, 'package-manager'), { recursive: true })
    writeFileSync(configPath(home), '{"storagePath": 1}', 'utf8')
    expect(() => loadConfig(home)).toThrow('storagePath')
  })
})

describe('disabled plugin store', () => {
  it('upserts, loads, and removes entries', () => {
    const home = tempDir()
    expect(loadDisabled(home)).toEqual([])
    const entry = {
      profile: 'web',
      id: 'x',
      source: 'github:o/x',
      adapter: 'dsh-bundle',
      adapterDir: '',
      ref: 'main',
      allowBuild: true,
    } as const
    upsertDisabledEntry(home, entry)
    upsertDisabledEntry(home, { ...entry, ref: 'next' })
    expect(loadDisabled(home)).toEqual([{ ...entry, ref: 'next' }])

    expect(removeDisabledEntry(home, 'web', 'x')).toEqual({ ...entry, ref: 'next' })
    expect(loadDisabled(home)).toEqual([])
  })
})
