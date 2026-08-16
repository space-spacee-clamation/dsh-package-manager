import { describe, expect, it } from 'vitest'
import { HarnessHost, LocalHost } from '../src/host.ts'

describe('process host adapters', () => {
  it('local host exposes the three declared capabilities', async () => {
    const host = new LocalHost()
    expect(host.name).toBe('local')
    await expect(host.git(['--version'], process.cwd())).resolves.toMatchObject({ exitCode: 0 })
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

  it('harness host falls back to local when no subprocess service is mounted', async () => {
    const ctx = { get: () => undefined }
    const host = new HarnessHost(ctx as never)
    expect(host.name).toBe('local (subprocess unavailable)')
    await expect(host.git(['--version'], process.cwd())).resolves.toMatchObject({ exitCode: 0 })
  })
})
