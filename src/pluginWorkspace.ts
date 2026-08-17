/**
 * Per-plugin workspace layout: a directory the AI session owns as its cwd.
 * dsh-bundle installs do NOT use this directory (they are profile
 * dependencies + a cordis.patch.yml managed block); custom adapters may use
 * `${DSH_PLUGIN_ENV}` here for their own isolated files. The durable
 * workspace manifest is the bridge between the
 * filesystem path and the pm_install/pm_scaffold AI tools: tools only act on
 * workspaces created by the settings tab, never on arbitrary session cwds.
 * @module @dsh-ext/dsh-package-manager/pluginWorkspace
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertProfileName } from './paths.ts'

export const PLUGIN_ENV_DIRNAME = '.venv'
export const WORKSPACE_MANIFEST = 'package-manager.json'

export interface PluginWorkspaceManifest {
  version: 1
  profile: string
  id: string
  source: string
  createdAt: string
}

/** Lossless path spelling of the id; the manifest always preserves the original id. */
export function safePluginId(id: string): string {
  const safe = encodeURIComponent(id)
  return safe.length > 0 ? safe : 'plugin'
}

/** `<workspaceRoot>/<profile>/<safe-id>` — the AI session cwd. */
export function pluginWorkspaceDir(root: string, profile: string, id: string): string {
  assertProfileName(profile)
  return join(root, profile, safePluginId(id))
}

/** `<workspace>/<profile>/<safe-id>/.venv` — optional custom-adapter dependency layer. */
export function pluginEnvDir(workspaceDir: string): string {
  return join(workspaceDir, PLUGIN_ENV_DIRNAME)
}

export function workspaceManifestPath(workspaceDir: string): string {
  return join(workspaceDir, WORKSPACE_MANIFEST)
}

/** Create the workspace and write the durable link between path and install request. */
export function ensurePluginWorkspace(root: string, profile: string, id: string, source: string): string {
  const dir = pluginWorkspaceDir(root, profile, id)
  mkdirSync(dir, { recursive: true })
  const existing = readWorkspaceManifest(dir)
  if (existing === undefined || existing.source !== source || existing.profile !== profile || existing.id !== id) {
    writeWorkspaceManifest(dir, {
      version: 1,
      profile,
      id,
      source,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    })
  }
  return dir
}

export function writeWorkspaceManifest(dir: string, manifest: PluginWorkspaceManifest): void {
  writeFileSync(workspaceManifestPath(dir), JSON.stringify(manifest, undefined, 2) + '\n')
}

/** Read and validate the workspace manifest; undefined when absent. */
export function readWorkspaceManifest(dir: string): PluginWorkspaceManifest | undefined {
  const path = workspaceManifestPath(dir)
  if (!existsSync(path)) return undefined
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`plugin workspace manifest ${path} must hold a JSON object`)
  }
  const raw = parsed as Record<string, unknown>
  const { version, profile, id, source } = raw
  if (version !== 1) throw new Error(`plugin workspace manifest ${path} has an unsupported version`)
  if (typeof profile !== 'string' || profile === '') throw new Error(`plugin workspace manifest ${path}: profile must be a non-empty string`)
  if (typeof id !== 'string' || id === '') throw new Error(`plugin workspace manifest ${path}: id must be a non-empty string`)
  if (typeof source !== 'string' || source === '') throw new Error(`plugin workspace manifest ${path}: source must be a non-empty string`)
  return { version: 1, profile, id, source, createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '' }
}

