/**
 * Cordis hot-plug seam for installed plugins.
 *
 * Native path: when the package-manager runs inside a DSH boot, `ctx.loader`
 * owns the original Cordis Loader tree that DSH itself boots and HMR-reloads.
 * A dsh-bundle is not itself the plugin — its `dsh.bundle.patch` is the
 * distribution format. Hot-plugging therefore mounts the bundle's patch rows
 * through the loader with stable ids, applies id-targeted patches against the
 * rows already present in the boot tree, and disables/enables those same rows
 * through the native `disabled` field. There is no parallel fiber bookkeeping
 * and no import-the-bundle-package shortcut.
 *
 * Fallback path: outside a loader tree (unit tests, synthetic contexts), the
 * old `import + ctx.plugin()` path still applies.
 * @module @dsh-ext/dsh-package-manager/cordisRuntime
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context, Fiber, Plugin } from '@deepseek-ai/cordis'
import type { Entry, EntryOptions, Loader } from '@deepseek-ai/cordis-plugin-loader'
import { loadBundlePatch, stablePatchRowId, type BundlePatchAction, type BundlePatchRow } from './bundlePatch.ts'
import { InjectedProfileComposer } from './injectedProfileComposer.ts'
import type { LedgerEntry, PackageManagerRuntime, RuntimeMountResult } from './types.ts'

/** Optional app-boot service: recomposes the profile include with persisted bundle layers. */
interface ProfileComposer {
  recompose(): Promise<void>
}
const NOT_BUNDLE: RuntimeMountResult = { mounted: false, reason: 'entry is not a hot-loadable dsh-bundle package' }

interface LoaderRow {
  /** The patch row id (`undefined` for rows that declared no stable id). */
  rowId?: string
  /** Loader entry id returned by `loader.create`. */
  entryId: string
}

interface FallbackRow {
  plugin: Plugin
  config: unknown
  fiber: Fiber
}

export class CordisRuntime implements PackageManagerRuntime {
  private readonly loader: Loader | undefined
  private readonly composer: ProfileComposer | undefined
  private readonly loaderRows = new Map<string, LoaderRow[]>()
  private readonly fallbackRows = new Map<string, FallbackRow[]>()
  readonly composesProfile: boolean

  constructor(private readonly ctx: Context) {
    this.loader = ctx.get('loader') as Loader | undefined
    if (this.loader !== undefined) {
      // The host exposes no profileComposer service; recomposition goes
      // through the injected composer, which delegates layer computation to
      // the host's own dsh-app-boot functions when that package resolves.
      try {
        const injected = new InjectedProfileComposer(ctx)
        if (injected.available) this.composer = injected
      } catch {
        // Fall back to direct loader-row mounting below.
      }
    }
    this.composesProfile = this.composer !== undefined
  }

  private key(entry: LedgerEntry): string {
    return `${entry.profile}\u0000${entry.id}`
  }

  async mount(entry: LedgerEntry): Promise<RuntimeMountResult> {
    if (entry.adapter !== 'dsh-bundle' || entry.packageName === '') return NOT_BUNDLE
      if (this.composer !== undefined) return this.recomposeComposition('mounted profile composition through the root include')
    const packageDir = resolveBundlePackageDir(entry)
    const patch = packageDir === undefined ? undefined : loadBundlePatch(packageDir)
    if (this.loader !== undefined) {
      return patch === undefined ? this.mountNativePackage(entry) : this.mountNativePatch(entry, patch.actions)
    }
    return patch === undefined ? this.mountFallbackPackage(entry) : this.mountFallbackPatch(entry, patch.actions)
  }

  async unmount(entry: LedgerEntry): Promise<RuntimeMountResult> {
    if (entry.adapter !== 'dsh-bundle' || entry.packageName === '') return NOT_BUNDLE
      if (this.composer !== undefined) return this.recomposeComposition('unmounted profile composition through the root include')
    if (this.loader !== undefined) return this.unmountNative(entry)
    return this.unmountFallback(entry)
  }

  async setDisabled(entry: LedgerEntry, disabled: boolean): Promise<RuntimeMountResult> {
    if (entry.adapter !== 'dsh-bundle' || entry.packageName === '') return NOT_BUNDLE
      if (this.composer !== undefined) return this.recomposeComposition(`${disabled ? 'disabled' : 'enabled'} profile composition through the root include`)
    if (this.loader !== undefined) return this.setDisabledNative(entry, disabled)
    return this.setDisabledFallback(entry, disabled)
  }
    private async recomposeComposition(reason: string): Promise<RuntimeMountResult> {
      if (this.composer === undefined) return { mounted: false, reason: 'root include composition is not available' }
      try {
        await this.composer.recompose()
        return { mounted: true, reason }
      } catch (error) {
        return { mounted: false, reason: messageOf(error) }
      }
    }

  // ------------------------------------------------------------------ native

  private async mountNativePatch(entry: LedgerEntry, actions: BundlePatchAction[]): Promise<RuntimeMountResult> {
    const loader = this.loader!
    const key = this.key(entry)
    const owned: LoaderRow[] = []
    const byRowId = new Map<string, Entry>()
    try {
      let fallbackIndex = 0
      for (const action of actions) {
        if (action.insert) {
          for (const row of action.rows) {
            const rowId = typeof row['id'] === 'string' && row['id'] !== '' ? row['id'] : undefined
            const options = {
              ...row,
              id: rowId ?? stablePatchRowId(entry.profile, entry.id, fallbackIndex++),
            } as unknown as Omit<EntryOptions, 'id'> & { id: string }
            const entryId = await loader.create(options as unknown as Omit<EntryOptions, 'id'>)
            owned.push(rowId === undefined ? { entryId } : { rowId, entryId })
            try {
              const created = loader.resolve(entryId)
              if (rowId !== undefined) byRowId.set(rowId, created)
            } catch {
              // The tree may have been disposed concurrently; creation still
              // owns the row for the final await below.
            }
          }
          continue
        }

        const target = byRowId.get(action.id) ?? this.findLoaderEntryById(action.id)
        if (target === undefined) continue
        const fields: BundlePatchRow = { ...action.fields }
        delete fields['id']
        delete fields['insert']
        await target.update(fields as Partial<EntryOptions>)
      }
      await loader.await()
      this.loaderRows.set(key, owned)
      return { mounted: true, reason: `mounted ${owned.length} bundle patch row(s) through ctx.loader` }
    } catch (error) {
      // Best effort: remove the rows this attempt created so a retry starts clean.
      for (const row of owned.reverse()) {
        try {
          const entry = loader.resolve(row.entryId)
          await entry.parent.remove(entry.id)
        } catch {}
      }
      return { mounted: false, reason: messageOf(error) }
    }
  }

  private async mountNativePackage(entry: LedgerEntry): Promise<RuntimeMountResult> {
    const loader = this.loader!
    try {
      const existing = this.findLoaderEntryByName(entry.packageName)
      if (existing !== undefined) {
        if (existing.disabled) await existing.update({ disabled: false })
        return { mounted: true, reason: 'package root already present in the native Cordis loader tree' }
      }
      const name = loader.internal === undefined ? await this.resolvePluginUrl(entry) : entry.packageName
      const id = await loader.create({ name } as Omit<EntryOptions, 'id'>)
      this.loaderRows.set(this.key(entry), [{ entryId: id }])
      await loader.await()
      return { mounted: true, reason: 'mounted package root through ctx.loader (legacy bundle shape)' }
    } catch (error) {
      return { mounted: false, reason: messageOf(error) }
    }
  }

  private async unmountNative(entry: LedgerEntry): Promise<RuntimeMountResult> {
    const loader = this.loader!
    try {
      const key = this.key(entry)
      const owned = this.loaderRows.get(key)
      if (owned !== undefined && owned.length > 0) {
        for (const row of [...owned].reverse()) {
          const target = loader.resolve(row.entryId)
          await target.parent.remove(target.id)
        }
        this.loaderRows.delete(key)
        await loader.await()
        return { mounted: true, reason: 'removed owned bundle patch rows from ctx.loader' }
      }

      // After a process restart the loader no longer has our private id map.
      // Re-read the installed bundle patch and remove the rows it contributed
      // by their stable patch-row ids.
      const packageDir = resolveBundlePackageDir(entry)
      const patch = packageDir === undefined ? undefined : loadBundlePatch(packageDir)
      if (patch !== undefined) {
        let removed = 0
        for (const row of patch.rows) {
          if (typeof row['id'] !== 'string' || row['id'] === '') continue
          const target = this.findLoaderEntryById(row['id'])
          if (target === undefined) continue
          await target.parent.remove(target.id)
          removed += 1
        }
        if (removed > 0) {
          await loader.await()
          return { mounted: true, reason: `removed ${removed} bundle patch row(s) from ctx.loader` }
        }
      }

      const target = this.findLoaderEntryByName(entry.packageName)
      if (target === undefined) {
        return { mounted: false, reason: `${entry.packageName} has no live native loader entry` }
      }
      await target.parent.remove(target.id)
      this.loaderRows.delete(key)
      await loader.await()
      return { mounted: true, reason: 'removed package root from ctx.loader (legacy bundle shape)' }
    } catch (error) {
      return { mounted: false, reason: messageOf(error) }
    }
  }

  private async setDisabledNative(entry: LedgerEntry, disabled: boolean): Promise<RuntimeMountResult> {
    const loader = this.loader!
    try {
      const targets: Entry[] = []
      const owned = this.loaderRows.get(this.key(entry))
      if (owned !== undefined && owned.length > 0) {
        for (const row of owned) targets.push(loader.resolve(row.entryId))
      } else {
        const packageDir = resolveBundlePackageDir(entry)
        const patch = packageDir === undefined ? undefined : loadBundlePatch(packageDir)
        if (patch !== undefined) {
          for (const row of patch.rows) {
            if (typeof row['id'] !== 'string' || row['id'] === '') continue
            const target = this.findLoaderEntryById(row['id'])
            if (target !== undefined) targets.push(target)
          }
        }
      }
      if (targets.length === 0) return { mounted: false, reason: `${entry.packageName} has no patch rows with stable ids in ctx.loader` }
      for (const target of targets) await target.update({ disabled } as Partial<EntryOptions>)
      await loader.await()
      return { mounted: true, reason: `${disabled ? 'disabled' : 'enabled'} ${targets.length} bundle patch row(s) through ctx.loader` }
    } catch (error) {
      return { mounted: false, reason: messageOf(error) }
    }
  }

  private findLoaderEntryById(id: string): Entry | undefined {
    for (const entry of this.loader!.entries()) {
      if (entry.options.id === id) return entry
    }
    return undefined
  }

  private findLoaderEntryByName(packageName: string): Entry | undefined {
    for (const entry of this.loader!.entries()) {
      if (entry.options.name === packageName) return entry
    }
    return undefined
  }

  // ----------------------------------------------------------------- fallback

  private async mountFallbackPatch(entry: LedgerEntry, actions: BundlePatchAction[]): Promise<RuntimeMountResult> {
    const key = this.key(entry)
    const rows: FallbackRow[] = []
    try {
      let fallbackIndex = 0
      for (const action of actions) {
        if (!action.insert) continue
        for (const row of action.rows) {
          if (typeof row['name'] !== 'string' || row['name'] === '') continue
          const loaded = await this.importSpecifier(row['name'], entry)
          const plugin = pluginOf(loaded)
          const fiber = this.ctx.plugin(plugin as Plugin.Function, row['config']) as Fiber & PromiseLike<Fiber>
          await fiber
          rows.push({ plugin, config: row['config'], fiber })
        }
        void fallbackIndex
      }
      if (rows.length === 0) return { mounted: false, reason: 'bundle patch inserts no importable rows' }
      this.fallbackRows.set(key, rows)
      return { mounted: true, reason: `mounted ${rows.length} bundle patch row(s) with ctx.plugin fallback` }
    } catch (error) {
      for (const row of rows.reverse()) await row.fiber.dispose()
      return { mounted: false, reason: messageOf(error) }
    }
  }

  private async mountFallbackPackage(entry: LedgerEntry): Promise<RuntimeMountResult> {
    const key = this.key(entry)
    if (this.fallbackRows.has(key)) return { mounted: false, reason: 'already hot-mounted by this package-manager instance' }
    try {
      const loaded = await this.importPlugin(entry)
      const plugin = pluginOf(loaded)
      if (this.ctx.registry.has(plugin)) {
        return { mounted: false, reason: `${entry.packageName} is already active in the Cordis registry` }
      }
      const fiber = this.ctx.plugin(plugin)
      await fiber
      this.fallbackRows.set(key, [{ plugin, config: undefined, fiber }])
      return { mounted: true, reason: 'ctx.plugin fallback (no native loader)' }
    } catch (error) {
      return { mounted: false, reason: messageOf(error) }
    }
  }

  private async unmountFallback(entry: LedgerEntry): Promise<RuntimeMountResult> {
    const key = this.key(entry)
    try {
      const owned = this.fallbackRows.get(key)
      if (owned !== undefined && owned.length > 0) {
        await Promise.all([...owned].reverse().map(row => row.fiber.dispose()))
        this.fallbackRows.delete(key)
        return { mounted: true, reason: 'disposed ctx.plugin fallback fibers' }
      }
      const loaded = await this.importPlugin(entry)
      const plugin = pluginOf(loaded)
      const runtime = this.ctx.registry.get(plugin)
      if (runtime !== undefined) {
        await Promise.all([...runtime.fibers].map(fiber => fiber.dispose()))
        this.ctx.registry.delete(plugin)
        return { mounted: true, reason: 'disposed active registry fibers' }
      }
      return { mounted: false, reason: `${entry.packageName} has no live Cordis fiber` }
    } catch (error) {
      return { mounted: false, reason: messageOf(error) }
    }
  }

  private async setDisabledFallback(entry: LedgerEntry, disabled: boolean): Promise<RuntimeMountResult> {
    const key = this.key(entry)
    const owned = this.fallbackRows.get(key)
    if (disabled) {
      if (owned === undefined || owned.length === 0) return { mounted: false, reason: 'no live fallback fiber to disable' }
      await Promise.all(owned.map(row => row.fiber.dispose()))
      return { mounted: true, reason: 'disposed ctx.plugin fallback fibers (rows are remembered for enable)' }
    }
    if (owned === undefined || owned.length === 0) return { mounted: false, reason: 'no remembered fallback rows to enable' }
    const restored: FallbackRow[] = []
    try {
      for (const row of owned) {
        const fiber = this.ctx.plugin(row.plugin as Plugin.Function, row.config) as Fiber & PromiseLike<Fiber>
        await fiber
        restored.push({ ...row, fiber })
      }
      this.fallbackRows.set(key, restored)
      return { mounted: true, reason: 're-mounted ctx.plugin fallback fibers' }
    } catch (error) {
      for (const row of restored.reverse()) await row.fiber.dispose()
      return { mounted: false, reason: messageOf(error) }
    }
  }

  // --------------------------------------------------------------- resolution

  /**
   * Resolve the package entrypoint through the target profile's node_modules.
   * This also works when dsh-package-manager itself is linked from outside
   * the profile: a bare dynamic import would resolve relative to THIS module,
   * while the installed plugin is linked into the profile.
   */
  private async resolvePluginUrl(entry: LedgerEntry): Promise<string> {
    if (entry.packageName.startsWith('data:') || entry.packageName.startsWith('file:')) {
      return entry.packageName
    }
    if (entry.profileDir !== undefined && entry.profileDir !== '') {
      const require = createRequire(join(entry.profileDir, 'package.json'))
      let resolved: string
      try {
        resolved = require.resolve(entry.packageName)
      } catch {
        resolved = resolvePackageEntry(require.resolve.paths(entry.packageName) ?? [], entry.packageName)
      }
      return pathToFileURL(resolved).href
    }
    return entry.packageName
  }

  private async importPlugin(entry: LedgerEntry): Promise<unknown> {
    return import(/* @vite-ignore */ await this.resolvePluginUrl(entry))
  }

  private async importSpecifier(specifier: string, entry: LedgerEntry): Promise<unknown> {
    const target: LedgerEntry = { ...entry, packageName: specifier }
    return import(/* @vite-ignore */ await this.resolvePluginUrl(target))
  }
}

/** Resolve the installed bundle package directory for one ledger entry. */
export function resolveBundlePackageDir(entry: LedgerEntry): string | undefined {
  const packageName = entry.packageName
  if (entry.profileDir !== undefined && entry.profileDir !== '' && packageName !== '') {
    const dir = probePackageDir(entry.profileDir, packageName)
    if (dir !== undefined) return dir
  }
  if (entry.materializedDir !== '') {
    if (existsSync(join(entry.materializedDir, 'package.json'))) return entry.materializedDir
  }
  if (entry.pluginEnvDir !== undefined && entry.pluginEnvDir !== '') {
    if (existsSync(join(entry.pluginEnvDir, 'package.json'))) return entry.pluginEnvDir
    if (packageName !== '') {
      const dir = probePackageDir(entry.pluginEnvDir, packageName)
      if (dir !== undefined) return dir
    }
  }
  return undefined
}

function probePackageDir(anchor: string, packageName: string): string | undefined {
  const paths = createRequire(join(anchor, 'package.json')).resolve.paths(packageName) ?? []
  for (const searchPath of paths) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

function resolvePackageEntry(searchPaths: string[], packageName: string): string {
  for (const searchPath of searchPaths) {
    const root = join(searchPath, packageName)
    const manifestPath = join(root, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      main?: string
      module?: string
      exports?: string | Record<string, string | { default?: string; import?: string; require?: string }>
    }
    const exportRoot = typeof manifest.exports === 'string'
      ? manifest.exports
      : typeof manifest.exports === 'object' && manifest.exports !== null
        ? exportTargetOf(manifest.exports['.'])
        : undefined
    const entry = exportRoot ?? manifest.module ?? manifest.main ?? 'index.js'
    return join(root, entry)
  }
  throw new Error(`cannot resolve package entrypoint for ${JSON.stringify(packageName)}`)
}

function exportTargetOf(target: string | { default?: string; import?: string; require?: string } | undefined): string | undefined {
  if (typeof target === 'string') return target
  return target?.default ?? target?.import ?? target?.require
}

function pluginOf(loaded: unknown): Plugin {
  const record = loaded as { default?: unknown } | null
  const candidate = record !== null && typeof record === 'object' && 'default' in record && record.default !== undefined
    ? record.default
    : loaded
  if (typeof candidate === 'function') return candidate as Plugin
  if (candidate !== null && typeof candidate === 'object' && typeof (candidate as { apply?: unknown }).apply === 'function') {
    return candidate as Plugin
  }
  throw new Error('plugin module has no function, class, or { apply } entrypoint')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
