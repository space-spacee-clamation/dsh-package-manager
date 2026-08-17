import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { isSystemPlugin, LocalPluginRegistry } from '../src/localPlugins.ts'

describe('LocalPluginRegistry', () => {
  it('discovers local plugins through the pre-activation internal/plugin event', async () => {
    const ctx = new Context()
    const registry = new LocalPluginRegistry(ctx)
    const fiber = ctx.plugin({ name: 'local-fixture', apply() {} })
    await fiber
    expect(registry.list().map(item => item.name)).toContain('local-fixture')
    await ctx.fiber.dispose()
  })

  it('walks existing fibers when constructed after plugins already mounted', async () => {
    const ctx = new Context()
    const existing = ctx.plugin({ name: 'pre-existing-local', apply() {} })
    await existing
    const registry = new LocalPluginRegistry(ctx)
    expect(registry.list().map(item => item.name)).toContain('pre-existing-local')
    await ctx.fiber.dispose()
  })

  it('ignores system-injected plugins such as Loader and DSH core rows', async () => {
    expect(isSystemPlugin('@deepseek-ai/cordis-plugin-loader')).toBe(true)
    expect(isSystemPlugin('@deepseek-ai/dsh-tools')).toBe(true)
    expect(isSystemPlugin('cordis:include')).toBe(true)
    expect(isSystemPlugin('@dsh-external/local-plugin')).toBe(false)
  })
})
