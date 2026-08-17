import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureProfile, healProfiles, readAllowBuilds, readManifest, readWorkspace, reconcileBundles, writeAllowBuilds,
} from '../src/profile.ts'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-profile-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ensureProfile', () => {
  it('initializes the three profile files without touching existing ones', () => {
    const home = tempDir()
    const dir = join(home, 'profiles', 'web')
    ensureProfile(dir, 'web')
    const manifest = readManifest(dir)
    expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toContain('[]')
    expect(readWorkspace(dir)?.nodeLinker).toBe('hoisted')
    writeFileSync(join(dir, 'cordis.patch.yml'), '# user-owned\n')
    ensureProfile(dir, 'web')
    expect(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')).toBe('# user-owned\n')
  })

  it('uses the base-only template for unknown profile names', () => {
    const home = tempDir()
    const dir = join(home, 'profiles', 'tui')
    ensureProfile(dir, 'tui')
    expect(readManifest(dir).dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base'])
  })
})

describe('reconcileBundles', () => {
  it('adds dependency bundles and never removes hand-maintained rows', () => {
    const dir = tempDir()
    ensureProfile(dir, 'custom')
    const manifest = readManifest(dir)
    manifest.dependencies = { 'fixture-bundle': 'file:../fixture' }
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
    mkdirSync(join(dir, 'node_modules', 'fixture-bundle'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'fixture-bundle', 'package.json'), JSON.stringify({
      name: 'fixture-bundle',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(dir, 'node_modules', 'fixture-bundle', 'cordis.patch.yml'), '[]\n')
    const result = reconcileBundles(dir)
    expect(result.added).toEqual(['fixture-bundle'])
    expect(readManifest(dir).dsh?.profile?.bundles).toContain('fixture-bundle')
    // A hand-maintained bundle that is not a dependency survives the add-only reconcile.
    const before = readManifest(dir).dsh?.profile?.bundles ?? []
    const after = [...before, 'manual-bundle']
    const withManual = readManifest(dir)
    withManual.dsh = { ...withManual.dsh, profile: { ...withManual.dsh?.profile, bundles: after } }
    writeFileSync(join(dir, 'package.json'), JSON.stringify(withManual))
    reconcileBundles(dir)
    expect(readManifest(dir).dsh?.profile?.bundles).toContain('manual-bundle')
  })
})

describe('allowBuilds', () => {
  it('reads and replaces the allowBuilds list', () => {
    const dir = tempDir()
    ensureProfile(dir, 'web')
    expect(readAllowBuilds(dir)).toEqual([])
    writeAllowBuilds(dir, ['a', 'b'])
    expect(readAllowBuilds(dir)).toEqual(['a', 'b'])
    expect(readWorkspace(dir)?.allowBuilds).toEqual(['a', 'b'])
  })
})

describe('healProfiles', () => {
  it('prunes unresolvable bundle rows, keeps template and resolvable rows, and removes dangling links', () => {
    const home = tempDir()
    const dir = join(home, 'profiles', 'web')
    ensureProfile(dir, 'web')
    // resolvable bundle package
    mkdirSync(join(dir, 'node_modules', 'resolvable-pkg'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'resolvable-pkg', 'package.json'), JSON.stringify({
      name: 'resolvable-pkg',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    // broken bundle row: no dependency and no resolvable package dir
    const manifest = readManifest(dir)
    manifest.dependencies = { 'resolvable-pkg': 'file:../resolvable-pkg' }
    manifest.dsh = {
      ...manifest.dsh,
      profile: {
        ...manifest.dsh?.profile,
        bundles: [...(manifest.dsh?.profile?.bundles ?? []), 'resolvable-pkg', 'broken-pkg'],
      },
    }
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))

    const report = healProfiles(home)
    const healed = readManifest(dir).dsh?.profile?.bundles ?? []
    expect(healed).not.toContain('broken-pkg')
    expect(healed).toContain('@deepseek-ai/dsh-base')
    expect(healed).toContain('resolvable-pkg')
    expect(report.some(item => item.profile === 'web' && item.pruned.includes('broken-pkg'))).toBe(true)
  })
})
