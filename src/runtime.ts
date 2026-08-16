/**
 * Cordis hot-plug seam for installed plugins. The package-manager service is
 * itself a Cordis plugin, so installing another plugin does not require a
 * process restart: import the freshly linked module and `ctx.plugin()` it in
 * the current context. The returned fiber is the live component; disposing it
 * unwinds every effect the plugin registered. This is the runtime realization
 * of the paper's time-compositionality contract — uninstall removes the
 * provider, Cordis disposes its effects, and only then the package manager
 * replays the recorded inverse steps.
 * @module @dsh-ext/dsh-package-manager/runtime
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context, Fiber, Plugin } from '@deepseek-ai/cordis'
import type { LedgerEntry, PackageManagerRuntime, RuntimeMountResult } from './types.ts'

const NOT_BUNDLE: RuntimeMountResult = { mounted: false, reason: 'entry is not a hot-loadable dsh-bundle package' }

export class CordisRuntime implements PackageManagerRuntime {
  private readonly fibers = new Map<string, Fiber>()

  constructor(private readonly ctx: Context) {}

  private key(entry: LedgerEntry): string {
    return `${entry.profile}\u0000${entry.id}`
  }

  async mount(entry: LedgerEntry): Promise<RuntimeMountResult> {
    if (entry.adapter !== 'dsh-bundle' || entry.packageName === '') return NOT_BUNDLE
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
      return { mounted: true, reason: '' }
    } catch (error) {
      return { mounted: false, reason: messageOf(error) }
    }
  }

  async unmount(entry: LedgerEntry): Promise<RuntimeMountResult> {
    if (entry.adapter !== 'dsh-bundle' || entry.packageName === '') return NOT_BUNDLE
    const key = this.key(entry)
    try {
      const owned = this.fibers.get(key)
      if (owned !== undefined) {
        await owned.dispose()
        this.fibers.delete(key)
        return { mounted: true, reason: '' }
      }
      // Entry persisted across a service/process restart: it was loaded by the
      // profile bundle at startup, so find its module callback and dispose all
      // live fibers before the dependency link disappears.
      const loaded = await this.importPlugin(entry)
      const plugin = pluginOf(loaded)
      const runtime = this.ctx.registry.get(plugin)
      if (runtime !== undefined) {
        await Promise.all([...runtime.fibers].map(fiber => fiber.dispose()))
        this.ctx.registry.delete(plugin)
        return { mounted: true, reason: '' }
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
  private async importPlugin(entry: LedgerEntry): Promise<unknown> {
    if (entry.packageName.startsWith('data:') || entry.packageName.startsWith('file:')) {
      return import(/* @vite-ignore */ entry.packageName)
    }
    if (entry.profileDir !== undefined && entry.profileDir !== '') {
      const require = createRequire(join(entry.profileDir, 'package.json'))
      let resolved: string
      try {
        resolved = require.resolve(entry.packageName)
      } catch {
        resolved = resolvePackageEntry(require.resolve.paths(entry.packageName) ?? [], entry.packageName)
      }
      return import(pathToFileURL(resolved).href)
    }
    return import(/* @vite-ignore */ entry.packageName)
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
