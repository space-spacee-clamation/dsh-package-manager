import { describe, expect, it } from 'vitest'
import { getEntry, loadLedger, setEntry } from '../src/ledger.ts'
import { parseRequirements, planRestore, fingerprint } from '../src/spec.ts'
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
    spec: { source, adapter, adapterDir: '', ref },
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
    expect(() => parseRequirements('version: 1\nmodes: {web: [{source: x}]}\n', '.')).toThrow('id')
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

  it('fingerprints source, adapter, adapterDir and ref', () => {
    expect(fingerprint(specEntry())).toEqual(fingerprint(specEntry()))
    expect(fingerprint(specEntry({ ref: 'main' }))).not.toEqual(fingerprint(specEntry()))
  })
})
