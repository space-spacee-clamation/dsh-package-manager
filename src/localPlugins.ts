/**
 * Live local-plugin discovery.
 *
 * Cordis emits `internal/plugin` when a fiber is created — BEFORE the plugin
 * body refreshes/activates — so one listener observes every future local
 * registration. Existing fibers are discovered by walking
 * `ctx.registry.values()`. `refresh()` re-walks the registry and keeps a
 * cache of previously observed switches so rows the user has seen do not
 * disappear on the next refresh.
 */

import { type Context, type Fiber } from '@deepseek-ai/cordis'
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
  private readonly live = new Map<string, Fiber>()
  private readonly cache = new Map<string, LocalPluginInfo>()

  constructor(private readonly ctx: Context) {
    this.refresh()
    ctx.on('internal/plugin', fiber => {
      if (!isSystemPlugin(fiber.name)) {
        this.live.set(fiber.name, fiber)
        this.cache.set(fiber.name, this.infoOf(fiber.name, fiber, false))
      }
    })
  }

  list(): LocalPluginInfo[] {
    this.refresh()
    return [...this.cache.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Re-walk every registry runtime and keep cached rows for absent fibers. */
  refresh(): LocalPluginInfo[] {
    const seen = new Set<string>()
    for (const runtime of this.ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        const name = fiber.name
        if (isSystemPlugin(name)) continue
        seen.add(name)
        this.live.set(name, fiber)
        this.cache.set(name, this.infoOf(name, fiber, false))
      }
    }
    for (const [name, cached] of this.cache) {
      if (seen.has(name)) continue
      this.cache.set(name, { ...cached, active: false, uid: null, cached: true })
    }
    return [...this.cache.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  private infoOf(name: string, fiber: Fiber, cached: boolean): LocalPluginInfo {
    return {
      name,
      uid: fiber.uid,
      state: fiber.state,
      active: fiber.state === 2, // FiberState.ACTIVE
      cached,
    }
  }
}
