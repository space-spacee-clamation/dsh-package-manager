/**
 * Official hot-reload seam: the package manager never talks to `ctx.loader`
 * directly and never recomposes the root Include itself. It only edits the
 * profile's own user patch layer (`cordis.patch.yml`), which the DSH
 * launcher already watches through `watchUserPatches`:
 *
 *   bundle layers (boot snapshot) -> profile cordis.patch.yml -> home
 *   cordis.patch.yml -> launcher overlays
 *
 * Every `dsh-bundle` install owns one clearly-marked block in that file. The
 * block carries the bundle patch rows verbatim (normalized `!!js` expression
 * nodes survive round-trip). Adding the block is the hot-mount, removing it
 * is the hot-unmount, and re-writing it with trailing `{ id, disabled: true }`
 * rows is disable/enable. `watchUserPatches` performs the loader diff, so no
 * restart and no package-manager-side composition code are needed.
 * @module @dsh-ext/dsh-package-manager/profilePatch
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import YAML, { isSeq } from 'yaml'
import type { ScalarTag } from 'yaml'
import { loadBundlePatch, stablePatchRowId } from './bundlePatch.ts'
import { profilePatchPath, resolvePackageDir } from './profile.ts'
import type { LedgerEntry } from './types.ts'

/** The loader expression tag used by DSH patch files (`!!js`). */
const jsExprTag: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  identify(value) {
    return value !== null && typeof value === 'object' && '__jsExpr' in value
  },
  resolve(value) {
    return { __jsExpr: value }
  },
  stringify(item) {
    const value = item.value
    return value !== null && typeof value === 'object' && '__jsExpr' in value && typeof value.__jsExpr === 'string'
      ? value.__jsExpr
      : String(value)
  },
}

/** Normalized bundle patch list written into one package-manager block. */
export interface ManagedPatch {
  entries: Record<string, unknown>[]
  /** Stable ids of the rows this bundle inserts (fallback ids assigned for rows without one). */
  rowIds: string[]
}

function markerStart(id: string): string {
  return `# >>> dsh-package-manager: ${JSON.stringify(id)}`
}

function markerEnd(id: string): string {
  return `# <<< dsh-package-manager: ${JSON.stringify(id)}`
}

function eolOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/)
}

/**
 * Remove a previously written managed block by its marker comments. User
 * content is untouched; a start marker without its end marker is a corrupted
 * managed file and fails loudly instead of silently eating the rest of it.
 */
export function removeManagedPatch(dir: string, id: string): boolean {
  const path = profilePatchPath(dir)
  if (!existsSync(path)) return false
  const text = readFileSync(path, 'utf8')
  const next = removeManagedBlock(text, id)
  if (next === text) return false
  writeFileSync(path, next)
  return true
}

/** True when this manager owns a hot-reload block for `id` in the profile patch layer. */
export function hasManagedPatch(dir: string, id: string): boolean {
  const path = profilePatchPath(dir)
  if (!existsSync(path)) return false
  const text = readFileSync(path, 'utf8')
  const start = markerStart(id)
  const end = markerEnd(id)
  let seen = false
  for (const line of splitLines(text)) {
    const trimmed = line.trim()
    if (trimmed === start) seen = true
    else if (seen && trimmed === end) return true
  }
  return false
}

/**
 * Install/replace the managed block for one plugin.
 *
 * The existing file is parsed and re-serialized with the DSH `!!js` dialect,
 * so user comments are preserved and only this plugin's previous block is
 * replaced. The returned list is what the official watcher will diff into the
 * loader tree on the next `cordis.patch.yml` change event.
 */
export function writeManagedPatch(
  dir: string,
  id: string,
  entries: readonly Record<string, unknown>[],
  disabled: boolean,
  rowIds: readonly string[],
): { path: string; entries: Record<string, unknown>[] } {
  const path = profilePatchPath(dir)
  let text = existsSync(path) ? readFileSync(path, 'utf8') : '[]\n'
  text = removeManagedBlock(text, id)
  if (text.trim() === '') text = '[]\n'

  let doc = YAML.parseDocument(text, { customTags: [jsExprTag] })
  if (doc.contents === null) {
    // Removing the only managed block from the host's `[]` template leaves a
    // comment-only file; restore the empty entry list before re-parsing.
    text = '[]\n'
    doc = YAML.parseDocument(text, { customTags: [jsExprTag] })
  }
  if (!isSeq(doc.contents)) {
    throw new Error(`profile patch ${path} must be a top-level YAML array of loader patch entries`)
  }

  const block: Record<string, unknown>[] = structuredClone(entries) as Record<string, unknown>[]
  if (disabled) {
    for (const rowId of new Set(rowIds)) {
      block.push({ id: rowId, disabled: true })
    }
  }

  // The host's profile template writes `[]` in flow style. Force block style
  // before appending so the managed markers stay standalone comment lines and
  // the resulting file remains the conventional `- item` list dialect.
  doc.contents.flow = false
  const created = doc.createNode(block)
  if (!isSeq(created)) {
    throw new Error(`internal: managed patch block for ${JSON.stringify(id)} did not serialize as a sequence`)
  }
  const items = [...(created as unknown as typeof doc.contents).items]
  if (items.length > 0) {
    items[0]!.commentBefore = ` >>> dsh-package-manager: ${JSON.stringify(id)}`
    items[items.length - 1]!.comment = ` <<< dsh-package-manager: ${JSON.stringify(id)}`
    doc.contents.items.push(...items)
  }

  let next = doc.toString()
  if (next === '') next = '[]\n'
  if (!next.endsWith('\n')) next += eolOf(text)
  if (next === text) return { path, entries: [...block] }
  writeFileSync(path, next)
  return { path, entries: [...block] }
}

/**
 * Build the normalized entries for an installed bundle package. Insert rows
 * without a stable id receive the same deterministic fallback id every time,
 * so disable patches can always target them.
 */
export function managedPatchForPackage(packageDir: string, profile: string, id: string): ManagedPatch | undefined {
  const patch = loadBundlePatch(packageDir)
  if (patch === undefined) return undefined
  const entries = structuredClone(patch.raw) as Record<string, unknown>[]
  const rowIds: string[] = []
  let fallbackIndex = 0
  for (const entry of entries) {
    const insert = entry['insert']
    if (!Array.isArray(insert)) continue
    const rows = insert.map(row => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`bundle patch ${patch.path}: insert rows must be mappings`)
      }
      const record = row as Record<string, unknown>
      const existing = record['id']
      if (typeof existing === 'string' && existing !== '') {
        rowIds.push(existing)
        return record
      }
      const fallback = stablePatchRowId(profile, id, fallbackIndex++)
      rowIds.push(fallback)
      return { ...record, id: fallback }
    })
    entry['insert'] = rows
  }
  return { entries, rowIds }
}

/** Resolve the installed bundle package directory for one ledger entry. */
export function resolveBundlePackageDir(entry: LedgerEntry): string | undefined {
  const packageName = entry.packageName
  if (entry.profileDir !== undefined && entry.profileDir !== '' && packageName !== '') {
    const dir = resolvePackageDir(entry.profileDir, packageName)
    if (dir !== undefined) return dir
  }
  if (entry.materializedDir !== '') {
    if (existsSync(join(entry.materializedDir, 'package.json'))) return entry.materializedDir
  }
  if (entry.pluginEnvDir !== undefined && entry.pluginEnvDir !== '') {
    if (existsSync(join(entry.pluginEnvDir, 'package.json'))) return entry.pluginEnvDir
    if (packageName !== '') {
      const dir = resolvePackageDir(entry.pluginEnvDir, packageName)
      if (dir !== undefined) return dir
    }
  }
  return undefined
}

/** Stable patch-row ids of an installed dsh-bundle entry (fallback ids included). */
export function patchRowIdsForEntry(entry: LedgerEntry): string[] {
  if (entry.adapter !== 'dsh-bundle' || entry.packageName === '') return []
  const packageDir = resolveBundlePackageDir(entry)
  if (packageDir === undefined) return []
  return managedPatchForPackage(packageDir, entry.profile, entry.id)?.rowIds ?? []
}

function removeManagedBlock(text: string, id: string): string {
  const start = markerStart(id)
  const end = markerEnd(id)
  const lines = splitLines(text)
  let st
  let startIndex = -1
  let endIndex = -1
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]?.trim() ?? ''
    if (startIndex === -1) {
      if (trimmed === start) startIndex = index
    } else if (trimmed === end) {
      endIndex = index
      break
    }
  }
  if (startIndex === -1) return text
  if (endIndex === -1) {
    throw new Error(`profile patch managed block for ${JSON.stringify(id)} has a start marker but no end marker`)
  }
  lines.splice(startIndex, endIndex - startIndex + 1)
  const result = lines.join(eolOf(text))
  // Keep the watched file loadable: removing the only block from the host's
  // `[]` template must leave a valid empty list, not a comment-only document.
  const doc = YAML.parseDocument(result, { customTags: [jsExprTag] })
  if (doc.contents === null || (isSeq(doc.contents) && doc.contents.items.length === 0)) {
    const eol = eolOf(text)
    const base = result.trim() === '' ? '' : `${result.trimEnd()}${eol}`
    return `${base}[]${eol}`
  }
  return result
}
