/**
 * @dsh-ext/dsh-package-manager — root plugin half. Mounts the
 * `packageManager` service (active in every profile, so headless and CLI use
 * still work) and declares the Config schema the Loader validates. The web
 * half (`./web`) waits on this service plus webServer and owns the /pm-api
 * route; the browser half (src/client) contributes the settings Plugins tab.
 * @module @dsh-ext/dsh-package-manager
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dispatchAiInstall } from './ai.ts'
import { createHost } from './hostAsync.ts'
import { PackageManager } from './manager.ts'
import { CordisRuntime } from './cordisRuntime.ts'
import { listEntries, loadLedger } from './ledger.ts'
import { resolveHome } from './paths.ts'
import { WorkspaceTreeRuntime } from './workspaceTree.ts'
import type {
  AdapterInitRequest, AdapterInitResult, AiInstallRequest, AiInstallResult, DisabledEntry, InstallRequest, InstallResult,
  ManagerState, PackageManagerConfig, RestoreRequest, RestoreResult, SyncRequest, ToggleRequest, UninstallRequest, UninstallResult,
} from './types.ts'

export { PackageManager, createPackageManager, idFromSource, type PackageManagerOptions } from './manager.ts'
export { LocalHost, HarnessHost, createHost, type PackageManagerHost } from './hostAsync.ts'
export { CordisRuntime } from './cordisRuntime.ts'
export type * from './types.ts'

export const name = 'package-manager'

/** Deployment configuration validated by the Loader. */
export interface Config {
  /** Explicit harness home; empty means $DSH_HOME / ~/.dsh. */
  home: string
  /** HTTP prefix of the Web API; the browser half calls the same prefix. */
  apiPrefix: string
  /**
   * Hot-plug runtime. 'workspace-tree' mounts bundle rows through per-workspace
   * Include subtrees; 'legacy' keeps the profile-composer runtime; 'auto'
   * (default) picks workspace-tree when the ledger already has workspace-channel
   * entries, otherwise legacy.
   */
  runtime?: string
}

export const Config: z<Config> = z.object({
  home: z.string().default(''),
  apiPrefix: z.string().default('/pm-api'),
  runtime: z.string().default('auto'),
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

  constructor(ctx: Context, config: Config) {
    super(ctx, 'packageManager')
    this.apiPrefix = config.apiPrefix
    const home = config.home === '' ? resolveHome() : config.home
    const runtime = createRuntime(ctx, config.runtime, home)
    this.manager = new PackageManager({
      ...(config.home === '' ? {} : { home: config.home }),
      host: createHost(ctx),
      runtime,
    })
    if (runtime instanceof WorkspaceTreeRuntime && runtime.available) {
      // Boot reconcile: rebuild every workspace Include subtree from the ledger
      // so a restart needs no profile-manifest state. Runs before auto-sync so
      // the first restore mounts over an already-composed tree.
      void Promise.resolve().then(() => runtime.reconcile(listEntries(loadLedger(home)))).catch((error: unknown) => {
        ctx.logger('package-manager').warn('package-manager workspace reconcile failed: %s', messageOf(error))
      })
    }
    const managerConfig = this.manager.getConfig()
    if (managerConfig.autoSync && managerConfig.storagePath !== '') {
      // Defer one microtask so the service (and its Cordis runtime) is fully
      // constructed before syncConfigured starts hot-mounting plugins.
      void Promise.resolve().then(() => this.manager.syncConfigured()).catch((error: unknown) => {
        ctx.logger('package-manager').warn('package-manager auto-sync failed: %s', messageOf(error))
      })
    }
  }

  // The Cordis service IS the public core API. The plain PackageManager below
  // remains a headless implementation detail for CLI/tests, never the surface
  // other Cordis plugins consume.

  state(): ManagerState {
    return this.manager.state()
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

  /** Switch the active workspace root and reconcile against its requirements file. */
  switchWorkspace(path: string, dryRun = false): Promise<RestoreResult> {
    return this.manager.switchWorkspace(path, dryRun)
  }

  /** Create an AI session in one plugin workspace and dispatch installation. */
  dispatchAiInstall(request: AiInstallRequest): Promise<AiInstallResult> {
    return dispatchAiInstall(this.ctx, this.manager, request)
  }
}

/**
 * Mount the service.
 * @param ctx - registrant context.
 * @param config - validated deployment configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(PackageManagerService, config)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Pick the hot-plug runtime for the service. 'legacy' always uses the
 * profile-composer runtime; 'workspace-tree' always uses the workspace
 * subtrees; 'auto' upgrades to workspace-tree once the ledger carries any
 * workspace-channel entry, so a machine that already adopted the workspace
 * channel keeps it across restarts without extra configuration.
 */
function createRuntime(ctx: Context, mode: string | undefined, home: string): CordisRuntime | WorkspaceTreeRuntime {
  if (mode === 'legacy') return new CordisRuntime(ctx)
  if (mode === 'workspace-tree') return new WorkspaceTreeRuntime(ctx)
  // A corrupt or unreadable ledger must never prevent the service from
  // constructing: the package-manager plugin runs inside the web profile, and
  // a throwing constructor would fail the whole profile boot (host boots are
  // fail-loud). Treat the ledger as empty and let dpm doctor repair it.
  let hasWorkspaceChannel = false
  try {
    hasWorkspaceChannel = listEntries(loadLedger(home)).some(entry => (entry.channel ?? 'profile') === 'workspace')
  } catch {
    hasWorkspaceChannel = false
  }
  return hasWorkspaceChannel ? new WorkspaceTreeRuntime(ctx) : new CordisRuntime(ctx)
}
