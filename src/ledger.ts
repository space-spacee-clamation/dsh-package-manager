/**
 * Durable ledger of installed plugins. The ledger is the runtime's memory of
 * "what this machine actually did": every entry stores the ordered steps that
 * installed it, each carrying its inverse, so uninstall is a LIFO replay of
 * inverses rather than a second, independently-authored removal procedure.
 * @module @dsh-ext/dsh-package-manager/ledger
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ledgerPath } from './paths.ts'
import type { Ledger, LedgerEntry } from './types.ts'

export function emptyLedger(): Ledger {
  return { version: 1, profiles: {} }
}

export function loadLedger(home: string): Ledger {
  const path = ledgerPath(home)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return emptyLedger()
  }
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`package-manager ledger ${path} must hold a JSON object`)
  }
  const ledger = parsed as Ledger
  if (ledger.version !== 1 || ledger.profiles === null || typeof ledger.profiles !== 'object' || Array.isArray(ledger.profiles)) {
    throw new Error(`package-manager ledger ${path} has an unsupported shape (expected version 1)`)
  }
  return ledger
}

/** Atomic save: write a sibling temp file, then rename over the ledger. */
export function saveLedger(home: string, ledger: Ledger): void {
  const path = ledgerPath(home)
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(ledger, undefined, 2) + '\n')
  renameSync(temp, path)
}

export function getEntry(ledger: Ledger, profile: string, id: string): LedgerEntry | undefined {
  return ledger.profiles[profile]?.[id]
}

export function setEntry(ledger: Ledger, entry: LedgerEntry): void {
  const bucket = ledger.profiles[entry.profile] ?? (ledger.profiles[entry.profile] = {})
  bucket[entry.id] = entry
}

export function removeEntry(ledger: Ledger, profile: string, id: string): LedgerEntry | undefined {
  const bucket = ledger.profiles[profile]
  if (bucket === undefined) return undefined
  const entry = bucket[id]
  if (entry === undefined) return undefined
  delete bucket[id]
  return entry
}

export function listEntries(ledger: Ledger): LedgerEntry[] {
  return Object.values(ledger.profiles).flatMap(entries => Object.values(entries))
}
