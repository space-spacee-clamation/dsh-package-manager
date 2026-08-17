import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getEntry, isEntryEffective, loadLedger, setEntry } from '../src/ledger.ts'
import { parseRequirements, planRestore, planWorkspaceSwitch, fingerprint } from '../src/spec.ts'
import type { Ledger, LedgerEntry, SpecEntry } from '../src/types.ts'

function entry(profile: string, id: string, source: string, adapter = 'auto', ref = ''): LedgerEntry {
  return {
    id,
    profile,
    source,
    sourceKind: 'git',
    ref,
    adapter: 'dsh-bundle',
    adapterDir: '',
    packageName: id,
    materializedDir: '',
    resolvedCommit: '',
    steps: [],
    spec: { source, adapter, adapterDir: '', ref, allowBuild: false },
    installedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
}

function specEntry(overrides: Partial<SpecEntry> = {}): SpecEntry {
  return { id: 'a', source: 'github:o/r', adapter: 'auto', adapterDir: '', ref: '', allowBuild: false, ...overrides }
}

describe('parseRequirements', () => {
  it('parses a full requirements file with defaults', () => {
    const spec = parseRequirements(`
version: 1
repo: .
modes:
  web:
    - id: dsh-visualize
      source: github:Nagi-ovo/dsh-visualize
    - id: custom
      source: github:o/c
      adapter: custom
      adapterDir: adapters/custom
      ref: main
      allowBuild: true
`, '/tmp/requirements')
    expect(spec.modes.web?.map(entry => entry.id)).toEqual(['dsh-visualize', 'custom'])
    expect(spec.modes.web?.[1]).toMatchObject({ adapter: 'custom', adapterDir: 'adapters/custom', ref: 'main', allowBuild: true })
  })

  it('rejects malformed files loudly', () => {
    expect(() => parseRequirements('version: 2\nmodes: {}\n', '.')).toThrow('unsupported version')
    const spec = parseRequirements('version: 1\nmodes:\n  web:\n    - { id: fresh, source: github:o/fresh }\n', '.')
    expect(() => parseRequirements('version: 1\nmodes: {web: [{id: a, source: s}, {id: a, source: t}]}\n', '.')).toThrow('duplicate')
    expect(() => parseRequirements('version: 1\nmodes: {web: [{id: a, source: s, adapter: nope}]}\n', '.')).toThrow('adapter')
  })
})

describe('planRestore', () => {
  it('computes install/keep/update/uninstall diffs by id', () => {
    const ledger: Ledger = { version: 1, profiles: {} }
    setEntry(ledger, entry('web', 'keep', 'github:o/keep'))
    setEntry(ledger, entry('web', 'change', 'github:o/old'))
    setEntry(ledger, entry('web', 'gone', 'github:o/gone'))
    const spec = parseRequirements(`
version: 1
modes:
  web:
    - { id: keep, source: github:o/keep }
    - { id: change, source: github:o/new }
    - { id: fresh, source: github:o/fresh }
`, '.')
    const actions = planRestore(spec, ledger)
    expect(actions.find(action => action.id === 'keep')?.action).toBe('keep')
    expect(actions.find(action => action.id === 'change')?.action).toBe('update')
    expect(actions.find(action => action.id === 'fresh')?.action).toBe('install')
    expect(actions.find(action => action.id === 'gone')?.action).toBe('uninstall')
  })

  it('filters to requested modes', () => {
    const ledger: Ledger = { version: 1, profiles: {} }
    setEntry(ledger, entry('headless', 'x', 'github:o/x'))
    const spec = parseRequirements('version: 1\nmodes:\n  headless:\n    - { id: x, source: github:o/x }\n  web: []\n', '.')
    expect(planRestore(spec, ledger, ['web'])).toEqual([])
    expect(planRestore(spec, ledger, ['headless']).map(action => action.id)).toEqual(['x'])
  })

  it('workspace switching treats undeclared ledger modes as empty', () => {
    const ledger: Ledger = { version: 1, profiles: {} }
    setEntry(ledger, entry('web', 'old-web', 'github:o/old-web'))
    setEntry(ledger, entry('headless', 'old-headless', 'github:o/old-headless'))
    const spec = parseRequirements('version: 1\nmodes:\n  web:\n    - { id: fresh, source: github:o/fresh }\n', '.')
    const actions = planWorkspaceSwitch(spec, ledger)
    expect(actions.find(action => action.id === 'fresh')?.action).toBe('install')
    expect(actions.find(action => action.id === 'old-web')?.action).toBe('uninstall')
    expect(actions.find(action => action.id === 'old-headless')?.action).toBe('uninstall')
  })

  it('fingerprints source, adapter, adapterDir and ref', () => {
    expect(fingerprint(specEntry())).toEqual(fingerprint(specEntry()))
    expect(fingerprint(specEntry({ ref: 'main' }))).not.toEqual(fingerprint(specEntry()))
  })

  it('treats an allowBuild-only change as an update, not a keep', () => {
    const ledger: Ledger = { version: 1, profiles: {} }
    setEntry(ledger, entry('web', 'a', 'github:o/a'))
    const spec = parseRequirements('version: 1\nmodes:\n  web:\n    - { id: a, source: github:o/a, allowBuild: true }\n', '.')
    const actions = planRestore(spec, ledger)
    expect(actions.find(action => action.id === 'a')?.action).toBe('update')
  })

  it('parses the channel field and treats a channel change as an update', () => {
    const spec = parseRequirements('version: 1\nmodes:\n  web:\n    - { id: a, source: github:o/a, channel: workspace }\n', '.')
    expect(spec.modes.web?.[0]?.channel).toBe('workspace')
    expect(() => parseRequirements('version: 1\nmodes:\n  web:\n    - { id: a, source: github:o/a, channel: sideways }\n', '.'))
      .toThrow('channel must be')

    const ledger: Ledger = { version: 1, profiles: {} }
    setEntry(ledger, entry('web', 'a', 'github:o/a'))
    const switched = parseRequirements('version: 1\nmodes:\n  web:\n    - { id: a, source: github:o/a, channel: workspace }\n', '.')
    const actions = planRestore(switched, ledger)
    expect(actions.find(action => action.id === 'a')?.action).toBe('update')
  })
})

describe('isEntryEffective', () => {
  function customEntry(dependencyName: string): LedgerEntry {
    return {
      id: 'custom', profile: 'web', source: 'github:o/r', sourceKind: 'git', ref: '',
      adapter: 'custom', adapterDir: '', packageName: '', materializedDir: '', resolvedCommit: '',
      steps: dependencyName === ''
        ? []
        : [{
            kind: 'profile.dependency.add',
            label: 'add',
            params: { spec: 'link:x', packageName: dependencyName },
            inverse: { uses: 'noop' },
          }],
      spec: { source: 'github:o/r', adapter: 'custom', adapterDir: '', ref: '', allowBuild: false },
      installedAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }
  }

  it('marks custom entries stale when their recorded profile dependency vanished', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-effective-'))
    try {
      mkdirSync(dir, { recursive: true })
      const entry = customEntry('pkg-a')
      entry.profileDir = dir
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', dependencies: {} }))
      expect(isEntryEffective('', entry)).toBe(false)
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', dependencies: { 'pkg-a': 'link:y' } }))
      expect(isEntryEffective('', entry)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps custom entries that recorded no profile dependency', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-effective-'))
    try {
      mkdirSync(dir, { recursive: true })
      const entry = customEntry('')
      entry.profileDir = dir
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'p', dependencies: {} }))
      expect(isEntryEffective('', entry)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
