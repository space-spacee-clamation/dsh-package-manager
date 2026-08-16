/**
 * Cordis hot-plug seam for installed plugins.
 *
 * Native path first: when the package-manager runs inside a DSH boot (it does
 * in every profile), `ctx.loader` owns the original Cordis Loader tree that
 * DSH itself boots and HMR-reloads. Installed plugins become ordinary loader
 * entries (`name: <packageName>`), so they receive the exact same lifecycle,
 * config update, and HMR behaviour as rows in `cordis.patch.yml` — no parallel
 * fiber bookkeeping.
 *
 * Fallback path: outside a loader tree (unit tests, synthetic contexts), the
 * old `import + ctx.plugin()` path still applies.
 *
 * Uninstall removes the matching loader entry BEFORE inverse steps replay, so
 * the provider disappears through the native unload path.
 * @module @dsh-ext/dsh-package-manager/runtime
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context, Fiber, Plugin } from '@deepseek-ai/cordis'
import type { Entry, Loader } from '@deepseek-ai/cordis-plugin-loader'
import type { LedgerEntry, PackageManagerRuntime, RuntimeMountResult } from './types.ts'

const NOT_BUNDLE: RuntimeMountResult = { mounted: false, reason: 'entry is not a hot-loadable dsh-bundle package' }

export class CordisRuntime implements PackageManagerRuntime {
  private readonly loader: Loader | undefined
  private readonly loaderEntries = new Map<string, string>()
  private readonly fibers = new Map<string, Fiber>()

  constructor(private readonly ctx: Context) {
    this.loader = ctx.get('loader') as Loader | undefined
  }

  private key(entry: LedgerEntry): string {
    return `${entry.profile}\u0000${entry.id}`
  }

  private findLoaderEntry(packageName: string): Entry | undefined {
    if (this.loader === undefined) return undefined
    for (const entry of this.loader.entries()) {
      if (entry.options.name === packageName) return entry
    }
    return undefined
  }

  async mount(entry: LedgerEntry): Promise<RuntimeMountResult> {
    if (entry.adapter !== 'dsh-bundle' || entry.packageName === '') return NOT_BUNDLE
    if (this.loader !== undefined) return this.mountNative(entry)
    return this.mountFallback(entry)
  }

  async unmount(entry: LedgerEntry): Promise<RuntimeMountResult> {
    if (entry.adapter !== 'dsh-bundle' || entry.packageName === '') return NOT_BUNDLE
    if (this.loader !== undefined) return this.unmountNative(entry)
    return this.unmountFallback(entry)
  }

  private async mountNative(entry: LedgerEntry): Promise<RuntimeMountResult> {
    const loader = this.loader!
    try {
      const existing = this.findLoaderEntry(entry.packageName)
      if (existing !== undefined) {
        if (existing.disabled) await existing.update({ disabled: false })
        this.loaderEntries.set(this.key(entry), existing.id)
        return { mounted: true, reason: 'already present in the native Cordis loader tree' }
      }
      // Loader without Node's internal module loader cannot resolve bare
      // package names from ctx.baseUrl; use the resolved absolute entrypoint
      // for the entry, preserving the native loader lifecycle in that case.
      const name = loader.internal === undefined ? await this.resolvePluginUrl(entry) : entry.packageName
      const id = await loader.create({ name })
      this.loaderEntries.set(this.key(entry), id)
      await loader.await()
      return { mounted: true, reason: 'mounted through ctx.loader (native HMR lifecycle)' }
    } catch (error) {
      return { mounted: false, reason: messageOf(error) }
    }
  }

  private async unmountNative(entry: LedgerEntry): Promise<RuntimeMountResult> {
    try {
      const key = this.key(entry)
      let target = this.resolveOwnedLoaderEntry(key)
      if (target === undefined) {
        target = this.findLoaderEntry(entry.packageName)
      }
      if (target === undefined) {
        return { mounted: false, reason: `${entry.packageName} has no native loader entry` }
      }
      await target.parent.remove(target.id)
      this.loaderEntries.delete(key)
      await this.loader!.await()
      return { mounted: true, reason: 'removed from ctx.loader (native HMR lifecycle)' }
    } catch (error) {
      return { mounted: false, reason: messageOf(error) }
    }
  }

  private resolveOwnedLoaderEntry(key: string): Entry | undefined {
    const id = this.loaderEntries.get(key)
    if (id === undefined) return undefined
    try {
      return this.loader!.resolve(id)
    } catch {
      this.loaderEntries.delete(key)
      return undefined
    }
  }

  private async mountFallback(entry: LedgerEntry): Promise<RuntimeMountResult> {
    const key = this.key(entry)
    if (this.fibers.has(key)) return { mounted: false, reason: 'already hot-mounted by this package-manager instance' }
    try {
      const loaded = await this.importPlugin(entry)
      const plugin = pluginOf(loaded)
      if (this.ctx.registry.has(plugin)) {
        return { mounted: false, reason: `${entry.packageName} is already active in the Cordis registry` }
      }
      const fiber = this.ctx.plugin(plugin)
      await fiber
      this.fibers.set(key, fiber)
      return { mounted: true, reason: 'ctx.plugin fallback (no native loader)' }
    } catch (error) {
      return { mounted: false, reason: messageOf(error) }
    }
  }

  private async unmountFallback(entry: LedgerEntry): Promise<RuntimeMountResult> {
    const key = this.key(entry)
    try {
      const owned = this.fibers.get(key)
      if (owned !== undefined) {
        await owned.dispose()
        this.fibers.delete(key)
        return { mounted: true, reason: 'disposed ctx.plugin fallback fiber' }
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
