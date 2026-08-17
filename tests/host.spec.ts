import { describe, expect, it, vi } from 'vitest'
import { HarnessHost, LocalHost } from '../src/hostAsync.ts'

describe('process host adapters', () => {
  it('local host exposes the declared capabilities', async () => {
    const host = new LocalHost()
    expect(host.name).toBe('local')
    await expect(host.git(['--version'], process.cwd())).resolves.toMatchObject({ exitCode: 0 })
    await expect(host.pnpm(['--version'], process.cwd(), {})).resolves.toMatchObject({ exitCode: 0 })
  })

  it('harness host routes argv through ctx.subprocess and maps collected output', async () => {
    const subprocess = {
      resolveExecutable: async (command: string) => `resolved:${command}`,
      spawn: (spec: { argv: string[]; cwd: string; env: Record<string, string> }) => ({
        done: Promise.resolve({ exitCode: 7, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: 'out', nextOffset: 3, lossy: false }) },
          stderr: { readFrom: () => ({ text: 'err', nextOffset: 3, lossy: false }) },
        },
      }),
    }
    const ctx = { get: (name: string) => name === 'subprocess' ? subprocess : undefined }
    const host = new HarnessHost(ctx as never, subprocess as never)
    const result = await host.pnpm(['--version'], 'D:/work', { PM_HOME: 'x' })
    expect(result).toEqual({ exitCode: 7, stdout: 'out', stderr: 'err' })
    expect(host.name).toBe('harness subprocess')
  })

  it('harness host routes dsh plugin through ctx.subprocess', async () => {
    const spawn = vi.fn((_spec: { argv: string[] }) => ({
      done: Promise.resolve({ exitCode: 0, signal: null }),
      collected: {
        stdout: { readFrom: () => ({ text: 'ok', nextOffset: 2, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      },
    }))
    const subprocess = {
      resolveExecutable: async (command: string) => `resolved:${command}`,
      spawn,
    }
    const ctx = { get: (name: string) => name === 'subprocess' ? subprocess : undefined }
    const host = new HarnessHost(ctx as never, subprocess as never)
    await expect(host.dsh(['plugin', '--profile', 'web', 'add', 'x'], 'D:/work', { DSH_HOME: 'h' })).resolves.toMatchObject({ exitCode: 0 })
    expect(spawn).toHaveBeenCalledTimes(1)
    const spec = spawn.mock.calls[0]?.[0] as { argv: string[] }
    expect(spec?.argv).toEqual(['resolved:dsh', 'plugin', '--profile', 'web', 'add', 'x'])
  })

  it('terminates a hung subprocess at the configured deadline', async () => {
    const terminate = vi.fn()
    const subprocess = {
      resolveExecutable: async (command: string) => `resolved:${command}`,
      spawn: () => ({
        done: new Promise(() => {}),
        collected: {},
        terminate,
      }),
    }
    const ctx = { get: (name: string) => name === 'subprocess' ? subprocess : undefined }
    const host = new HarnessHost(ctx as never, subprocess as never, { git: 25 })
    await expect(host.git(['ls-remote', 'origin'], 'D:/work')).rejects.toThrow('git ls-remote origin timed out after 25ms')
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it('harness host falls back to local when no subprocess service is mounted', async () => {
    const ctx = { get: () => undefined }
    const host = new HarnessHost(ctx as never)
    expect(host.name).toBe('local (subprocess unavailable)')
    await expect(host.git(['--version'], process.cwd())).resolves.toMatchObject({ exitCode: 0 })
  })
})
