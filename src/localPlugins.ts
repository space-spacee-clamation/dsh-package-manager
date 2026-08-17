/**
 * Live local-plugin discovery and release/restore.
 *
 * Discovery listens on Cordis `internal/plugin` (fires BEFORE activation) and
 * walks `ctx.registry.values()`. Loader-managed local rows are released by
 * `entry.update({ disabled: true })`; direct `ctx.plugin()` fibers are
 * disposed and their parent/callback/config are cached so they can be
 * restored.
 */

import { type Context, type Fiber } from '@deepseek-ai/cordis'
import type { LocalPluginInfo } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'internal/plugin'(fiber: Fiber): void
  }
}

interface LoaderEntryLike {
  options?: { name?: unknown }
  fiber?: Fiber
  disabled?: boolean
  update(options: { disabled: boolean }): Promise<void>
}

interface LocalFiberRecord {
  name: string
  parent: Context
  callback: Function
  config: unknown
  fiber: Fiber | undefined
}

const SYSTEM_PREFIXES = ['@deepseek-ai/', 'cordis:', '@dsh-ext/dsh-package-manager']
const SYSTEM_SHORT_NAMES = new Set(['Loader', 'Include', 'Group', 'Hmr', 'Timer', 'TimerService', 'isolate'])

export function isSystemPlugin(name: string): boolean {
  if (name === '' || name === 'root') return true
  if (SYSTEM_SHORT_NAMES.has(name)) return true
  return SYSTEM_PREFIXES.some(prefix => name.startsWith(prefix))
}

export class LocalPluginRegistry {
  private readonly cache = new Map<string, LocalPluginInfo>()
  private readonly records = new Map<string, LocalFiberRecord[]>()

  constructor(private readonly ctx: Context) {
    this.refresh()
    ctx.on('internal/plugin', fiber => {
      if (isSystemPlugin(fiber.name)) return
      this.observeFiber(fiber, fiber.name)
    })
  }

  list(): LocalPluginInfo[] {
    this.refresh()
    return [...this.cache.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Re-walk loader entries and registry runtimes; cache rows missing since last refresh. */
  refresh(): LocalPluginInfo[] {
    const seen = new Set<string>()
    for (const [name, entry] of this.loaderEntries()) {
      if (isSystemPlugin(name)) continue
      seen.add(name)
      const released = entry.disabled === true
      const fiber = entry.fiber
      if (fiber !== undefined) this.observeFiber(fiber, name)
      else this.cacheRow(name, null, false, released, true)
    }
    for (const runtime of this.ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        const name = this.loaderNameOf(fiber) ?? fiber.name
        if (isSystemPlugin(name) || seen.has(name)) continue
        seen.add(name)
        this.observeFiber(fiber, name)
      }
    }
    for (const [name, cached] of this.cache) {
      if (seen.has(name)) continue
      this.cache.set(name, { ...cached, active: false, uid: null, cached: true })
    }
    return [...this.cache.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Release one local plugin: disable its loader row or dispose its fiber. */
  async release(name: string): Promise<LocalPluginInfo> {
    const entry = this.loaderEntries().get(name)
    if (entry !== undefined) {
      await entry.update({ disabled: true })
      this.cacheRow(name, null, false, true, false)
      return this.cache.get(name)!
    }
    let released = false
    for (const record of this.records.get(name) ?? []) {
      if (record.fiber?.uid == null) continue
      await record.fiber.dispose()
      record.fiber = undefined
      released = true
    }
    this.cacheRow(name, null, false, released, !released)
    return this.cache.get(name)!
  }

  /** Restore a previously released local plugin. */
  async restore(name: string): Promise<LocalPluginInfo> {
    const entry = this.loaderEntries().get(name)
    if (entry !== undefined) {
      await entry.update({ disabled: false })
      this.cacheRow(name, entry.fiber ?? null, entry.fiber?.state === 2, false, entry.fiber === undefined)
      return this.cache.get(name)!
    }
    const restored: LocalFiberRecord[] = []
    for (const record of this.records.get(name) ?? []) {
      if (record.fiber?.uid != null) continue
      try {
        Object.defineProperty(record.callback, 'name', { value: name })
      } catch {
        // Keep the original callback when its name is non-configurable.
      }
      const fiber = record.parent.plugin(record.callback, record.config)
      await fiber
      restored.push({ ...record, fiber })
    }
    if (restored.length > 0) this.records.set(name, restored)
    const info = restored.length > 0
      ? this.infoOf(name, restored[0]!.fiber!, false, false)
      : { name, uid: null, state: 0, active: false, cached: true, released: false }
    this.cache.set(name, info)
    return info
  }

  private observeFiber(fiber: Fiber, name: string): void {
    let bucket = this.records.get(name) ?? []
    let record = bucket.find(item => item.fiber === fiber || item.fiber?.uid === fiber.uid)
    if (record === undefined) {
      record = {
        name,
        parent: fiber.parent,
        callback: fiber.runtime?.callback ?? (() => {}),
        config: (fiber as unknown as { _config?: unknown })._config,
        fiber,
      }
      bucket.push(record)
      this.records.set(name, bucket)
    } else {
      record.fiber = fiber
    }
    this.cacheRow(name, fiber, fiber.state === 2, false, false)
  }

  private cacheRow(
    name: string,
    fiber: Fiber | null,
    active: boolean,
    released: boolean,
    cached: boolean,
  ): void {
    const previous = this.cache.get(name)
    this.cache.set(name, {
      name,
      uid: fiber?.uid ?? null,
      state: fiber?.state ?? previous?.state ?? 0,
      active,
      cached,
      released,
    })
  }

  private infoOf(name: string, fiber: Fiber, released: boolean, cached: boolean): LocalPluginInfo {
    return { name, uid: fiber.uid, state: fiber.state, active: fiber.state === 2, cached, released }
  }

  private loaderEntries(): Map<string, LoaderEntryLike> {
    const map = new Map<string, LoaderEntryLike>()
    const loader = this.ctx.get('loader') as {
      entries(): Iterable<LoaderEntryLike>
    } | undefined
    if (loader === undefined) return map
    for (const entry of loader.entries()) {
      const name = entry.options?.name
      if (typeof name === 'string') map.set(name, entry)
    }
    return map
  }

  private loaderNameOf(fiber: Fiber): string | undefined {
    for (const [name, entry] of this.loaderEntries()) {
      if (entry.fiber === fiber) return name
    }
    return undefined
  }
}
