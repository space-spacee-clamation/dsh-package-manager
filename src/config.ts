/**
 * Package-manager preferences and disabled-plugin memory. These are small,
 * user-visible JSON files under `<home>/package-manager`: `config.json` keeps
 * the configured requirements repo (local storage path + remote URL + auto
 * sync), and `disabled.json` remembers plugins that were switched off so the
 * settings UI can switch them back on.
 * @module @dsh-ext/dsh-package-manager/config
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pmRoot } from './paths.ts'
import type { DisabledEntry, PackageManagerConfig } from './types.ts'

const CONFIG_FILENAME = 'config.json'
const DISABLED_FILENAME = 'disabled.json'

export const DEFAULT_PACKAGE_CONFIG: PackageManagerConfig = {
  storagePath: '',
  remoteUrl: '',
  autoSync: false,
}

export function configPath(home: string): string {
  return join(pmRoot(home), CONFIG_FILENAME)
}

export function disabledPath(home: string): string {
  return join(pmRoot(home), DISABLED_FILENAME)
}

/** Normalize and validate a config object; throws on malformed values. */
export function normalizeConfig(value: unknown): PackageManagerConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('package-manager config must be a JSON object')
  }
  const raw = value as Record<string, unknown>
  const storagePath = raw.storagePath
  const remoteUrl = raw.remoteUrl
  const autoSync = raw.autoSync
  if (typeof storagePath !== 'string') throw new Error('package-manager config: storagePath must be a string')
  if (typeof remoteUrl !== 'string') throw new Error('package-manager config: remoteUrl must be a string')
  if (typeof autoSync !== 'boolean') throw new Error('package-manager config: autoSync must be a boolean')
  return { storagePath, remoteUrl, autoSync }
}

/** Read the manager config, returning defaults when no file exists yet. */
export function loadConfig(home: string): PackageManagerConfig {
  let raw: string
  try {
    raw = readFileSync(configPath(home), 'utf8')
  } catch {
    return { ...DEFAULT_PACKAGE_CONFIG }
  }
  const parsed = JSON.parse(raw) as unknown
  const config = normalizeConfig(parsed)
  return { ...DEFAULT_PACKAGE_CONFIG, ...config }
}

/** Atomically persist the manager config. */
export function saveConfig(home: string, value: unknown): PackageManagerConfig {
  const config = normalizeConfig(value)
  const path = configPath(home)
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(config, undefined, 2) + '\n')
  renameSync(temp, path)
  return config
}

/** Parse one disabled entry with strict field checks. */
function parseDisabledEntry(value: unknown, where: string): DisabledEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`package-manager disabled store: ${where} must be a JSON object`)
  }
  const raw = value as Record<string, unknown>
  const { profile, id, source, adapter, adapterDir, ref, allowBuild } = raw
  if (typeof profile !== 'string' || profile === '') throw new Error(`package-manager disabled store: ${where}.profile must be a non-empty string`)
  if (typeof id !== 'string' || id === '') throw new Error(`package-manager disabled store: ${where}.id must be a non-empty string`)
  if (typeof source !== 'string' || source === '') throw new Error(`package-manager disabled store: ${where}.source must be a non-empty string`)
  if (adapter !== 'dsh-bundle' && adapter !== 'custom') throw new Error(`package-manager disabled store: ${where}.adapter must be dsh-bundle or custom`)
  if (typeof adapterDir !== 'string') throw new Error(`package-manager disabled store: ${where}.adapterDir must be a string`)
  if (typeof ref !== 'string') throw new Error(`package-manager disabled store: ${where}.ref must be a string`)
  if (typeof allowBuild !== 'boolean') throw new Error(`package-manager disabled store: ${where}.allowBuild must be a boolean`)
  return { profile, id, source, adapter, adapterDir, ref, allowBuild }
}

/** Read disabled entries, returning an empty list when no file exists yet. */
export function loadDisabled(home: string): DisabledEntry[] {
  let raw: string
  try {
    raw = readFileSync(disabledPath(home), 'utf8')
  } catch {
    return []
  }
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`package-manager disabled store ${disabledPath(home)} must hold a JSON object`)
  }
  const store = parsed as { version?: unknown; entries?: unknown }
  if (store.version !== 1 || store.entries === undefined || !Array.isArray(store.entries)) {
    throw new Error(`package-manager disabled store ${disabledPath(home)} has an unsupported shape (expected version 1)`)
  }
  return store.entries.map((entry, index) => parseDisabledEntry(entry, `entries[${index}]`))
}

/** Atomically persist the disabled list. */
export function saveDisabled(home: string, entries: DisabledEntry[]): void {
  const path = disabledPath(home)
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify({ version: 1, entries }, undefined, 2) + '\n')
  renameSync(temp, path)
}

/** Add or replace the disabled record for one profile/id. */
export function upsertDisabledEntry(home: string, entry: DisabledEntry): void {
  const entries = loadDisabled(home)
  const index = entries.findIndex(item => item.profile === entry.profile && item.id === entry.id)
  if (index >= 0) entries[index] = entry
  else entries.push(entry)
  saveDisabled(home, entries)
}

/** Remove and return the disabled record for one profile/id, if any. */
export function removeDisabledEntry(home: string, profile: string, id: string): DisabledEntry | undefined {
  const entries = loadDisabled(home)
  const index = entries.findIndex(item => item.profile === profile && item.id === id)
  if (index < 0) return undefined
  const [entry] = entries.splice(index, 1)
  saveDisabled(home, entries)
  return entry
}

