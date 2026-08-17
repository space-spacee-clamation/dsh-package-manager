/**
 * Injected profile composer: the package-manager plugin applies profile
 * recomposition without any host source change.
 *
 * The host has no `profileComposer` service — its composition lives in the
 * `@deepseek-ai/dsh-app-boot` package as pure functions (`loadProfile`,
 * `loadOptionalPatches`) plus the root Include entry's `config.patches`
 * update channel (the same channel `watchUserPatches` uses). When that
 * package resolves from the running installation, this composer delegates
 * layer computation to it verbatim; the self-contained fallback below only
 * serves CLI runs and tests where the host package is absent.
 *
 * Launcher overlays (--patch, agent presets, telemetry rows) are preserved by
 * capturing the boot include's patch-list suffix at construction time. The
 * host keeps its own overlay list private, so the count-based slice is the
 * only in-band mechanism available.
 * @module @dsh-ext/dsh-package-manager/injectedProfileComposer
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Entry, Loader } from '@deepseek-ai/cordis-plugin-loader'
import { parsePatchObjects } from './bundlePatch.ts'
import { resolveHome } from './paths.ts'

type PatchObject = Record<string, unknown>

/** Structural slice of `@deepseek-ai/dsh-app-boot` used at runtime. */
interface HostProfile {
  name: string
  dir: string
  layers: { packageName: string; packageDir: string; patchPath: string; patches: PatchObject[] }[]
  patchPath: string
  patches: PatchObject[]
}

interface HostAppBoot {
  loadProfile(binName: string, name: string, installAnchor: string, home: string, options?: { userLayer?: boolean }): HostProfile
  loadOptionalPatches(binName: string, file: string): PatchObject[] | undefined
}

const BIN_NAME = 'dsh-package-manager'
const HOME_PATCH_FILENAME = 'cordis.patch.yml'

export class InjectedProfileComposer {
  private profileDir: string
  private profileName: string
  private home: string
  private overlays: PatchObject[] = []
  private initialized = false
  private appBoot: HostAppBoot | undefined
  private appBootPending: Promise<{ module: HostAppBoot; anchor: string } | undefined> | undefined
  readonly available: boolean

  constructor(private readonly ctx: Context, home = resolveHome()) {
    this.profileDir = this.resolveProfileDir()
    this.profileName = basename(this.profileDir)
    this.home = home
    const entry = this.findIncludeEntry()
    this.available = entry !== undefined
    if (entry !== undefined) this.captureOverlays(entry)
  }

  async recompose(): Promise<void> {
    const entry = this.findIncludeEntry()
    if (entry === undefined) throw new Error('profileComposer: root include entry not found')
    if (!this.initialized) this.captureOverlays(entry)
    const patches = structuredClone(await this.computeLayers())
    const config = entry.options.config as { path: string; patches?: PatchObject[] }
    await entry.update({ config: { ...config, patches } })
  }

  private captureOverlays(entry: Entry): void {
    const bootPatches = this.patchesOf(entry)
    const layers = this.readLayersFallback()
    const known = layers.bundlePatches.length + layers.profilePatches.length + layers.homePatches.length
    this.overlays = bootPatches.slice(known)
    this.initialized = true
  }

  private patchesOf(entry: Entry): PatchObject[] {
    const config = entry.options.config as { patches?: PatchObject[] } | undefined
    return config?.patches ?? []
  }

  private findIncludeEntry(): Entry | undefined {
    const loader = this.ctx.get('loader') as Loader | undefined
    if (loader === undefined) return undefined
    for (const entry of loader.entries()) {
      if (entry.options.id === 'include') return entry
    }
    return undefined
  }

  /**
   * Compute the flat patch list the boot include replays, in host order:
   * bundle layers (dsh.profile.bundles order) → profile user layer → home
   * user layer → captured launcher overlays. Delegates to the host's own
   * `dsh-app-boot` functions whenever that package resolves.
   */
  private async computeLayers(): Promise<PatchObject[]> {
    const boot = await this.loadHostAppBoot()
    if (boot !== undefined) {
      const profile = boot.module.loadProfile(BIN_NAME, this.profileName, boot.anchor, this.home)
      const bundlePatches = profile.layers.flatMap(layer => layer.patches)
      const homePatches = boot.module.loadOptionalPatches(BIN_NAME, join(this.home, HOME_PATCH_FILENAME)) ?? []
      return [...bundlePatches, ...profile.patches, ...homePatches, ...this.overlays]
    }
    const layers = this.readLayersFallback()
    return [...layers.bundlePatches, ...layers.profilePatches, ...layers.homePatches, ...this.overlays]
  }

  /**
   * Resolve the host's `dsh-app-boot` package from this plugin's own module
   * scope (profiles resolve in-box packages through the installation first,
   * so this hits the running dsh's copy). The resolved package.json doubles
   * as the installation anchor for `loadProfile` bundle resolution.
   */
  private loadHostAppBoot(): Promise<{ module: HostAppBoot; anchor: string } | undefined> {
    if (this.appBoot !== undefined) {
      return Promise.resolve({ module: this.appBoot, anchor: this.anchorOf() ?? '' })
    }
    this.appBootPending ??= (async () => {
      try {
        const require = createRequire(import.meta.url)
        const entry = require.resolve('@deepseek-ai/dsh-app-boot')
        const module = await import(pathToFileURL(entry).href) as HostAppBoot
        this.appBoot = module
        return { module, anchor: this.anchorOf() ?? '' }
      } catch {
        return undefined
      }
    })()
    return this.appBootPending
  }

  /** Walk up from the resolved app-boot entry to its package.json. */
  private anchorOf(): string | undefined {
    try {
      const require = createRequire(import.meta.url)
      const entry = require.resolve('@deepseek-ai/dsh-app-boot')
      let dir = dirname(entry)
      for (let depth = 0; depth < 10; depth += 1) {
        if (existsSync(join(dir, 'package.json'))) return join(dir, 'package.json')
        dir = dirname(dir)
      }
    } catch {
      // Fall through: the caller reports a missing host package instead.
    }
    return undefined
  }

  /** Self-contained layer reader for CLI/tests (host package unavailable). */
  private readLayersFallback(): {
    bundlePatches: PatchObject[]
    profilePatches: PatchObject[]
    homePatches: PatchObject[]
  } {
    const bundlePatches: PatchObject[] = []
    const manifestPath = join(this.profileDir, 'package.json')
    if (!existsSync(manifestPath)) throw new Error(`profileComposer: profile manifest not found: ${manifestPath}`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    for (const packageName of manifest.dsh?.profile?.bundles ?? []) {
      const packageDir = this.resolvePackageDir(packageName)
      if (packageDir === undefined) {
        throw new Error(`profileComposer: cannot resolve profile bundle ${JSON.stringify(packageName)} from ${this.profileDir}`)
      }
      const bundleManifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
        dsh?: { bundle?: { patch?: string } }
      }
      const declared = bundleManifest.dsh?.bundle?.patch
      if (typeof declared !== 'string' || declared === '') {
        throw new Error(`profileComposer: profile bundle ${JSON.stringify(packageName)} declares no dsh.bundle.patch`)
      }
      const patchPath = join(packageDir, declared)
      if (!existsSync(patchPath)) throw new Error(`profileComposer: bundle patch file not found: ${patchPath}`)
      bundlePatches.push(...parsePatchObjects(readFileSync(patchPath, 'utf8'), patchPath))
    }
    const profilePatch = join(this.profileDir, HOME_PATCH_FILENAME)
    const homePatch = join(this.home, HOME_PATCH_FILENAME)
    return {
      bundlePatches,
      profilePatches: existsSync(profilePatch) ? parsePatchObjects(readFileSync(profilePatch, 'utf8'), profilePatch) : [],
      homePatches: existsSync(homePatch) ? parsePatchObjects(readFileSync(homePatch, 'utf8'), homePatch) : [],
    }
  }

  private resolvePackageDir(packageName: string): string | undefined {
    const anchors = [join(this.profileDir, 'package.json'), import.meta.url]
    for (const anchor of anchors) {
      const paths = createRequire(anchor).resolve.paths(packageName) ?? []
      for (const searchPath of paths) {
        const candidate = join(searchPath, packageName)
        if (existsSync(join(candidate, 'package.json'))) return candidate
      }
    }
    return undefined
  }

  private resolveProfileDir(): string {
    const baseUrl = this.ctx.baseUrl
    if (baseUrl !== undefined) {
      try {
        return resolve(fileURLToPath(new URL('.', baseUrl)))
      } catch {
        // Fall through to cwd.
      }
    }
    return process.cwd()
  }
}

/** Optional host service consumed by CordisRuntime; provided by this plugin. */
export interface ProfileComposer {
  recompose(): Promise<void>
}
