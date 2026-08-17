/**
 * @dsh-ext/dsh-package-manager — root plugin half. Mounts the
 * `packageManager` service (active in every profile, so headless and CLI use
 * still work) and declares the Config schema the Loader validates. The web
 * half (`./web`) waits on this service plus webServer and owns the /pm-api
 * route; the browser half (src/client) contributes the settings Plugins tab.
 *
 * Hot reload is the host's own `watchUserPatches` path. This service never
 * imports the Loader, never creates Include subtrees, and never recomposes
 * the profile include; the manager only edits `cordis.patch.yml` blocks.
 * @module @dsh-ext/dsh-package-manager
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dispatchAiInstall } from './ai.ts'
import { LocalPluginRegistry } from './localPlugins.ts'
import { createHost } from './hostAsync.ts'
import { PackageManager } from './manager.ts'
import { buildRestartScript, portOf, readLaunch, recordLaunch, spawnRestarter } from './launch.ts'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { resolveHome, runtimeRoot } from './paths.ts'
import type {
  AdapterInitRequest, AdapterInitResult, AiInstallRequest, AiInstallResult, DisabledEntry, InstallRequest, InstallResult,
  LocalPluginInfo, ManagerState, PackageManagerConfig, RestartResult, RestoreRequest, RestoreResult, SyncRequest, ToggleRequest, UninstallRequest, UninstallResult,
} from './types.ts'

export { PackageManager, createPackageManager, idFromSource, type PackageManagerOptions } from './manager.ts'
export { LocalHost, HarnessHost, createHost, type PackageManagerHost } from './hostAsync.ts'
export type * from './types.ts'

export const name = 'package-manager'

/** Deployment configuration validated by the Loader. */
export interface Config {
  /** Explicit harness home; empty means $DSH_HOME / ~/.dsh. */
  home: string
  /** HTTP prefix of the Web API; the browser half calls the same prefix. */
  apiPrefix: string
}

export const Config: z<Config> = z.object({
  home: z.string().default(''),
  apiPrefix: z.string().default('/pm-api'),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    packageManager: PackageManagerService
  }
}

/** Cordis service wrapping the package manager core. */
export class PackageManagerService extends Service {
  readonly manager: PackageManager
  readonly apiPrefix: string
  readonly home: string
  private readonly localPluginRegistry: LocalPluginRegistry

  constructor(ctx: Context, config: Config) {
    super(ctx, 'packageManager')
    this.apiPrefix = config.apiPrefix
    const home = config.home === '' ? resolveHome() : config.home
    this.home = home
    this.manager = new PackageManager({
      ...(config.home === '' ? {} : { home: config.home }),
      host: createHost(ctx),
    })
    this.localPluginRegistry = new LocalPluginRegistry(ctx)
    // Record how this process was started so the restart tool can relaunch it
    // verbatim after a graceful exit (no manual process killing needed).
    recordLaunch(home, portOf())
    // Shutdown notices: the user asked for a visible "ending" signal.
    ctx.effect(() => () => {
      console.log('[package-manager] DSH backend shutting down...')
    }, 'package-manager: shutdown notice')
    process.on('exit', () => {
      console.log('[package-manager] DSH backend closed')
    })
    const managerConfig = this.manager.getConfig()
    if (managerConfig.autoSync && managerConfig.storagePath !== '') {
      // Defer one microtask so the service is fully constructed before
      // syncConfigured starts hot-mounting plugins.
      void Promise.resolve().then(() => this.manager.syncConfigured()).catch((error: unknown) => {
        ctx.logger('package-manager').warn('package-manager auto-sync failed: %s', messageOf(error))
      })
    }
  }

  state(): ManagerState {
    return { ...this.manager.state(), localPlugins: this.localPluginRegistry.list() }
  }

  /** Live non-system plugins discovered from Cordis fibers. */
  localPlugins(): LocalPluginInfo[] {
    return this.localPluginRegistry.list()
  }

  /**
   * Schedule a backend restart: spawn a detached restarter that waits for
   * this process to release its port, then relaunches with the recorded (or
   * provided) command. The caller exits this process gracefully after the
   * response is sent — no manual process killing required.
   */
  restart(command?: string): RestartResult {
    const record = readLaunch(this.home)
    const cmd = command !== undefined && command !== '' ? command : record?.command ?? ''
    if (cmd === '') {
      throw new Error('no restart command recorded and none provided — pass a command')
    }
    const port = record?.port ?? 3080
    const log = join(runtimeRoot(this.home), 'restart.log')
    mkdirSync(dirname(log), { recursive: true })
    const pid = spawnRestarter(buildRestartScript(port, cmd, log))
    return { restarting: true, command: cmd, log, pid, port }
  }

  doctor(): Promise<{ profiles: unknown[]; droppedLedger: string[]; reconciled: string[] }> {
    return this.manager.doctor()
  }

  install(request: InstallRequest): Promise<InstallResult> {
    return this.manager.install(request)
  }

  uninstall(request: UninstallRequest): Promise<UninstallResult> {
    return this.manager.uninstall(request)
  }

  restore(request: RestoreRequest): Promise<RestoreResult> {
    return this.manager.restore(request)
  }

  sync(request: SyncRequest): Promise<RestoreResult> {
    return this.manager.sync(request)
  }

  syncConfigured(): Promise<RestoreResult> {
    return this.manager.syncConfigured()
  }

  adapterInit(request: AdapterInitRequest): Promise<AdapterInitResult> {
    return this.manager.adapterInit(request)
  }

  disable(request: ToggleRequest): Promise<UninstallResult> {
    return this.manager.disable(request)
  }

  enable(request: ToggleRequest): Promise<InstallResult> {
    return this.manager.enable(request)
  }

  forgetDisabled(request: ToggleRequest): DisabledEntry | undefined {
    return this.manager.forgetDisabled(request)
  }

  getConfig(): PackageManagerConfig {
    return this.manager.getConfig()
  }

  setConfig(config: PackageManagerConfig): PackageManagerConfig {
    return this.manager.setConfig(config)
  }

  clearRestartMarker(): void {
    this.manager.clearRestartMarker()
  }

  clearWebRefreshMarker(): void {
    this.manager.clearWebRefreshMarker()
  }

  workspaceRoot(): string {
    return this.manager.workspaceRoot()
  }

  workspaceDefault(): string {
    return this.manager.workspaceDefault()
  }

  pluginWorkspaceDir(profile: string, id: string): string {
    return this.manager.pluginWorkspaceDir(profile, id)
  }

  workspaceHistory(): string[] {
    return this.manager.workspaceHistory()
  }

  recordWorkspaceHistory(path: string): string[] {
    return this.manager.recordWorkspaceHistory(path)
  }

  forgetWorkspaceHistory(path: string): string[] {
    return this.manager.forgetWorkspaceHistory(path)
  }

  clearWorkspaceHistory(): string[] {
    return this.manager.clearWorkspaceHistory()
  }

  /** Switch the active requirements root and reconcile against its requirements file. */
  switchWorkspace(path: string, dryRun = false): Promise<RestoreResult> {
    return this.manager.switchWorkspace(path, dryRun)
  }

  /** Create an AI session in one plugin workspace and dispatch installation. */
  dispatchAiInstall(request: AiInstallRequest): Promise<AiInstallResult> {
    return dispatchAiInstall(this.ctx, this.manager, request)
  }
}

/** Mount the service. */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(PackageManagerService, config)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
