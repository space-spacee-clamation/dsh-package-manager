import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migratePackageManagerSelf } from '../src/selfMigration.ts'
import { writeManifest } from '../src/profile.ts'
import { profileDir } from '../src/paths.ts'

const roots: string[] = []

afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('self migration', () => {
  it('moves the package manager from bundles into its managed patch block', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-pm-self-'))
    roots.push(home)
    const dir = profileDir(home, 'web')
    mkdirSync(dir, { recursive: true })
    writeManifest(dir, {
      name: 'dsh-profile-web', private: true, dependencies: { '@dsh-ext/dsh-package-manager': 'file:repo' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@dsh-ext/dsh-package-manager'] } },
    })
    const repo = join(home, 'repo')
    mkdirSync(repo, { recursive: true })
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: '@dsh-ext/dsh-package-manager', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    writeFileSync(join(repo, 'cordis.patch.yml'), ['- insert:', '    - id: package-manager', '      name: "@dsh-ext/dsh-package-manager"'].join('\n'))
    const result = migratePackageManagerSelf(home, repo, 'web')
    expect(result.removedFromBundles).toBe(true)
    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('dsh-package-manager: "package-manager"')
    expect(patch).toContain('id: package-manager')
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
    expect(manifest.dsh?.profile?.bundles).not.toContain('@dsh-ext/dsh-package-manager')
  })
})
