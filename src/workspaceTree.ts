/**
 * Workspace-tree runtime: the workspace-as-subtree design, isolated.
 *
 * The DSH profile composition is a patch stack over an empty root config,
 * mounted through one root Include entry whose config.patches the host
 * recomposes. A plugin workspace is the same shape one level down: the
 * workspace's isolated .venv directory plays the profile role (empty
 * cordis.yml root + node_modules), and this runtime owns one Include subtree
 * per workspace whose config.patches carry the bundle's own patch list. The
 * Include anchors its baseUrl at the .venv directory, so the bundle patch
 * rows' bare package names resolve from .venv/node_modules exactly like a
 * profile resolves its dependencies.
 *
 * Fault containment: every workspace Include hangs under a SEPARATE Loader
 * service instance, provided on a private isolation label of a child context
 * (ctx.isolate('loader', ...)). Only the 'loader' service name is
 * isolated — services and the event bus stay global — so workspace plugins
 * still register into the shared tools/agents services and the host's
 * client-modules registry still sees their internal/plugin events. But a
 * failing workspace row only ever pollutes the workspace loader's own
 * await(): the main loader tree never sees the rows, the profile boot and
 * the host's user-layer HMR never await them, and the workspace can never
 * fail the main context.
 *
 * This replaces the profile-manifest channel for workspace installs: no
 * profile dependency, no dsh.profile.bundles row, no profile cordis.patch.yml
 * surgery, no InjectedProfileComposer overlay slicing. The include subtree is
 * the only composition surface, and the host's root Include entry is never
 * touched (so watchUserPatches can never race this runtime).
 * @module @dsh-ext/dsh-package-manager/workspaceTree
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Entry, EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { loadBundlePatch } from './bundlePatch.ts'
import { resolveBundlePackageDir } from './cordisRuntime.ts'
import type { LedgerEntry, PackageManagerRuntime, RuntimeMountResult, StepSpec } from './types.ts'

/** Stable loader-entry id of one workspace's Include subtree (no ':' — the loader resolves nested ids by ':' separators). */
export function workspaceIncludeId(profile: string, id: string): string {
  return `pm-ws-${safeIdPart(profile)}-${safeIdPart(id)}`
}

/** The managed composition root inside the workspace's .venv (mirrors profile cordis.yml). */
export function workspaceCompositionFile(pluginEnvDir: string): string {
  return join(pluginEnvDir, 'cordis.yml')
}

/**
 * Reset a workspace composition root to an empty list. Mirrors the host's
 * prepareProfile: the root is always rewritten, because the Include's
 * write-back can bake composed rows into the file; the durable truth lives in
 * the include entry's config.patches, recomputed from the ledger at boot.
 */
export function prepareWorkspaceComposition(pluginEnvDir: string): void {
  mkdirSync(pluginEnvDir, { recursive: true })
  writeFileSync(workspaceCompositionFile(pluginEnvDir), '[]\n')
}

/**
 * Disable patches for every stable id a bundle patch declares (insert rows
 * and id-targeted actions). Rows without ids cannot be targeted by patches;
 * real DSH bundles give their rows ids.
 */
export function disablePatchesFor(raw: Record<string, unknown>[]): Record<string, unknown>[] {
  const ids = new Set<string>()
  for (const patch of raw) {
    const insert = patch['insert']
    if (Array.isArray(insert)) {
      for (const row of insert) {
        const id = (row as Record<string, unknown>)['id']
        if (typeof id === 'string' && id !== '') ids.add(id)
      }
      continue
    }
    const id = patch['id']
    if (typeof id === 'string' && id !== '') ids.add(id)
  }
  return [...ids].map(id => ({ id, disabled: true }))
}

/** Locate the bundle package inside a workspace install: .venv/pkg, then the usual resolution anchors. */
export function workspacePackageDir(entry: LedgerEntry): string | undefined {
  if (entry.pluginEnvDir !== undefined && entry.pluginEnvDir !== '') {
    const pkg = join(entry.pluginEnvDir, 'pkg')
    try {
      if (loadBundlePatch(pkg) !== undefined) return pkg
    } catch {
      // fall through to the standard anchors
    }
  }
  return resolveBundlePackageDir(entry)
}

/** The patch list the workspace Include applies for one bundle package. */
export function bundlePatchList(packageDir: string): Record<string, unknown>[] | undefined {
  return loadBundlePatch(packageDir)?.raw
}

export interface WorkspaceInstallOptions {
  /** Materialized source directory (the bundle checkout). */
  sourceDir: string
  /** Isolated dependency layer (.venv) that becomes the workspace include root. */
  pluginEnvDir: string
  /** Bundle package name, recorded for the carrier dependency. */
  packageName: string
  /** Allow pnpm build scripts inside the env. */
  allowBuild: boolean
}

/**
 * Install steps for the workspace channel: snapshot the source into
 * .venv/pkg, declare it as the carrier env's own dependency (so pnpm links
 * it into .venv/node_modules and the Include subtree's bare-name rows
 * resolve), then install. No profile step exists in this list.
 */
export function workspaceBundleInstallSteps(options: WorkspaceInstallOptions): StepSpec[] {
  const carrier: Record<string, unknown> = {
    name: 'pm-workspace-env',
    version: '0.0.0',
    private: true,
    dependencies: { [options.packageName]: 'file:./pkg' },
  }
  const steps: StepSpec[] = [
    { uses: 'pluginEnv.create', path: options.pluginEnvDir },
    { uses: 'file.copy', from: options.sourceDir, to: join(options.pluginEnvDir, 'pkg') },
    { uses: 'file.write', path: join(options.pluginEnvDir, 'package.json'), content: JSON.stringify(carrier, undefined, 2) + '\n' },
  ]
  if (options.allowBuild) {
    steps.push({ uses: 'pluginEnv.allowBuild.add', dir: options.pluginEnvDir, package: options.packageName })
  }
  steps.push({ uses: 'pnpm', args: ['install'], cwd: options.pluginEnvDir, unargs: [] })
  return steps
}

const NOT_BUNDLE: RuntimeMountResult = { mounted: false, reason: 'entry is not a hot-loadable dsh-bundle package' }

/**
 * Per-workspace Include-subtree hot-plug seam, running in an isolated child
 * context with its own Loader service (see the module doc for the fault
 * containment model).
 *
 * Requires the main Loader service; without it the runtime reports
 * unavailable and the caller falls back to the legacy CordisRuntime.
 */
export class WorkspaceTreeRuntime implements PackageManagerRuntime {
  readonly channel = 'workspace' as const
  readonly composesProfile = false
  private readonly rootLoader: Loader | undefined
  private wsLoader: Loader | undefined
  private wsLoaderReady: Promise<Loader> | undefined
  private readonly includeIds = new Map<string, string>()

  constructor(private readonly ctx: Context) {
    this.rootLoader = ctx.get('loader') as Loader | undefined
  }

  /** True when a native loader tree is available for workspace subtrees. */
  get available(): boolean {
    return this.rootLoader !== undefined
  }

  /**
   * Lazily create the isolated workspace loader: a child context that maps
   * the 'loader' service to a private label, then a Loader plugin instance
   * provided under that label. The main loader is untouched, and the include
   * builtin is registered on the workspace loader (the main tree's builtins
   * are the host's business).
   */
  private workspaceLoader(): Promise<Loader> {
    if (this.wsLoader !== undefined) return Promise.resolve(this.wsLoader)
    this.wsLoaderReady ??= (async () => {
      const wsCtx = this.ctx.isolate('loader', Symbol('pm-workspace-loader'))
      await wsCtx.plugin(Loader)
      const loader = wsCtx.get('loader') as Loader
      loader.builtins.include = Include
      this.wsLoader = loader
      return loader
    })()
    return this.wsLoaderReady
  }

  private key(entry: LedgerEntry): string {
    return `${entry.profile}\u0000${entry.id}`
  }

  private async findInclude(key: string): Promise<Entry | undefined> {
    const id = this.includeIds.get(key)
    if (id === undefined) return undefined
    const loader = await this.workspaceLoader()
    for (const entry of loader.entries()) {
      if (entry.options.id === id) return entry
    }
    return undefined
  }

  private async ensureInclude(entry: LedgerEntry): Promise<Entry> {
    const key = this.key(entry)
    const existing = await this.findInclude(key)
    if (existing !== undefined) return existing
    if (entry.pluginEnvDir === undefined || entry.pluginEnvDir === '') {
      throw new Error(`workspace-tree: entry ${entry.id} has no pluginEnvDir`)
    }
    prepareWorkspaceComposition(entry.pluginEnvDir)
    const loader = await this.workspaceLoader()
    const created = await loader.create({
      id: workspaceIncludeId(entry.profile, entry.id),
      name: 'cordis:include',
      config: {
        path: pathToFileURL(workspaceCompositionFile(entry.pluginEnvDir)).href,
        initial: [],
      },
    } as unknown as Omit<EntryOptions, 'id'>)
    this.includeIds.set(key, created)
    await loader.await()
    const include = await this.findInclude(key)
    if (include === undefined) throw new Error(`workspace-tree: include entry ${created} did not settle`)
    return include
  }

  /**
   * Build the patch list the workspace include applies for one entry. Every
   * call deep-clones the parsed bundle patch: the include pushes insert rows
   * into the tree BY REFERENCE and later id-targeted patches mutate those
   * objects in place (the host documents the same insert-aliasing hazard for
   * its live user-layer recomposition), so a reused object would bake disable
   * state into the cached raw list.
   */
  private buildPatches(entry: LedgerEntry, disabled: boolean): Record<string, unknown>[] | undefined {
    const packageDir = workspacePackageDir(entry)
    if (packageDir === undefined) return undefined
    const raw = bundlePatchList(packageDir)
    if (raw === undefined) return undefined
    const patches = disabled ? [...raw, ...disablePatchesFor(raw)] : raw
    return this.resolveBareRows(structuredClone(patches), entry)
  }

  /** Patches the workspace include should carry for one entry, disabled state included. */
  private patchesFor(entry: LedgerEntry): Record<string, unknown>[] | undefined {
    return this.buildPatches(entry, entry.disabled === true)
  }

  /**
   * Fallback for hosts without the Node module hooks (`loader.internal`):
   * the include cannot resolve bare package names from its baseUrl, so every
   * insert row's bare `name` is rewritten to the resolved file URL inside the
   * workspace env — the same fallback CordisRuntime applies to package roots.
   * With the hooks present (the real dsh boot), rows stay untouched and the
   * include resolves them from .venv/node_modules natively. The module hooks
   * are process-global, so the main loader's `internal` also describes the
   * workspace loader.
   */
  private resolveBareRows(patches: Record<string, unknown>[], entry: LedgerEntry): Record<string, unknown>[] {
    if (this.rootLoader?.internal !== undefined) return patches
    const envDir = entry.pluginEnvDir
    if (envDir === undefined || envDir === '') return patches
    let require: NodeJS.Require
    try {
      require = createRequire(join(envDir, 'package.json'))
    } catch {
      return patches
    }
    return patches.map(patch => {
      const insert = patch['insert']
      if (!Array.isArray(insert)) return patch
      const rows = insert.map(row => {
        const record = row as Record<string, unknown>
        const name = record['name']
        if (typeof name !== 'string' || name === '' || name.startsWith('.') || name.startsWith('cordis:')) return row
        try {
          return { ...record, name: pathToFileURL(require.resolve(name)).href }
        } catch {
          return row
        }
      })
      return { ...patch, insert: rows }
    })
  }

  async mount(entry: LedgerEntry): Promise<RuntimeMountResult> {
    if (entry.adapter !== 'dsh-bundle' || entry.packageName === '') return NOT_BUNDLE
    const patches = this.patchesFor(entry)
    if (patches === undefined) {
      return { mounted: false, reason: 'workspace bundle package not found or declares no dsh.bundle.patch' }
    }
    try {
      const include = await this.ensureInclude(entry)
      const config = include.options.config as { patches?: Record<string, unknown>[] }
      await include.update({ config: { ...config, patches } })
      await (await this.workspaceLoader()).await()
      return { mounted: true, reason: `mounted ${patches.length} workspace bundle patch row(s) through ${include.options.id}` }
    } catch (error) {
      return { mounted: false, reason: messageOf(error) }
    }
  }

  async unmount(entry: LedgerEntry): Promise<RuntimeMountResult> {
    if (entry.adapter !== 'dsh-bundle' || entry.packageName === '') return NOT_BUNDLE
    const key = this.key(entry)
    const include = await this.findInclude(key)
    if (include === undefined) return { mounted: false, reason: 'no workspace include entry is mounted' }
    try {
      await include.parent.remove(include.id)
      this.includeIds.delete(key)
      await (await this.workspaceLoader()).await()
      return { mounted: true, reason: 'removed the workspace include entry from the workspace loader tree' }
    } catch (error) {
      return { mounted: false, reason: messageOf(error) }
    }
  }

  async setDisabled(entry: LedgerEntry, disabled: boolean): Promise<RuntimeMountResult> {
    if (entry.adapter !== 'dsh-bundle' || entry.packageName === '') return NOT_BUNDLE
    const raw = bundlePatchList(workspacePackageDir(entry) ?? '')
    const disables = raw === undefined ? [] : disablePatchesFor(raw)
    if (disables.length === 0) return { mounted: false, reason: 'workspace bundle declares no rows with stable ids to disable' }
    const patches = this.buildPatches(entry, disabled)
    if (patches === undefined) return { mounted: false, reason: 'workspace bundle package not found or declares no dsh.bundle.patch' }
    try {
      const include = await this.ensureInclude(entry)
      const config = include.options.config as { patches?: Record<string, unknown>[] }
      await include.update({ config: { ...config, patches } })
      await (await this.workspaceLoader()).await()
      return { mounted: true, reason: `${disabled ? 'disabled' : 'enabled'} ${disables.length} workspace bundle row(s) through the workspace include` }
    } catch (error) {
      return { mounted: false, reason: messageOf(error) }
    }
  }

  /**
   * Boot-time reconcile: rebuild every workspace Include subtree from the
   * ledger so a restart needs no profile-manifest state. Skipped entries are
   * reported with their reasons; failed mounts keep the entry installed (the
   * failure is surfaced, not destructive).
   */
  async reconcile(entries: LedgerEntry[]): Promise<{ mounted: number; skipped: string[] }> {
    const skipped: string[] = []
    let mounted = 0
    for (const entry of entries) {
      if (entry.adapter !== 'dsh-bundle' || entry.packageName === '' || entry.pluginEnvDir === undefined || entry.pluginEnvDir === '') {
        skipped.push(`${entry.profile}/${entry.id}: not a workspace dsh-bundle entry`)
        continue
      }
      const result = await this.mount(entry)
      if (result.mounted) mounted += 1
      else skipped.push(`${entry.profile}/${entry.id}: ${result.reason}`)
    }
    return { mounted, skipped }
  }
}

function safeIdPart(value: string): string {
  const safe = value.replaceAll(/[^A-Za-z0-9._-]/g, '-')
  return safe.length > 0 ? safe : 'plugin'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
