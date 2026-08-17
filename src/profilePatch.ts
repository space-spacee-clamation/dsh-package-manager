/**
 * Minimal, comment-preserving edits to a profile's user patch layer.
 *
 * A package-manager disable is persisted as the same `{ id, disabled: true }`
 * patch the architecture documents — the profile patch layer is applied after
 * every bundle layer, so a disabled bundle row never mounts on the next boot.
 * Enable removes exactly the blocks this module wrote; user-authored patches
 * are left untouched.
 * @module @dsh-ext/dsh-package-manager/profilePatch
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function profilePatchPath(dir: string): string {
  return join(dir, 'cordis.patch.yml')
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function disabledBlock(id: string): string {
  return `- id: ${JSON.stringify(id)}\n  disabled: true\n`
}

function disabledBlockPattern(id: string): RegExp {
  const quoted = escapeRegExp(JSON.stringify(id))
  return new RegExp(`(^|\\r?\\n)[ \\t]*- id: ${quoted}\\r?\\n[ \\t]+disabled: true\\r?\\n?`, 'g')
}

/**
 * Add or remove a package-manager-owned `{ id, disabled: true }` patch block.
 * Returns true when the file changed.
 */
export function setRowDisabled(dir: string, id: string, disabled: boolean): boolean {
  const path = profilePatchPath(dir)
  let text = existsSync(path) ? readFileSync(path, 'utf8') : ''
  if (disabled) {
    if (disabledBlockPattern(id).test(text)) return false
    disabledBlockPattern(id).lastIndex = 0
    const suffix = text.endsWith('\n') ? '' : text === '' ? '' : '\n'
    writeFileSync(path, `${text}${suffix}${disabledBlock(id)}`)
    return true
  }

  const next = text.replace(disabledBlockPattern(id), (_match, newline: string) => newline === '' ? '' : newline)
  if (next === text) return false
  writeFileSync(path, next.trim() === '' ? '[]\n' : next)
  return true
}
