/**
 * Path resolution for the package manager. Everything lives under the single
 * harness home (`$DSH_HOME` or `~/.dsh`), mirroring the harness's own layout:
 * profiles stay where `dsh plugin` manages them, while package-manager-owned
 * state lives under `<home>/package-manager`.
 * @module @dsh-ext/dsh-package-manager/paths
 */

import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export const PROFILES_DIR = 'profiles'
export const PM_DIR = 'package-manager'
export const CACHE_DIR = 'cache'
export const LEDGER_FILENAME = 'ledger.json'

/** Resolve the harness home, matching dsh-home-paths precedence. */
export function resolveHome(env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.DSH_HOME
  return resolve(fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), '.dsh'))
}

/** Package-manager state root under the harness home. */
export function pmRoot(home: string): string {
  return join(home, PM_DIR)
}

/** Ledger file path. */
export function ledgerPath(home: string): string {
  return join(pmRoot(home), LEDGER_FILENAME)
}

/** Download/scratch cache root. */
export function cacheRoot(home: string): string {
  return join(pmRoot(home), CACHE_DIR)
}

/** Profile directory under the harness home. */
export function profileDir(home: string, name: string): string {
  assertProfileName(name)
  return join(home, PROFILES_DIR, name)
}

/** Validate a profile name the same way the harness does. */
export function assertProfileName(name: string): void {
  if (name === '' || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name === 'node_modules') {
    throw new Error(`invalid profile name ${JSON.stringify(name)}`)
  }
}

/** True for an absolute filesystem path (Windows or POSIX). */
export function isAbsolutePath(value: string): boolean {
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^[A-Za-z]:$/.test(value)
}
