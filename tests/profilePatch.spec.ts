/**
 * Official hot-reload acceptance test. It does NOT import app-boot; it replays
 * exactly the part of `watchUserPatches` that matters: a change to profile
 * `cordis.patch.yml` is parsed and applied as the root Include entry's
 * `config.patches`. Install/disable/enable/uninstall are only block edits to
 * that file; the Loader diff does the hot mount/unmount.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader, { type Entry } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { parsePatchObjects } from '../src/bundlePatch.ts'
import {
  managedPatchForPackage,
  patchRowIdsForEntry,
  removeManagedPatch,
  writeManagedPatch,
} from '../src/profilePatch.ts'
import type { LedgerEntry } from '../src/types.ts'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-official-hmr-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function entry(profileDir: string): LedgerEntry {
  return {
    id: 'fixture',
    profile: 'web',
    profileDir,
    source: 'file:./fixture',
    sourceKind: 'file',
    ref: '',
    adapter: 'dsh-bundle',
    adapterDir: '',
    packageName: 'fixture-bundle',
    materializedDir: '',
    resolvedCommit: '',
    steps: [],
    spec: { source: 'file:./fixture', adapter: 'dsh-bundle', adapterDir: '', ref: '', allowBuild: false },
    installedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
}

/** Profile dir + bundle package + a `data:` plugin row that records its lifecycle. */
function setupFixture() {
  const profileDir = tempDir()
  const bundleDir = join(profileDir, 'bundle')
  const rowCode = `
    globalThis.__pmOfficialHotEvents = []
    export default {
      name: 'official-hot-row',
      apply(ctx, config) {
        globalThis.__pmOfficialHotEvents.push('apply:' + config.flag)
        ctx.effect(() => () => { globalThis.__pmOfficialHotEvents.push('dispose') }, 'official-hot: effect')
      },
    }
  `
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({
    name: 'fixture-bundle',
    version: '1.0.0',
    type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(bundleDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: official-hot-row',
    `      name: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(rowCode)}`)}`,
    '      config:',
    '        flag: !!js process.env.PM_TEST_FLAG',
  ].join('\n'))
  writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '# user comment\n[]\n')
  return { profileDir, bundleDir }
}

/** Replay watchUserPatches' apply: re-read the file and update config.patches. */
async function applyOfficialWatch(ctx: Context, profileDir: string): Promise<void> {
  const include = [...ctx.loader.entries()].find(item => item.options.id === 'include')!
  const config = include.options.config as { path: string; patches?: Record<string, unknown>[] }
  const patches = parsePatchObjects(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8'), join(profileDir, 'cordis.patch.yml'))
  await include.update({ config: { ...config, patches } })
  await ctx.loader.await()
}

async function boot(profileDir: string): Promise<Context> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(profileDir).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({
    id: 'include',
    name: 'cordis:include',
    config: { path: pathToFileURL(join(profileDir, 'cordis.yml')).href, initial: [] },
  } as never)
  await ctx.loader.await()
  return ctx
}

function includeEntry(ctx: Context): Entry {
  return [...ctx.loader.entries()].find(item => item.options.id === 'include')!
}

describe('official watchUserPatches hot reload through cordis.patch.yml', () => {
  it('hot-mounts, disables, enables, and hot-unmounts bundle rows with no loader API from the package manager', async () => {
    process.env.PM_TEST_FLAG = 'hot'
    const { profileDir, bundleDir } = setupFixture()
    const ctx = await boot(profileDir)
    const managed = managedPatchForPackage(bundleDir, 'web', 'fixture')!
    expect(managed.rowIds).toEqual(['official-hot-row'])
    try {
      // Install = write the managed block; the official watcher would observe
      // the same file change and perform exactly this apply.
      writeManagedPatch(profileDir, 'fixture', managed.entries, false, managed.rowIds)
      await applyOfficialWatch(ctx, profileDir)

      const events = (globalThis as Record<string, unknown>).__pmOfficialHotEvents as string[]
      expect(events).toContain('apply:hot')
      expect(includeEntry(ctx)).toBeDefined()

      // Disable = same block plus trailing `{ id, disabled: true }`.
      writeManagedPatch(profileDir, 'fixture', managed.entries, true, managed.rowIds)
      await applyOfficialWatch(ctx, profileDir)
      expect(events).toContain('dispose')
      expect([...ctx.loader.entries()].find(item => item.options.id === 'official-hot-row')?.disabled).toBe(true)

      // Enable = rewrite the block without the disable rows.
      writeManagedPatch(profileDir, 'fixture', managed.entries, false, managed.rowIds)
      await applyOfficialWatch(ctx, profileDir)
      expect(events.filter(event => event === 'apply:hot')).toHaveLength(2)

      // Uninstall = remove the block; the watcher diff removes the row.
      removeManagedPatch(profileDir, 'fixture')
      await applyOfficialWatch(ctx, profileDir)
      expect(events.filter(event => event === 'dispose')).toHaveLength(2)
      expect([...ctx.loader.entries()].some(item => item.options.id === 'official-hot-row')).toBe(false)
      expect(readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')).toContain('[]')
    } finally {
      delete process.env.PM_TEST_FLAG
      await ctx.fiber.dispose()
    }
  })

  it('keeps user comments and user rows untouched around the managed block', () => {
    const { profileDir, bundleDir } = setupFixture()
    writeFileSync(join(profileDir, 'cordis.patch.yml'), [
      '# user comment',
      '- id: user-row',
      '  name: ./user.mjs',
    ].join('\n'))
    const managed = managedPatchForPackage(bundleDir, 'web', 'fixture')!
    writeManagedPatch(profileDir, 'fixture', managed.entries, false, managed.rowIds)
    const text = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    expect(text).toContain('# user comment')
    expect(text).toContain('id: user-row')
    expect(text).toContain('# >>> dsh-package-manager: "fixture"')
    expect(text).toContain('!!js process.env.PM_TEST_FLAG')

    removeManagedPatch(profileDir, 'fixture')
    const after = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    expect(after).toContain('# user comment')
    expect(after).toContain('id: user-row')
    expect(after).not.toContain('official-hot-row')
  })

  it('resolves stable disable ids for inserted rows, including fallback ids', () => {
    const { profileDir, bundleDir } = setupFixture()
    // Replace the bundle patch with an id-less row; disable still needs a
    // deterministic target id.
    writeFileSync(join(bundleDir, 'cordis.patch.yml'), '- insert:\n    - name: ./no-id.mjs\n')
    const managed = managedPatchForPackage(bundleDir, 'web', 'fixture')!
    expect(managed.rowIds).toEqual(['pm-web-fixture-0'])
    const target = entry(profileDir)
    target.packageName = 'fixture-bundle'
    target.materializedDir = bundleDir
    expect(patchRowIdsForEntry(target)).toEqual(['pm-web-fixture-0'])
  })
})
