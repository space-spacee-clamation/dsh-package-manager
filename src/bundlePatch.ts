/**
 * Bundle patch parsing for the dsh-bundle hot-plug fast path.
 *
 * A DSH bundle is a *distribution format*: its `cordis.patch.yml` lists the
 * loader entries that the profile composition would mount after a restart.
 * Hot-plugging therefore mounts those patch rows through `ctx.loader`, not the
 * bundle package itself. This module only parses and flattens the patch file;
 * the loader interaction lives in `src/cordisRuntime.ts`.
 * @module @dsh-ext/dsh-package-manager/bundlePatch
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import YAML from 'yaml'
import type { ScalarTag } from 'yaml'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

/** The loader expression tag used by DSH patch files (`!!js`). */
const jsExprTag: ScalarTag = {
  tag: 'tag:yaml.org,2002:js',
  resolve(value) {
    return { __jsExpr: value }
  },
}

/** One row contributed by a bundle patch (`insert` child or a patch target). */
export type BundlePatchRow = Partial<EntryOptions> & Record<string, unknown>

/** A single action in a bundle patch list. */
export type BundlePatchAction =
  | { insert: true; rows: BundlePatchRow[] }
  | { insert: false; id: string; fields: BundlePatchRow }

/** Parsed bundle patch file. */
export interface BundlePatchDocument {
  /** Absolute patch file path. */
  path: string
  actions: BundlePatchAction[]
  /** Every inserted row in order, before id-targeted overrides are applied. */
  rows: BundlePatchRow[]
  /** The original patch list, as plain objects — the exact list an Include applies. */
  raw: Record<string, unknown>[]
}

/** Parse a patch list into plain objects for passing back to Include config. */
export function parsePatchObjects(text: string, path: string): Record<string, unknown>[] {
  let parsed: unknown
  try {
    parsed = YAML.parse(text, { customTags: [jsExprTag] })
  } catch (error) {
    throw new Error(`patch file ${path} is not valid YAML: ${messageOf(error)}`)
  }
  if (!Array.isArray(parsed)) throw new Error(`patch file ${path} must be a top-level YAML array`)
  return parsed as Record<string, unknown>[]
}
/** Parse one loader patch list using the same `!!js` dialect as DSH includes. */
export function parseBundlePatch(text: string, path: string): BundlePatchDocument {
  let parsed: unknown
  try {
    parsed = YAML.parse(text, { customTags: [jsExprTag] })
  } catch (error) {
    throw new Error(`bundle patch ${path} is not valid YAML: ${messageOf(error)}`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`bundle patch ${path} must be a top-level YAML array of loader patch entries`)
  }
  const actions: BundlePatchAction[] = []
  const rows: BundlePatchRow[] = []
  const rawList: Record<string, unknown>[] = []
  for (const [index, raw] of parsed.entries()) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`bundle patch ${path}[${index}] must be a mapping`)
    }
    const item = raw as Record<string, unknown>
    const insert = item['insert']
    if (insert !== undefined) {
      if (!Array.isArray(insert)) throw new Error(`bundle patch ${path}[${index}].insert must be a list`)
      const children = insert.map((child, childIndex) => {
        if (child === null || typeof child !== 'object' || Array.isArray(child)) {
          throw new Error(`bundle patch ${path}[${index}].insert[${childIndex}] must be a mapping`)
        }
        return child as BundlePatchRow
      })
      actions.push({ insert: true, rows: children })
      rows.push(...children)
      rawList.push(item)
      continue
    }
    const id = item['id']
    if (typeof id !== 'string' || id === '') {
      throw new Error(`bundle patch ${path}[${index}]: non-insert patches require a string id`)
    }
    actions.push({ insert: false, id, fields: item })
    rawList.push(item)
  }
  return { path, actions, rows, raw: rawList }
}

/** Read a bundle package's patch file from its package manifest declaration. */
export function loadBundlePatch(packageDir: string): BundlePatchDocument | undefined {
  const manifestPath = join(packageDir, 'package.json')
  if (!existsSync(manifestPath)) return undefined
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dsh?: { bundle?: { patch?: string } }
  }
  const declared = manifest.dsh?.bundle?.patch
  if (typeof declared !== 'string' || declared === '') return undefined
  const path = join(packageDir, declared)
  if (!existsSync(path)) throw new Error(`bundle patch file not found: ${path}`)
  return parseBundlePatch(readFileSync(path, 'utf8'), path)
}

/** Stable fallback id for an inserted row that did not declare one. */
export function stablePatchRowId(profile: string, pluginId: string, index: number): string {
  return `pm-${safeIdPart(profile)}-${safeIdPart(pluginId)}-${index}`
}

function safeIdPart(value: string): string {
  const safe = value.replaceAll(/[^A-Za-z0-9._-]/g, '-')
  return safe.length > 0 ? safe : 'plugin'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
