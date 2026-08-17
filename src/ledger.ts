/**
 * Durable ledger of installed plugins. The ledger is the runtime's memory of
 * "what this machine actually did": every entry stores the ordered steps that
 * installed it, each carrying its inverse, so uninstall is a LIFO replay of
 * inverses rather than a second, independently-authored removal procedure.
 * @module @dsh-ext/dsh-package-manager/ledger
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ledgerPath, profileDir } from './paths.ts'
import { readManifest, type ProfileManifest } from './profile.ts'
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

/**
 * Installed-truth check for one entry. The profile manifest is the host's
 * authoritative plugin state (`dsh plugin` owns dependencies + bundle rows),
 * so an entry whose recorded profile dependency and bundle row both vanished
 * (for example the user removed it with the host CLI) is no longer installed.
 *
 * dsh-bundle entries check their packageName. Custom-adapter entries check
 * the packageNames recorded by their `profile.dependency.add` steps; a custom
 * entry that recorded no profile dependency (for example one that only copies
 * files into the home) stays effective — its truth lives outside the profile.
 */
export function isEntryEffective(home: string, entry: LedgerEntry): boolean {
  // Workspace-channel entries keep their installed-truth inside the plugin
  // workspace (.venv), never in the profile manifest, so the profile check
  // does not apply to them.
  if ((entry.channel ?? 'profile') === 'workspace') return true
  let manifest: ProfileManifest
  try {
    manifest = readManifest(entry.profileDir ?? profileDir(home, entry.profile))
  } catch {
    return true
  }
  const dependencies = manifest.dependencies ?? {}
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const dependencyNames = entry.adapter === 'dsh-bundle' && entry.packageName !== ''
    ? [entry.packageName]
    : entry.steps
      .filter(step => step.kind === 'profile.dependency.add')
      .map(step => step.params['packageName'])
      .filter((name): name is string => typeof name === 'string' && name !== '')
  if (dependencyNames.length === 0) return true
  return dependencyNames.some(name => dependencies[name] !== undefined || bundles.includes(name))
}

/**
 * Read view of the ledger reconciled against profile manifests: stale
 * dsh-bundle entries are filtered out so restore/state never report plugins
 * the host no longer has installed. The disk ledger is not modified.
 */
export function loadEffectiveLedger(home: string): Ledger {
  const ledger = loadLedger(home)
  const effective: Ledger = { version: 1, profiles: {} }
  for (const [profile, bucket] of Object.entries(ledger.profiles)) {
    const entries = Object.values(bucket)
      .filter(entry => entry !== undefined && isEntryEffective(home, entry))
    if (entries.length === 0) continue
    effective.profiles[profile] = Object.fromEntries(entries.map(entry => [entry.id, entry]))
  }
  return effective
}
