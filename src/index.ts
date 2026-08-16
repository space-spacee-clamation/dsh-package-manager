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
import { createHost } from './host.ts'
import { PackageManager } from './manager.ts'
import { CordisRuntime } from './runtime.ts'
import type { AiInstallRequest, AiInstallResult } from './types.ts'

export { PackageManager, createPackageManager, idFromSource, type PackageManagerOptions } from './manager.ts'
export { LocalHost, HarnessHost, createHost, type PackageManagerHost } from './host.ts'
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

  constructor(ctx: Context, config: Config) {
    super(ctx, 'packageManager')
    this.apiPrefix = config.apiPrefix
    this.manager = new PackageManager({
      ...(config.home === '' ? {} : { home: config.home }),
      host: createHost(ctx),
      runtime: new CordisRuntime(ctx),
    })
    const managerConfig = this.manager.getConfig()
    if (managerConfig.autoSync && managerConfig.storagePath !== '') {
      // Defer one microtask so the service (and its Cordis runtime) is fully
      // constructed before syncConfigured starts hot-mounting plugins.
      void Promise.resolve().then(() => this.manager.syncConfigured()).catch((error: unknown) => {
        ctx.logger('package-manager').warn('package-manager auto-sync failed: %s', messageOf(error))
      })
    }
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
