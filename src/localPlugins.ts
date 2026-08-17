/**
 * Live local-plugin discovery.
 *
 * Cordis emits `internal/plugin` when a fiber is created — BEFORE the plugin
 * body refreshes/activates — so one listener observes every future local
 * registration. For fibers that already existed before this service mounted,
 * the registry is seeded by walking `ctx.registry.values()`.
 *
 * System-injected rows (Loader/Include/Timer/HMR and the DSH core packages)
 * are intentionally ignored.
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { LocalPluginInfo } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'internal/plugin'(fiber: Fiber): void
  }
}

const SYSTEM_PREFIXES = ['@deepseek-ai/', 'cordis:', '@dsh-ext/dsh-package-manager']

export function isSystemPlugin(name: string): boolean {
  if (name === '' || name === 'root') return true
  return SYSTEM_PREFIXES.some(prefix => name.startsWith(prefix))
}

export class LocalPluginRegistry {
  private readonly plugins = new Map<string, LocalPluginInfo>()

  constructor(private readonly ctx: Context) {
    // Existing fibers: walk every runtime record before attaching the live
    // listener so boot-time local rows are not missed.
    for (const runtime of ctx.registry.values()) {
      for (const fiber of runtime.fibers) this.observe(fiber)
    }
    // Future fibers: this event fires before activation.
    ctx.on('internal/plugin', fiber => this.observe(fiber))
  }

  list(): LocalPluginInfo[] {
    return [...this.plugins.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  private observe(fiber: Fiber): void {
    const name = fiber.name
    if (isSystemPlugin(name)) return
    this.plugins.set(`${name}#${String(fiber.uid)}`, {
      name,
      uid: fiber.uid,
      state: fiber.state,
    })
  }
}
