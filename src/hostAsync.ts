/**
 * Async process-host adapter seam.
 *
 * The old `LocalHost` used `spawnSync`; a package install could block the
 * event loop (and therefore the whole DSH process) for minutes. This host is
 * identical in capability but runs every child asynchronously through
 * `src/process.ts`, with bounded output and deadlines.
 * @module @dsh-ext/dsh-package-manager/hostAsync
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync, writeFileSync } from 'node:fs'
import { runProcess } from './process.ts'
import type { SpawnResult } from './types.ts'

export interface PackageManagerHost {
  readonly name: string
  pnpm(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult>
  git(args: string[], cwd: string): Promise<SpawnResult>
  /** The harness's own profile plugin manager (`dsh plugin`). */
  dsh(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult>
  shell(command: string, cwd: string, env: Record<string, string>): Promise<SpawnResult>
}

function shellDiagnostic(host: string, mode: string): string {
  return `[pm-shell: host=${host} mode=${mode} platform=${process.platform} ComSpec=${process.env.ComSpec ?? '-'} TMP=${tmpdir()}] `
}

const COLLECT_BYTES = 4 * 1024 * 1024
const GRACE_MS = 60_000

export const DEFAULT_PNPM_TIMEOUT_MS = 600_000
export const DEFAULT_GIT_TIMEOUT_MS = 120_000
export const DEFAULT_DSH_TIMEOUT_MS = 300_000
export const DEFAULT_SHELL_TIMEOUT_MS = 300_000

/** Git must fail instead of waiting for credential prompts nobody can answer. */
const GIT_SAFE_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
}

/** Current-machine adapter. This is the CLI/tests default and the fallback. */
export class LocalHost implements PackageManagerHost {
  readonly name = 'local'

  async pnpm(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult> {
    return localSpawn('pnpm', args, cwd, env, DEFAULT_PNPM_TIMEOUT_MS)
  }

  async git(args: string[], cwd: string): Promise<SpawnResult> {
    return localSpawn('git', args, cwd, GIT_SAFE_ENV, DEFAULT_GIT_TIMEOUT_MS)
  }

  async dsh(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult> {
    if (!commandAvailable('dsh')) throw new Error('dsh not found on PATH')
    return localSpawn('dsh', args, cwd, env, DEFAULT_DSH_TIMEOUT_MS)
  }

  async shell(command: string, cwd: string, env: Record<string, string>): Promise<SpawnResult> {
    const result = await runProcess(command, [], cwd, env, {
      timeoutMs: DEFAULT_SHELL_TIMEOUT_MS,
      shell: process.platform === 'win32' || command.includes(' '),
    })
    return result.exitCode === 0 ? result : { ...result, stderr: shellDiagnostic(this.name, 'runProcess shell:' + String(process.platform === 'win32' || command.includes(' '))) + result.stderr }
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

  constructor(
    private readonly ctx: Context,
    private readonly subprocess?: SubprocessRuntime,
    private readonly timeouts: {
      pnpm?: number
      git?: number
      dsh?: number
      shell?: number
    } = {},
  ) {
    this.name = subprocess === undefined ? 'local (subprocess unavailable)' : 'harness subprocess'
  }

  async pnpm(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult> {
    return this.run(['pnpm', ...args], cwd, env, 'pnpm')
  }

  async git(args: string[], cwd: string): Promise<SpawnResult> {
    return this.run(['git', ...args], cwd, GIT_SAFE_ENV, 'git')
  }

  async dsh(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult> {
    return this.run(['dsh', ...args], cwd, env, 'dsh')
  }

  async shell(command: string, cwd: string, env: Record<string, string>): Promise<SpawnResult> {
    if (process.platform === 'win32') {
      // cmd /s /c quote rules mangle a command with embedded quotes once it
      // travels as one argv element (the harness subprocess quotes each
      // argument, and cmd strips the surrounding quotes it then sees). A
      // temp .cmd file bypasses the quoting entirely.
      const bat = join(tmpdir(), `dsh-pm-${process.pid}-${Math.random().toString(36).slice(2)}.cmd`)
      writeFileSync(bat, `@echo off\r\n${command}\r\n`)
      try {
        // The bat path must NOT be quoted: a quoted argv element survives
        // spawn quoting as `"..."`, and cmd then treats the whole quoted
        // string as the program name. A bare space-free path executes cleanly.
        return await this.run([process.env.ComSpec ?? 'cmd.exe', '/d', '/s', '/c', bat], cwd, env, 'shell')
      } finally {
        try {
          unlinkSync(bat)
        } catch {
          // Best-effort cleanup; the temp file is harmless if removal fails.
        }
      }
    }
    const result = await this.run(['/bin/sh', '-c', command], cwd, env, 'shell')
    return result.exitCode === 0 ? result : { ...result, stderr: shellDiagnostic(this.name, 'sh -c') + result.stderr }
  }

  private timeoutMs(capability: 'pnpm' | 'git' | 'dsh' | 'shell'): number {
    if (capability === 'pnpm') return this.timeouts.pnpm ?? DEFAULT_PNPM_TIMEOUT_MS
    if (capability === 'git') return this.timeouts.git ?? DEFAULT_GIT_TIMEOUT_MS
    if (capability === 'dsh') return this.timeouts.dsh ?? DEFAULT_DSH_TIMEOUT_MS
    return this.timeouts.shell ?? DEFAULT_SHELL_TIMEOUT_MS
  }

  private async run(
    argv: string[],
    cwd: string,
    env: Record<string, string>,
    capability: 'pnpm' | 'git' | 'dsh' | 'shell',
  ): Promise<SpawnResult> {
    if (this.subprocess === undefined) return this.runFallback(capability, argv, cwd, env)
    const timeoutMs = this.timeoutMs(capability)
    try {
      const executable = await withDeadline(
        this.subprocess.resolveExecutable(argv[0] ?? '', env),
        timeoutMs,
        `${capability} executable resolution`,
      )
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
      return await withProcessDeadline(handle, timeoutMs, `${capability} ${argv.slice(1).join(' ')}`)
    } catch (error) {
      if (isTimeoutError(error)) throw error
      return this.runFallback(capability, argv, cwd, env)
    }
  }

  private runFallback(
    capability: 'pnpm' | 'git' | 'dsh' | 'shell',
    argv: string[],
    cwd: string,
    env: Record<string, string>,
  ): Promise<SpawnResult> {
    if (capability === 'pnpm') return this.fallback.pnpm(argv.slice(1), cwd, env)
    if (capability === 'git') return this.fallback.git(argv.slice(1), cwd)
    if (capability === 'dsh') return this.fallback.dsh(argv.slice(1), cwd, env)
    return this.fallback.shell(commandOf(argv), cwd, env)
  }
}

export function createHost(ctx?: Context): PackageManagerHost {
  if (ctx === undefined) return new LocalHost()
  const subprocess = ctx.get('subprocess') as SubprocessRuntime | undefined
  return new HarnessHost(ctx, subprocess)
}

function commandAvailable(command: string): boolean {
  if (process.platform === 'win32') {
    const where = spawnSync('where', [command], { encoding: 'utf8', windowsHide: true })
    if (where.status === 0) return where.stdout.toLowerCase().includes(command.toLowerCase())
    const direct = spawnSync(command, ['--version'], { encoding: 'utf8', windowsHide: true })
    return direct.error === undefined || (direct.error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
  const which = spawnSync('command', ['-v', command], { encoding: 'utf8' })
  return which.status === 0 && which.stdout.trim() !== ''
}

function localSpawn(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs = 300_000,
): Promise<SpawnResult> {
  return runProcess(command, args, cwd, env, { timeoutMs })
}

interface ManagedSubprocessHandle {
  readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
  collected: {
    readonly stdout?: { readFrom(offset: number): { text: string } }
    readonly stderr?: { readFrom(offset: number): { text: string } }
  }
  terminate(): void
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

async function withDeadline<T>(task: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function withProcessDeadline(
  handle: ManagedSubprocessHandle,
  timeoutMs: number,
  label: string,
): Promise<SpawnResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        handle.terminate()
        reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    })
    const outcome = await Promise.race([handle.done, timeout])
    return {
      exitCode: outcome.exitCode ?? 1,
      stdout: handle.collected.stdout?.readFrom(0).text ?? '',
      stderr: handle.collected.stderr?.readFrom(0).text ?? '',
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof TimeoutError
}

/**
 * Recover the shell command from a harness-shell argv so the local fallback
 * can run it. The win32 shape is `[ComSpec, '/d', '/s', '/c', batPath]` — the
 * bat path sits at argv[4]; argv[3] is the literal `/c` flag and must NOT be
 * joined into the command (cmd would then treat `/c` as the program name).
 */
function commandOf(argv: string[]): string {
  if (process.platform === 'win32') return argv[4] ?? ''
  return argv[2] ?? ''
}
