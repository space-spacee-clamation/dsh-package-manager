/**
 * Custom adapter: a declarative adapter.yaml beside the requirements file.
 * An AI (or a human) authors it once per unusual plugin; from then on install
 * and uninstall are plain data the package manager executes transactionally.
 * The file's steps use the same vocabulary as the built-in steps, so every
 * step still carries its explicit inverse.
 * @module @dsh-ext/dsh-package-manager/adapters/custom
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import YAML from 'yaml'
import { validateStepSpec } from '../steps.ts'
import type { AdapterContext, StepRecord, StepSpec } from '../types.ts'

export const ADAPTER_KIND = 'custom' as const
export const ADAPTER_FILENAME = 'adapter.yaml'

export interface CustomAdapter {
  id: string
  install?: StepSpec[]
  uninstall?: StepSpec[]
  verify?: StepSpec[]
}

/** Runtime variables an adapter may reference with `${NAME}` placeholders. */
export interface AdapterVariables {
  /** Harness home (`$DSH_HOME` or `~/.dsh`); expands `${DSH_HOME}`. */
  home?: string
  /** Target profile directory; expands `${DSH_PROFILE}`. */
  profileDir?: string
  /** Per-install scratch directory (holds the materialized source); expands `${DSH_WORKDIR}`. */
  workDir?: string
  /** Per-plugin workspace (the AI session cwd); expands `${DSH_WORKSPACE}`. */
  workspaceDir?: string
  /** Isolated dependency layer inside the workspace; expands `${DSH_PLUGIN_ENV}`. */
  pluginEnvDir?: string
}

const ADAPTER_VARIABLES: Record<string, keyof AdapterVariables> = {
  DSH_HOME: 'home',
  DSH_PROFILE: 'profileDir',
  DSH_WORKDIR: 'workDir',
  DSH_WORKSPACE: 'workspaceDir',
  DSH_PLUGIN_ENV: 'pluginEnvDir',
}

/** Load and validate one adapter.yaml. */
export function loadCustomAdapter(dir: string, vars: AdapterVariables = {}): CustomAdapter {
  const path = join(dir, ADAPTER_FILENAME)
  if (!existsSync(path)) throw new Error(`custom adapter directory has no ${ADAPTER_FILENAME}: ${dir}`)
  const parsed = YAML.parse(readFileSync(path, 'utf8')) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`custom adapter ${path} must hold a YAML mapping`)
  }
  const raw = parsed as Record<string, unknown>
  const id = raw.id
  if (typeof id !== 'string' || id === '') throw new Error(`custom adapter ${path}: id must be a non-empty string`)
  const adapter: CustomAdapter = { id }
  for (const section of ['install', 'uninstall', 'verify'] as const) {
    const value = raw[section]
    if (value === undefined) continue
    if (!Array.isArray(value)) throw new Error(`custom adapter ${path}: ${section} must be a list`)
    const steps: StepSpec[] = value.map((step, index) => {
      if (step === null || typeof step !== 'object' || Array.isArray(step)) {
        throw new Error(`custom adapter ${path}: ${section}[${index}] must be a mapping`)
      }
      const spec = { ...step as Record<string, unknown> } as StepSpec
      validateStepSpec(spec, `${path}:${section}[${index}]`)
      return resolveStepPaths(spec, dir, vars)
    })
    adapter[section] = steps
  }
  return adapter
}

export interface CustomInstallOptions {
  adapter: CustomAdapter
  executor: {
    run(specs: readonly StepSpec[], ctx: AdapterContext, backupRoot: string): Promise<StepRecord[]>
    rollback(records: readonly StepRecord[], ctx: AdapterContext, backupRoot: string): Promise<void>
  }
  backupRoot: string
}

/** Install with a custom adapter: install steps, then verify, rolling back on failure. */
export async function runCustomInstall(options: CustomInstallOptions, ctx: AdapterContext): Promise<StepRecord[]> {
  const steps = options.adapter.install ?? []
  if (steps.length === 0) throw new Error(`custom adapter ${options.adapter.id} declares no install steps`)
  const records = await options.executor.run(steps, ctx, options.backupRoot)
  try {
    if ((options.adapter.verify?.length ?? 0) > 0) {
      await options.executor.run(options.adapter.verify!, ctx, options.backupRoot)
    }
    return records
  } catch (error) {
    await options.executor.rollback(records, ctx, options.backupRoot)
    throw error
  }
}

/**
 * Expand adapter placeholders (`${DSH_HOME}`, `${DSH_PROFILE}`,
 * `${DSH_WORKDIR}`, `${DSH_WORKSPACE}`, `${DSH_PLUGIN_ENV}`) in string fields
 * and `env` values. Unknown `${NAME}` placeholders are left untouched so
 * shell-owned variables keep working.
 */
export function expandStepVariables(spec: StepSpec, vars: AdapterVariables): StepSpec {
  const expand = (value: string): string => value.replace(/\$\{([A-Z0-9_]+)\}/g, (token, name: string) => {
    const field = ADAPTER_VARIABLES[name]
    if (field === undefined) return token
    const replacement = vars[field]
    if (replacement === undefined) throw new Error(`adapter placeholder ${token} is not available`)
    return replacement
  })
  const resolved = { ...spec }
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === 'string') resolved[key] = expand(value)
  }
  const env = resolved.env
  if (env !== null && typeof env === 'object' && !Array.isArray(env)) {
    for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
      if (typeof value === 'string') (env as Record<string, unknown>)[key] = expand(value)
    }
  }
  return resolved
}

/**
 * Anchor relative filesystem references to the adapter directory, so an
 * adapter can live in git and still address its bundled files portably.
 * Placeholders are expanded first, so `${DSH_HOME}`-style absolute paths pass
 * through untouched.
 */
export function resolveStepPaths(spec: StepSpec, baseDir: string, vars: AdapterVariables = {}): StepSpec {
  const resolved = expandStepVariables(spec, vars)
  for (const field of ['from', 'to', 'backup', 'path'] as const) {
    const value = resolved[field]
    if (typeof value === 'string' && !isAbsolute(value) && value !== '') resolved[field] = resolve(baseDir, value)
  }
  if (typeof resolved.cwd === 'string' && !isAbsolute(resolved.cwd)) resolved.cwd = resolve(baseDir, resolved.cwd)
  return resolved
}

/** The scaffold an AI or human fills in for a plugin the built-in adapter cannot cover. */
export function scaffoldCustomAdapter(dir: string, id: string, reason: string): CustomAdapter {
  const adapter: CustomAdapter = {
    id,
    install: [
      { uses: 'file.copy', from: `\${DSH_WORKDIR}/source/README.md`, to: `\${DSH_PLUGIN_ENV}/README.md` },
      { uses: 'command', run: `# TODO: installer command`, unrun: `# TODO: uninstaller command` },
    ],
    verify: [{ uses: 'check', run: `# TODO: verify the plugin is installed (exit 0 = ok)` }],
    uninstall: [],
  }
  const path = join(dir, ADAPTER_FILENAME)
  writeFileSync(path, `# Custom adapter for "${id}".\n# Generated scaffold — fill in the steps; every step keeps its inverse.\n#\n# probe verdict: ${reason}\n# See docs/adapter-spec.md for the step vocabulary.\n\n${YAML.stringify(adapter)}\n`)
  return adapter
}
