/**
 * Process-host adapter seam.
 *
 * The paper's coeffect idea says a component should not reach for concrete
 * global toolchains (`git`, `pnpm`, a shell) directly — it should declare the
 * capability and let the surrounding context provide an implementation. This
 * file turns that into an explicit `PackageManagerHost` adapter:
 *
 * - `LocalHost` runs commands through the current operating system PATH;
 * - `HarnessHost` runs commands through `ctx.subprocess`, so the package
 *   manager inherits the harness execution world (executable resolution,
 *   scrubbed environment, managed process trees, bounded output) when one is
 *   mounted, and falls back to local execution when it is not.
 *
 * The core only sees the three declared capabilities: `pnpm`, `git`, and
 * `shell`. Future environments (containers, remote hosts, sandboxed runners)
 * implement the same interface without touching install/restore logic.
 * @module @dsh-ext/dsh-package-manager/host
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SpawnResult } from './types.ts'
import { spawnSync } from 'node:child_process'

export interface PackageManagerHost {
  readonly name: string
  pnpm(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult>
  git(args: string[], cwd: string): Promise<SpawnResult>
  shell(command: string, cwd: string, env: Record<string, string>): Promise<SpawnResult>
}

const COLLECT_BYTES = 4 * 1024 * 1024
const GRACE_MS = 60_000

/** Current-machine adapter. This is the CLI/tests default and the fallback. */
export class LocalHost implements PackageManagerHost {
  readonly name = 'local'

  async pnpm(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult> {
    return localSpawn('pnpm', args, cwd, env)
  }

  async git(args: string[], cwd: string): Promise<SpawnResult> {
    return localSpawn('git', args, cwd, {})
  }

  async shell(command: string, cwd: string, env: Record<string, string>): Promise<SpawnResult> {
    const result = spawnSync(command, {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      shell: process.platform === 'win32' ? true : command.includes(' '),
      windowsHide: true,
    })
    return normalizeLocalResult('shell', result)
  }
}

/**
 * Harness execution-world adapter. Resolves executables and spawns through
 * `ctx.subprocess`, falling back to the local host whenever that service is
 * not mounted or a command cannot be resolved in the harness world.
 */
export class HarnessHost implements PackageManagerHost {
  readonly name: string
  private readonly fallback = new LocalHost()

  constructor(private readonly ctx: Context, private readonly subprocess?: SubprocessRuntime) {
    this.name = subprocess === undefined ? 'local (subprocess unavailable)' : 'harness subprocess'
  }

  async pnpm(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult> {
    return this.run(['pnpm', ...args], cwd, env, 'pnpm')
  }

  async git(args: string[], cwd: string): Promise<SpawnResult> {
    return this.run(['git', ...args], cwd, {}, 'git')
  }

  async shell(command: string, cwd: string, env: Record<string, string>): Promise<SpawnResult> {
    const shell = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : '/bin/sh'
    const argv = process.platform === 'win32' ? [shell, '/d', '/s', '/c', command] : [shell, '-c', command]
    return this.run(argv, cwd, env, 'shell')
  }

  private async run(
    argv: string[],
    cwd: string,
    env: Record<string, string>,
    capability: 'pnpm' | 'git' | 'shell',
  ): Promise<SpawnResult> {
    if (this.subprocess === undefined) return this.runFallback(capability, argv, cwd, env)
    try {
      const executable = await this.subprocess.resolveExecutable(argv[0] ?? '', env)
      const handle = this.subprocess.spawn({
        argv: [executable, ...argv.slice(1)],
        cwd,
        env,
        graceMs: GRACE_MS,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: COLLECT_BYTES },
          stderr: { maxBytes: COLLECT_BYTES },
        },
      })
      const outcome = await handle.done
      return {
        exitCode: outcome.exitCode ?? 1,
        stdout: handle.collected.stdout?.readFrom(0).text ?? '',
        stderr: handle.collected.stderr?.readFrom(0).text ?? '',
      }
    } catch {
      return this.runFallback(capability, argv, cwd, env)
    }
  }

  private runFallback(
    capability: 'pnpm' | 'git' | 'shell',
    argv: string[],
    cwd: string,
    env: Record<string, string>,
  ): Promise<SpawnResult> {
    if (capability === 'pnpm') return this.fallback.pnpm(argv.slice(1), cwd, env)
    if (capability === 'git') return this.fallback.git(argv.slice(1), cwd)
    return this.fallback.shell(commandOf(argv), cwd, env)
  }
}

export function createHost(ctx?: Context): PackageManagerHost {
  if (ctx === undefined) return new LocalHost()
  const subprocess = ctx.get('subprocess') as SubprocessRuntime | undefined
  return new HarnessHost(ctx, subprocess)
}

function localSpawn(command: string, args: string[], cwd: string, env: Record<string, string>): SpawnResult {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  })
  return normalizeLocalResult(command, result)
}

function normalizeLocalResult(command: string, result: ReturnType<typeof spawnSync>): SpawnResult {
  const status = result.status ?? 1
  const error = result.error
  if (error !== undefined) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error(`${command} not found on PATH`)
    throw new Error(`${command} failed to start: ${String(error.message ?? error)}`)
  }
  return { exitCode: status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
}

function commandOf(argv: string[]): string {
  // Recover the shell command text from the argv shape used for shell calls.
  if (process.platform === 'win32') return argv.slice(3).join(' ')
  return argv[2] ?? ''
}
