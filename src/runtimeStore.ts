/**
 * Package-manager runtime store under `<home>/package-manager/runtime`.
 * It holds the workspace-root history used by the settings UI and is the
 * parent of the centralized package cache. This is local machine state, not
 * package-manager source: it must never be committed to a plugin repository.
 * @module @dsh-ext/dsh-package-manager/runtimeStore
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { workspaceHistoryPath } from './paths.ts'

const HISTORY_VERSION = 1
const MAX_HISTORY_ENTRIES = 20

export interface WorkspaceHistoryFile {
  version: 1
  entries: string[]
}

/**
 * Read recently used workspace roots, newest first. This file is
 * non-critical UI state, so malformed or unreadable files degrade to an
 * empty list instead of breaking the package-manager service.
 */
export function loadWorkspaceHistory(home: string): string[] {
  let raw: string
  try {
    raw = readFileSync(workspaceHistoryPath(home), 'utf8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    const store = parsed as { version?: unknown; entries?: unknown }
    if (store.version !== HISTORY_VERSION || store.entries === undefined || !Array.isArray(store.entries)) return []
    return store.entries.flatMap((entry) => {
      if (typeof entry !== 'string') return []
      const path = entry.trim()
      return path === '' ? [] : [path]
    })
  } catch {
    return []
  }
}

/** Atomically persist the workspace history file. */
export function saveWorkspaceHistory(home: string, entries: string[]): void {
  const path = workspaceHistoryPath(home)
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temp, JSON.stringify({ version: HISTORY_VERSION, entries } satisfies WorkspaceHistoryFile, undefined, 2) + '\n')
  renameSync(temp, path)
}

/** Move `path` to the front of the history list and persist the result. */
export function recordWorkspaceHistory(home: string, path: string): string[] {
  const value = path.trim()
  if (value === '') return loadWorkspaceHistory(home)
  const entries = [value, ...loadWorkspaceHistory(home).filter(item => item !== value)].slice(0, MAX_HISTORY_ENTRIES)
  saveWorkspaceHistory(home, entries)
  return entries
}

/** Remove all workspace paths from history. */
export function clearWorkspaceHistory(home: string): string[] {
  saveWorkspaceHistory(home, [])
  return []
}

/** Remove one workspace path from history and persist the result. */
export function forgetWorkspaceHistory(home: string, path: string): string[] {
  const entries = loadWorkspaceHistory(home).filter(item => item !== path.trim())
  saveWorkspaceHistory(home, entries)
  return entries
}
