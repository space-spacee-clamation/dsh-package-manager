/**
 * Shared asynchronous process execution. Package-manager operations are I/O
 * bound and run inside a long-lived DSH process; `spawnSync` would block the
 * event loop (and therefore the Web UI and every other Cordis fiber) for the
 * whole pnpm/git run, so all host adapters use this async helper instead.
 * @module @dsh-ext/dsh-package-manager/process
 */

import { spawn } from 'node:child_process'
import type { SpawnResult } from './types.ts'

export interface RunProcessOptions {
  /** Millisecond deadline; SIGTERM, then SIGKILL after a short grace period. */
  timeoutMs?: number
  /** Force the platform shell (`true` on Windows, or for command strings). */
  shell?: boolean
  /** Collected output cap per stream; extra bytes are discarded. */
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024
const KILL_GRACE_MS = 1_000

/**
 * Quote one argument for a Windows `cmd.exe` command line. Bare tokens pass
 * through unchanged; anything with spaces or shell metacharacters is
 * double-quoted. Joining args into the command string avoids Node's DEP0190
 * (args array + shell: true).
 */
export function quoteShellArg(arg: string): string {
  if (/^[^\s"&|<>^%!()]+$/.test(arg)) return arg
  return `"${arg.replaceAll('"', '\\"')}"`
}

/**
 * Run one process asynchronously and collect bounded stdout/stderr.
 * @throws when the command cannot be started or exceeds its deadline.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
  options: RunProcessOptions = {},
): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    const shell = options.shell ?? process.platform === 'win32'
    const argv = [...args]
    const commandText = shell && argv.length > 0
      ? [command, ...argv].map(quoteShellArg).join(' ')
      : command
    const child = spawn(commandText, shell ? [] : argv, {
      cwd,
      env: { ...process.env, ...env },
      shell,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < maxBytes) stdout += chunk.slice(0, maxBytes - stdout.length)
    })
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < maxBytes) stderr += chunk.slice(0, maxBytes - stderr.length)
    })

    const timer = options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true
          child.kill('SIGTERM')
          setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref()
        }, options.timeoutMs)
    timer?.unref()

    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      callback()
    }

    child.on('error', (error: NodeJS.ErrnoException) => {
      settle(() => {
        if (error.code === 'ENOENT') reject(new Error(`${command} not found on PATH`))
        else reject(new Error(`${command} failed to start: ${String(error.message ?? error)}`))
      })
    })

    child.on('close', (code, signal) => {
      settle(() => {
        if (timedOut) {
          reject(new Error(`${command} timed out after ${options.timeoutMs ?? 'the configured deadline'}ms`))
          return
        }
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr: signal !== null && stderr === '' ? `terminated by ${signal}` : stderr,
        })
      })
    })
  })
}
