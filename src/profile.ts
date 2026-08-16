/**
 * Profile manifest and pnpm-workspace editing. A profile is the harness's own
 * directory under <home>/profiles/<name>; the manager writes exactly the files
 * `dsh plugin` owns (package.json, cordis.patch.yml, pnpm-workspace.yaml) and
 * never invents additional formats.
 * @module @dsh-ext/dsh-package-manager/profile
 */

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import YAML from 'yaml'
import { profileDir } from './paths.ts'

export interface ProfileManifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: {
    bundle?: { patch: string }
    profile?: { bundles?: string[] }
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface PnpmWorkspace {
  packages?: string[]
  nodeLinker?: string
  autoInstallPeers?: boolean
  allowBuilds?: string[]
  [key: string]: unknown
}

/** Bundles a brand-new profile ships with, mirroring the harness templates. */
export const PROFILE_TEMPLATES: Record<string, readonly string[]> = {
  web: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
  headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
}

export const DEFAULT_PROFILE_BUNDLES: readonly string[] = ['@deepseek-ai/dsh-base']

const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries.\n[]\n`

const PROFILE_PNPM_WORKSPACE = `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n`

export function profileManifestPath(dir: string): string {
  return join(dir, 'package.json')
}

export function profilePatchPath(dir: string): string {
  return join(dir, 'cordis.patch.yml')
}

export function profileWorkspacePath(dir: string): string {
  return join(dir, 'pnpm-workspace.yaml')
}

/** Read a profile manifest, throwing a named error on malformed data. */
export function readManifest(dir: string): ProfileManifest {
  const path = profileManifestPath(dir)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return {}
  }
  const parsed = JSON.parse(raw) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`profile manifest ${path} must hold a JSON object`)
  }
  return parsed as ProfileManifest
}

/** Write a profile manifest as 2-space JSON plus a trailing newline. */
export function writeManifest(dir: string, manifest: ProfileManifest): void {
  writeFileSync(profileManifestPath(dir), JSON.stringify(manifest, undefined, 2) + '\n')
}

/** Read the pnpm workspace settings, or undefined when the file is absent. */
export function readWorkspace(dir: string): PnpmWorkspace | undefined {
  const path = profileWorkspacePath(dir)
  if (!existsSync(path)) return undefined
  const parsed = YAML.parse(readFileSync(path, 'utf8')) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`pnpm workspace ${path} must hold a YAML mapping`)
  }
  return parsed as PnpmWorkspace
}

/** Write pnpm workspace settings as YAML. */
export function writeWorkspace(dir: string, workspace: PnpmWorkspace): void {
  writeFileSync(profileWorkspacePath(dir), YAML.stringify(workspace))
}

/** Initialize a profile directory; existing files are never touched. */
export function ensureProfile(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true })
  const manifestPath = profileManifestPath(dir)
  if (!existsSync(manifestPath)) {
    const manifest: ProfileManifest = {
      name: `dsh-profile-${basename(dir)}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...(PROFILE_TEMPLATES[name] ?? DEFAULT_PROFILE_BUNDLES)] } },
    }
    writeManifest(dir, manifest)
  }
  const patchPath = profilePatchPath(dir)
  if (!existsSync(patchPath)) writeFileSync(patchPath, PROFILE_PATCH_TEMPLATE)
  const workspacePath = profileWorkspacePath(dir)
  if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
}

/**
 * Resolve a dependency's package root inside a profile's node_modules without
 * requiring the package to export ./package.json — the same directory probe
 * the harness uses for profile bundles.
 * @param dir - profile directory (resolution anchor).
 * @param packageName - dependency name (scoped names keep their slash).
 * @returns the package root, or undefined when unresolvable.
 */
export function resolvePackageDir(dir: string, packageName: string): string | undefined {
  const paths = createRequire(join(dir, 'package.json')).resolve.paths(packageName) ?? []
  for (const searchPath of paths) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

export interface BundleReconcileResult {
  added: string[]
  removed: string[]
  changed: boolean
}

/**
 * Reconcile `dsh.profile.bundles` against installed dependencies — the add
 * half of `dsh plugin`'s policy: a dependency resolving to a package declaring
 * `dsh.bundle` joins the layer stack. Removal is deliberately NOT performed
 * here: it belongs to recorded inverse steps, so uninstalls stay transactional
 * and a hand-maintained bundle row can never be silently dropped.
 * @param dir - profile directory.
 * @returns the added bundle names.
 */
export function reconcileBundles(dir: string): BundleReconcileResult {
  const manifest = readManifest(dir)
  const dependencies = Object.keys(manifest.dependencies ?? {})
  const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
  const added: string[] = []
  for (const packageName of dependencies) {
    if (bundles.includes(packageName)) continue
    const packageDir = resolvePackageDir(dir, packageName)
    if (packageDir === undefined) continue
    const packageManifest = readManifest(packageDir)
    if (packageManifest.dsh?.bundle?.patch !== undefined) {
      bundles.push(packageName)
      added.push(packageName)
    }
  }
  const changed = added.length > 0
  if (changed) {
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
    writeManifest(dir, manifest)
  }
  return { added, removed: [], changed }
}

/** Current allowBuilds list ([] when unset). */
export function readAllowBuilds(dir: string): string[] {
  return [...(readWorkspace(dir)?.allowBuilds ?? [])]
}

/** Replace the allowBuilds list wholesale and persist. */
export function writeAllowBuilds(dir: string, packages: string[]): void {
  const workspace = readWorkspace(dir) ?? { packages: ['.'], nodeLinker: 'hoisted', autoInstallPeers: false }
  workspace.allowBuilds = [...new Set(packages)]
  writeWorkspace(dir, workspace)
}

/** All profiles present under a home (directories with a package.json). */
export function listProfiles(home: string): string[] {
  const root = join(home, 'profiles')
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && existsSync(join(root, dirent.name, 'package.json')))
    .map(dirent => dirent.name)
}

/** Profile directory helper for tests and the manager. */
export function resolveProfileDir(home: string, name: string): string {
  return profileDir(home, name)
}
