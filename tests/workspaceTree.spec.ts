import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { disablePatchesFor, workspaceIncludeId, WorkspaceTreeRuntime } from '../src/workspaceTree.ts'
import type { LedgerEntry } from '../src/types.ts'

const roots: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pm-ws-tree-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete (globalThis as Record<string, unknown>).__wsEvents
})

/**
 * Build one plugin workspace: .venv/pkg holds the bundle source (the patch
 * file the runtime reads), .venv/node_modules/@fixture/ws-bundle is the
 * resolvable install produced by the carrier pnpm install, and
 * .venv/cordis.yml is the managed composition root.
 */
function makeWorkspace(workspaceDir: string, patchYaml: string): string {
  const env = join(workspaceDir, '.venv')
  const pkg = join(env, 'pkg')
  const lib = join(pkg, 'lib')
  mkdirSync(lib, { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({
    name: '@fixture/ws-bundle',
    version: '1.0.0',
    type: 'module',
    main: 'lib/index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }))
  writeFileSync(join(pkg, 'cordis.patch.yml'), patchYaml)
  writeFileSync(join(pkg, 'lib', 'index.js'), [
    "globalThis.__wsEvents = []",
    "export default {",
    "  name: 'ws-bundle',",
    "  apply(ctx, config) {",
    "    globalThis.__wsEvents.push('apply:' + (config?.flag ?? 'none'))",
    "    ctx.effect(() => () => { globalThis.__wsEvents.push('dispose:' + (config?.flag ?? 'none')) }, 'ws-bundle: effect')",
    "  },",
    "}",
  ].join('\n'))
  // The resolvable install: bare-name rows resolve from .venv/node_modules.
  const installed = join(env, 'node_modules', '@fixture')
  mkdirSync(installed, { recursive: true })
  const root = join(installed, 'ws-bundle')
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@fixture/ws-bundle', version: '1.0.0', type: 'module', main: 'lib/index.js' }))
  writeFileSync(join(root, 'lib', 'index.js'), [
    "globalThis.__wsEvents = []",
    "export default {",
    "  name: 'ws-bundle',",
    "  apply(ctx, config) {",
    "    globalThis.__wsEvents.push('apply:' + (config?.flag ?? 'none'))",
    "    ctx.effect(() => () => { globalThis.__wsEvents.push('dispose:' + (config?.flag ?? 'none')) }, 'ws-bundle: effect')",
    "  },",
    "}",
  ].join('\n'))
  return env
}

const PATCH = [
  '- insert:',
  '    - id: ws-row-1',
  "      name: '@fixture/ws-bundle'",
  '      config:',
  '        flag: one',
  '    - id: ws-row-2',
  "      name: '@fixture/ws-bundle'",
  '      config:',
  '        flag: two',
].join('\n')

function entry(workspaceDir: string, extra: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: 'ws-bundle',
    profile: 'web',
    source: workspaceDir,
    sourceKind: 'file',
    ref: '',
    adapter: 'dsh-bundle',
    adapterDir: '',
    packageName: '@fixture/ws-bundle',
    materializedDir: join(workspaceDir, '.venv', 'pkg'),
    channel: 'workspace',
    disabled: false,
    workspaceDir,
    pluginEnvDir: join(workspaceDir, '.venv'),
    resolvedCommit: '',
    steps: [],
    spec: { source: workspaceDir, adapter: 'dsh-bundle', adapterDir: '', ref: '', allowBuild: false },
    installedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...extra,
  }
}

async function bootedRuntime(): Promise<{ ctx: Context; runtime: WorkspaceTreeRuntime }> {
  const ctx = new Context()
  await ctx.plugin(Loader)
  const runtime = new WorkspaceTreeRuntime(ctx)
  expect(runtime.available).toBe(true)
  return { ctx, runtime }
}

function events(): string[] {
  return ((globalThis as Record<string, unknown>).__wsEvents ?? []) as string[]
}

/** A resolvable main-tree fixture row (data: URL — no bare-name resolution needed). */
function mainFixtureSpecifier(): string {
  const code = "export default { name: 'main-fixture', apply() {} }"
  return `data:text/javascript,${encodeURIComponent(code)}`
}

describe('WorkspaceTreeRuntime', () => {
  it('disablePatchesFor collects every stable id from inserts and targets', () => {
    const raw = [
      { insert: [{ id: 'a', name: 'x' }, { name: 'no-id' }] },
      { id: 'b', config: { x: 1 } },
      { id: 'a', disabled: false },
    ]
    expect(disablePatchesFor(raw)).toEqual([
      { id: 'a', disabled: true },
      { id: 'b', disabled: true },
    ])
  })

  it('mounts bundle rows through a per-workspace include subtree and unmounts them', async () => {
    const dir = tempDir()
    const env = makeWorkspace(dir, PATCH)
    const { ctx, runtime } = await bootedRuntime()
    const target = entry(dir)

    const mounted = await runtime.mount(target)
    expect(mounted.mounted).toBe(true)
    expect(events()).toContain('apply:one')
    expect(events()).toContain('apply:two')

    // The include subtree lives in the ISOLATED workspace loader: the main
    // loader tree stays clean (see the dedicated isolation test).
    expect(env).toBe(join(dir, '.venv'))
    expect([...ctx.loader.entries()]).toEqual([])

    // Mounting again is idempotent.
    const again = await runtime.mount(target)
    expect(again.mounted).toBe(true)

    const unmounted = await runtime.unmount(target)
    expect(unmounted.mounted).toBe(true)
    expect(events()).toContain('dispose:one')
    expect(events()).toContain('dispose:two')

    const missing = await runtime.unmount(target)
    expect(missing.mounted).toBe(false)
  })

  it('disables and enables rows through disabled patches without uninstalling', async () => {
    const dir = tempDir()
    makeWorkspace(dir, PATCH)
    const { runtime } = await bootedRuntime()
    const target = entry(dir)

    await runtime.mount(target)
    expect(events()).toContain('apply:one')

    const disabled = await runtime.setDisabled(target, true)
    expect(disabled.mounted).toBe(true)
    expect(events()).toContain('dispose:one')
    expect(events()).toContain('dispose:two')

    const enabled = await runtime.setDisabled(target, false)
    expect(enabled.mounted).toBe(true)
    expect(events()).toContain('apply:one')
    expect(events()).toContain('apply:two')
  })

  it('rebuilds workspace subtrees from the ledger on a simulated restart', async () => {
    const dir = tempDir()
    makeWorkspace(dir, PATCH)
    const target = entry(dir)

    const first = await bootedRuntime()
    await first.runtime.mount(target)

    const second = await bootedRuntime()
    const reconciled = await second.runtime.reconcile([target])
    expect(reconciled.mounted).toBe(1)
    expect(reconciled.skipped).toEqual([])
    expect(events()).toContain('apply:one')
    // The workspace subtree is rebuilt inside the isolated loader; the main
    // tree of the second boot is still empty.
    expect([...second.ctx.loader.entries()]).toEqual([])
  })

  it('keeps a disabled entry disabled across a simulated restart', async () => {
    const dir = tempDir()
    makeWorkspace(dir, PATCH)
    const target = entry(dir, { disabled: true })

    const { runtime } = await bootedRuntime()
    await runtime.mount(target)
    // Disabled patches applied at mount: rows never activate.
    expect(events()).toEqual([])

    const reenabled = await runtime.setDisabled(target, false)
    expect(reenabled.mounted).toBe(true)
    expect(events()).toContain('apply:one')
  })

  it('skips entries without a resolvable bundle package', async () => {
    const dir = tempDir()
    mkdirSync(join(dir, '.venv'), { recursive: true })
    const { runtime } = await bootedRuntime()
    const reconciled = await runtime.reconcile([entry(dir)])
    expect(reconciled.mounted).toBe(0)
    expect(reconciled.skipped.length).toBe(1)
  })

  it('a broken workspace never fails the caller: mount degrades to a reason, not a throw', async () => {
    // Simulates a workspace whose .venv was wiped after the ledger entry was
    // written (uninstall of another plugin, manual cleanup). The mount must
    // report a reason — a throwing mount inside boot reconcile would fail the
    // whole profile, which is exactly the past incident we must not repeat.
    const dir = tempDir()
    mkdirSync(join(dir, '.venv'), { recursive: true }) // pkg and node_modules missing
    const { ctx, runtime } = await bootedRuntime()
    const result = await runtime.mount(entry(dir))
    expect(result.mounted).toBe(false)
    expect(result.reason.length).toBeGreaterThan(0)
    // The include subtree must not be left half-mounted.
    expect([...ctx.loader.entries()].some(item => item.options.name === 'cordis:include')).toBe(false)
    // A later reconcile with the workspace restored succeeds (no stuck state).
    makeWorkspace(dir, PATCH)
    const healed = await runtime.mount(entry(dir))
    expect(healed.mounted).toBe(true)
  })

  it('keeps workspace rows in the isolated loader: the main loader never sees them', async () => {
    const dir = tempDir()
    makeWorkspace(dir, PATCH)
    const { ctx, runtime } = await bootedRuntime()
    const target = entry(dir)

    const mounted = await runtime.mount(target)
    expect(mounted.mounted).toBe(true)
    expect(events()).toContain('apply:one')

    // The main loader tree is completely clean: no include entry, no rows.
    expect([...ctx.loader.entries()]).toEqual([])
    // The main loader still works normally (boot/HMR paths await it).
    const mainId = await ctx.loader.create({ name: mainFixtureSpecifier() } as never)
    await ctx.loader.await()
    expect(ctx.loader.resolve(mainId).options.name).toBe(mainFixtureSpecifier())
  })

  it('contains workspace row failures: a broken row does not fail main-loader awaits', async () => {
    const dir = tempDir()
    // .venv/pkg exists with a patch, but the row names a package that is
    // NOT installed in .venv/node_modules: the row import fails.
    const env = join(dir, '.venv')
    const pkg = join(env, 'pkg')
    mkdirSync(join(pkg, 'lib'), { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({
      name: '@fixture/ws-bundle',
      version: '1.0.0',
      type: 'module',
      main: 'lib/index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }))
    writeFileSync(join(pkg, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: ws-broken',
      "      name: '@missing/pkg'",
    ].join('\n'))
    writeFileSync(join(pkg, 'lib', 'index.js'), 'export default { name: "x", apply() {} }\n')
    const { ctx, runtime } = await bootedRuntime()
    const target = entry(dir)

    // mount degrades; the failure stays inside the workspace loader.
    const mounted = await runtime.mount(target)
    expect(mounted.mounted).toBe(false)

    // The main loader is untouched and its await() settles cleanly.
    const mainId = await ctx.loader.create({ name: mainFixtureSpecifier() } as never)
    await expect(ctx.loader.await()).resolves.toBeUndefined()
    expect(ctx.loader.resolve(mainId).options.name).toBe(mainFixtureSpecifier())
  })

  it('shares the event bus: the main context sees workspace row events', async () => {
    const dir = tempDir()
    makeWorkspace(dir, PATCH)
    const { ctx, runtime } = await bootedRuntime()
    const seen: string[] = []
    ctx.on('internal/plugin', (fiber: unknown) => {
      seen.push((fiber as { entry?: { options?: { id?: string } } }).entry?.options?.id ?? '')
    })
    await runtime.mount(entry(dir))
    // The workspace row fibers are visible on the shared event bus: the host's
    // client-modules registry (a main-context listener) can serve their
    // client faces without any bridging.
    expect(seen.some(id => id.startsWith('ws-row-'))).toBe(true)
  })
})
