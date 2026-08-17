/**
 * Requirements files: the declarative specification a machine restores from.
 * One file lists every mode (profile) and the plugins it should hold. The
 * manager reconciles this desired state against the ledger with id-keyed
 * diffs — mirroring the harness Loader's incremental configuration
 * reconciliation — so restore converges instead of reinstalling.
 * @module @dsh-ext/dsh-package-manager/spec
 */

import { isAbsolute, join, resolve } from 'node:path'
import YAML from 'yaml'
import type { Ledger } from './types.ts'
import type { PlanAction, RequirementsSpec, SpecEntry, SpecFingerprint } from './types.ts'

const ADAPTERS = new Set(['auto', 'dsh-bundle', 'custom'])

export function parseRequirements(text: string, baseDir: string): RequirementsSpec {
  const parsed = YAML.parse(text) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('requirements: root must be a YAML mapping')
  }
  const root = parsed as Record<string, unknown>
  if (root.version !== 1) throw new Error('requirements: unsupported version (expected 1)')
  if (root.modes === null || typeof root.modes !== 'object' || Array.isArray(root.modes)) {
    throw new Error('requirements: modes must be a mapping of profile name -> plugin list')
  }
  const modes: Record<string, SpecEntry[]> = {}
  for (const [mode, value] of Object.entries(root.modes as Record<string, unknown>)) {
    if (mode === '') throw new Error('requirements: mode name must not be empty')
    if (!Array.isArray(value)) throw new Error(`requirements: modes.${mode} must be a list`)
    modes[mode] = value.map((raw, index) => parseEntry(raw, `modes.${mode}[${index}]`))
    const ids = new Set<string>()
    for (const entry of modes[mode]) {
      if (ids.has(entry.id)) throw new Error(`requirements: duplicate plugin id ${JSON.stringify(entry.id)} in mode ${JSON.stringify(mode)}`)
      ids.add(entry.id)
    }
  }
  const repo = typeof root.repo === 'string' ? root.repo : '.'
  return { version: 1, repo, modes, baseDir: resolve(baseDir) }
}

function parseEntry(raw: unknown, where: string): SpecEntry {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`requirements: ${where} must be a mapping`)
  }
  const value = raw as Record<string, unknown>
  const id = value.id
  const source = value.source
  if (typeof id !== 'string' || id === '') throw new Error(`requirements: ${where}.id must be a non-empty string`)
  if (typeof source !== 'string' || source === '') throw new Error(`requirements: ${where}.source must be a non-empty string`)
  const adapter = value.adapter === undefined ? 'auto' : value.adapter
  if (typeof adapter !== 'string' || !ADAPTERS.has(adapter)) throw new Error(`requirements: ${where}.adapter must be auto, dsh-bundle, or custom`)
  const adapterDir = value.adapterDir
  if (adapterDir !== undefined && typeof adapterDir !== 'string') throw new Error(`requirements: ${where}.adapterDir must be a string`)
  const ref = value.ref
  if (ref !== undefined && typeof ref !== 'string') throw new Error(`requirements: ${where}.ref must be a string`)
  const allowBuild = value.allowBuild
  if (allowBuild !== undefined && typeof allowBuild !== 'boolean') throw new Error(`requirements: ${where}.allowBuild must be a boolean`)
  return {
    id,
    source,
    adapter: adapter as SpecEntry['adapter'],
    adapterDir: adapterDir ?? '',
    ref: ref ?? '',
    allowBuild: allowBuild ?? false,
  }
}

/** Change-detection fingerprint of a spec entry. */
export function fingerprint(entry: SpecEntry): SpecFingerprint {
  return { source: entry.source, adapter: entry.adapter, adapterDir: entry.adapterDir, ref: entry.ref, allowBuild: entry.allowBuild }
}

/** Resolve an adapter dir relative to the requirements file (absolute paths pass through). */
export function resolveAdapterDir(spec: RequirementsSpec, adapterDir: string): string {
  return isAbsolute(adapterDir) ? adapterDir : join(spec.baseDir, adapterDir)
}

/**
 * Compute the minimal id-keyed reconciliation plan between a requirements file
 * and the ledger. Entries present in both with equal fingerprints are kept
 * (their installs are not replayed); changed entries update (uninstall then
 * install); ledger entries absent from the spec uninstall; spec entries absent
 * from the ledger install.
 * @param spec - parsed requirements file.
 * @param ledger - current installed state.
 * @param modeFilter - modes to reconcile; empty means all declared modes.
 */
export function planRestore(spec: RequirementsSpec, ledger: Ledger, modeFilter: readonly string[] = []): PlanAction[] {
  const modes = modeFilter.length > 0 ? [...modeFilter] : Object.keys(spec.modes)
  return planModes(spec, ledger, modes, true)
}

/**
 * Reconciliation plan used when switching the active workspace root. Unlike
 * restore, modes that exist in the ledger but are absent from the target
 * requirements file are reconciled to an empty desired set, so switching
 * workspaces closes plugins the target does not declare.
 */
export function planWorkspaceSwitch(spec: RequirementsSpec, ledger: Ledger): PlanAction[] {
  const modes = [...new Set([...Object.keys(spec.modes), ...Object.keys(ledger.profiles)])]
  return planModes(spec, ledger, modes, false)
}

function planModes(
  spec: RequirementsSpec,
  ledger: Ledger,
  modes: readonly string[],
  requireDeclared: boolean,
): PlanAction[] {
  const actions: PlanAction[] = []
  for (const mode of modes) {
    const desired = spec.modes[mode]
    if (desired === undefined && requireDeclared) throw new Error(`requirements: mode ${JSON.stringify(mode)} is not declared`)
    const currentEntries = ledger.profiles[mode] ?? {}
    for (const entry of desired ?? []) {
      const current = currentEntries[entry.id]
      if (current === undefined) {
        actions.push({ action: 'install', profile: mode, id: entry.id, reason: 'declared in requirements, not installed', entry })
      } else if (sameFingerprint(fingerprint(entry), current.spec)) {
        actions.push(current.disabled === true
          ? { action: 'enable', profile: mode, id: entry.id, reason: 'installed state matches but the plugin is switched off', entry, current }
          : { action: 'keep', profile: mode, id: entry.id, reason: 'installed state matches', entry, current })
      } else {
        actions.push({ action: 'update', profile: mode, id: entry.id, reason: 'source or adapter changed', entry, current })
      }
    }
    for (const id of Object.keys(currentEntries)) {
      if (!(desired ?? []).some(entry => entry.id === id)) {
        const current = currentEntries[id]
        actions.push({
          action: 'uninstall', profile: mode, id,
          reason: desired === undefined ? 'mode is not declared by the target workspace' : 'not declared in requirements',
          ...(current === undefined ? {} : { current }),
        })
      }
    }
  }
  return actions
}

function sameFingerprint(left: SpecFingerprint, right: SpecFingerprint): boolean {
  return left.source === right.source
    && left.adapter === right.adapter
    && left.adapterDir === right.adapterDir
    && left.ref === right.ref
    && left.allowBuild === right.allowBuild
}

/** All ids a mode currently holds. */
export function modeIds(spec: RequirementsSpec, mode: string): string[] {
  return (spec.modes[mode] ?? []).map(entry => entry.id)
}
