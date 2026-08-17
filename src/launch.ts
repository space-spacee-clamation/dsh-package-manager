/**
 * Backend relaunch plumbing: record how this DSH process was started, and
 * spawn a detached restarter that waits for the current backend to release
 * its port, then relaunches it with the recorded command. This is how the
 * package manager restarts the backend without the user killing anything:
 * the current process exits gracefully after the restarter is up.
 * @module @dsh-ext/dsh-package-manager/launch
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { runtimeRoot } from './paths.ts'

const LAUNCH_FILENAME = 'launch.json'

/** How the current backend was started, enough to relaunch it. */
export interface LaunchRecord {
  /** argv of the backend process (argv[0] = node executable). */
  argv: string[]
  /** Working directory the backend was started in. */
  cwd: string
  /** Port the web server listens on (the restarter waits for it to free). */
  port: number
  /** The relaunch command as a shell string. */
  command: string
}

export function launchPath(home: string): string {
  return join(runtimeRoot(home), LAUNCH_FILENAME)
}

export function portOf(env: Record<string, string | undefined> = process.env): number {
  const value = Number.parseInt(env.DSH_PM_PORT ?? '3080', 10)
  return Number.isFinite(value) && value > 0 ? value : 3080
}

/** Quote one token for the relaunch shell command line. */
function quote(value: string): string {
  return /^[A-Za-z0-9_\-./:\\]+$/.test(value) ? value : JSON.stringify(value)
}

/**
 * Record the current process launch so `restart` can relaunch it verbatim.
 * The relaunch command is rebuilt from the node executable, the process exec
 * flags (`--import tsx/esm` and friends — `process.argv` omits them, and the
 * harness source launch dies without the tsx loader), and the captured
 * script arguments.
 */
export function recordLaunch(home: string, port: number, argv: readonly string[] = process.argv.slice(1), cwd = process.cwd()): LaunchRecord {
  const args = [...argv]
  const command = [process.execPath, ...process.execArgv, ...args].map(quote).join(' ')
  const record: LaunchRecord = { argv: args, cwd, port, command }
  const path = launchPath(home)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(record, undefined, 2) + '\n')
  return record
}

/** Read the recorded launch; undefined when absent or unreadable. */
export function readLaunch(home: string): LaunchRecord | undefined {
  const path = launchPath(home)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (parsed === null || typeof parsed !== 'object') return undefined
    const raw = parsed as Record<string, unknown>
    if (typeof raw.command !== 'string' || raw.command === '') return undefined
    return {
      argv: Array.isArray(raw.argv) ? raw.argv.filter((item): item is string => typeof item === 'string') : [],
      cwd: typeof raw.cwd === 'string' ? raw.cwd : '',
      port: typeof raw.port === 'number' && raw.port > 0 ? raw.port : 3080,
      command: raw.command,
    }
  } catch {
    return undefined
  }
}

/**
 * Build a detached restarter script: probe the port until the current
 * backend has released it, then relaunch `command` with output appended to
 * `logPath`. Runs under a fresh `node -e`, so it survives this process.
 * @returns the script text (pass to `node -e`).
 */
export function buildRestartScript(port: number, command: string, logPath: string): string {
  const js = [
    "const net = require('node:net'), cp = require('node:child_process'), fs = require('node:fs')",
    `const port = ${port}, host = '127.0.0.1'`,
    `const cmd = ${JSON.stringify(command)}`,
    `const log = ${JSON.stringify(logPath)}`,
    "const out = fs.openSync(log, 'a')",
    "fs.writeSync(out, '\\n=== restart at ' + new Date().toISOString() + ' ===\\n')",
    'function probe() {',
    '  const s = net.connect(port, host)',
    "  s.once('connect', () => { s.destroy(); setTimeout(probe, 500) })",
    "  s.once('error', () => {",
    "    fs.writeSync(out, 'port ' + port + ' free, launching: ' + cmd + '\\n')",
    "    const child = cp.spawn(cmd, { detached: true, stdio: ['ignore', out, out], shell: true, cwd: process.cwd() })",
    '    child.unref()',
    "    setTimeout(() => process.exit(0), 1500)",
    '  })',
    '}',
    'probe()',
  ].join('\n')
  return js
}

/**
 * Spawn the restarter as a detached process. The current backend then exits
 * gracefully; the restarter relaunches it once the port frees up.
 * @returns the restarter pid.
 */
export function spawnRestarter(script: string): number {
  const child = spawn(process.execPath, ['-e', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  return child.pid ?? -1
}

/** Remove the recorded launch (used by tests and after fatal relaunch failures). */
export function clearLaunch(home: string): void {
  try {
    unlinkSync(launchPath(home))
  } catch {
    // Absent launch file is fine.
  }
}
