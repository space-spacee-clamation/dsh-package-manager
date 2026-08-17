/**
 * Built-in adapter for standard DSH bundle plugins (packages declaring
 * `dsh.bundle.patch`).
 *
 * The fast path follows the harness's own `dsh plugin` policy: install the
 * source as one ordinary profile dependency (one pnpm run), then reconcile
 * `dsh.profile.bundles`. Hot-plugging mounts the *bundle patch rows* through
 * `ctx.loader` afterwards (`src/cordisRuntime.ts`); no `.venv` copy or second
 * dependency install is needed for dsh-bundle plugins.
 * @module @dsh-ext/dsh-package-manager/adapters/builtinBundle
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBundlePatch } from '../bundlePatch.ts'
import type { AdapterContext, ProbeResult, SourceKind, StepRecord, StepSpec } from '../types.ts'

export const ADAPTER_KIND = 'dsh-bundle' as const

/** Probe a materialized package root for the standard bundle declaration. */
export function probeBundleDir(dir: string): ProbeResult {
  const manifestPath = join(dir, 'package.json')
  if (!existsSync(manifestPath)) return { adapter: 'custom', reason: 'no package.json at the source root' }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    name?: string
    dsh?: { bundle?: { patch?: string } }
  }
  if (manifest.dsh?.bundle?.patch === undefined) {
    return { adapter: 'custom', reason: `package ${manifest.name ?? '(unnamed)'} declares no dsh.bundle.patch — needs a custom adapter` }
  }
  return {
    adapter: ADAPTER_KIND,
    reason: 'declares dsh.bundle.patch',
    ...(manifest.name === undefined ? {} : { packageName: manifest.name }),
  }
}

/** Git-hosted specs whose install runs package build scripts through pnpm. */
export function isGitSpec(source: string): boolean {
  return /^github:|^git\+|^git:|^https?:\/\/(github\.com|gitlab\.|bitbucket\.org)/.test(source) || /\.git(?:#.*)?$/.test(source)
}

/**
 * Reject materialized bundle sources that cannot install into a standalone
 * profile BEFORE any profile edit happens. Harness monorepo sources use
 * `workspace:` dependencies that only resolve inside the monorepo, and a
 * malformed or missing patch file would otherwise fail after `pnpm add`
 * already mutated the profile.
 */
export function validateBundleSource(dir: string): string[] {
  const manifestPath = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    name?: string
    type?: string
    main?: string
    exports?: string | Record<string, string | { default?: string; import?: string; require?: string }>
    dependencies?: Record<string, string>
    dsh?: { bundle?: { patch?: string } }
  }
  const problems: string[] = []
  if (manifest.type !== undefined && manifest.type !== 'module') {
    problems.push(`package ${JSON.stringify(manifest.name ?? '(unnamed)')} declares type ${JSON.stringify(manifest.type)}; bundle patch rows are hot-mounted as ESM (expect type: module)`)
  }
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    if (spec.startsWith('workspace:')) {
      problems.push(`dependency ${JSON.stringify(name)} uses ${JSON.stringify(spec)}; workspace: protocol resolves only inside the harness monorepo — install a registry-published or self-contained build of this bundle instead`)
      break
    }
  }
  const declared = manifest.dsh?.bundle?.patch
  if (typeof declared === 'string' && declared !== '') {
    const patchPath = join(dir, declared)
    if (!existsSync(patchPath)) {
      problems.push(`declared bundle patch file does not exist: ${patchPath}`)
    } else {
      try {
        loadBundlePatch(dir)
      } catch (error) {
        problems.push(messageOf(error))
      }
    }
  }
  // A declared but unbuilt entry (main/exports pointing at a missing lib/)
  // means the source checkout was installed without its build step.
  const entryTarget = entryTargetOf(manifest)
  if (entryTarget !== undefined && !existsSync(join(dir, entryTarget))) {
    problems.push(`declared entrypoint does not exist: ${join(dir, entryTarget)} — build the package (its lib/ output) before installing`)
  }
  return problems
}

function entryTargetOf(manifest: {
  main?: string
  exports?: string | Record<string, string | { default?: string; import?: string; require?: string }>
}): string | undefined {
  const root = typeof manifest.exports === 'object' && manifest.exports !== null
    ? manifest.exports['.']
    : undefined
  const fromExports = typeof root === 'string' ? root : root?.default ?? root?.import
  return fromExports ?? manifest.main
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Client-face metadata of an installed bundle package. */
export interface ClientFaceInfo {
  /** True when the manifest declares a `dsh.client` entry. */
  declared: boolean
  /** True when `dsh.client.platform` is `'web'` (the only platform the host registry accepts). */
  platformOk: boolean
  /** Absolute path of the built client artifact, when declared. */
  artifactPath?: string
}

/**
 * Read the client-face declaration of a materialized bundle. The host's
 * client-modules registry serves `./client` (default `lib/client.js`) under
 * `/plugins/<id>/client.js` and requires `platform: 'web'`; an unbuilt source
 * package lacks that artifact.
 */
export function clientFaceOf(dir: string): ClientFaceInfo {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    dsh?: { client?: { platform?: unknown } & Record<string, unknown> }
    exports?: string | Record<string, string | { default?: string; import?: string; require?: string }>
  }
  const client = manifest.dsh?.client
  if (client === undefined) return { declared: false, platformOk: false }
  const target = typeof manifest.exports === 'object' && manifest.exports !== null
    ? manifest.exports['./client']
    : undefined
  const rel = typeof target === 'string' ? target : target?.default ?? target?.import
  return { declared: true, platformOk: client.platform === 'web', artifactPath: join(dir, rel ?? 'lib/client.js') }
}

export interface BuiltinInstallOptions {
  source: string
  sourceKind: SourceKind
  /** The spec handed to the profile dependency step (absolute for local dirs). */
  profileSpec: string
  ref: string
  allowBuild: boolean
  packageName: string
  /** Kept for request-shape compatibility; the fast path no longer uses it. */
  pluginEnvDir?: string
  /** Absolute materialized source root (`<workDir>/source`) for git/file specs. */
  workDir: string
  executor: {
    run(specs: readonly StepSpec[], ctx: AdapterContext, backupRoot: string): Promise<StepRecord[]>
  }
}

/**
 * Install plan for a dsh-bundle plugin: allow-build (when requested), one
 * profile dependency add through `dsh plugin`/pnpm, then bundle reconcile.
 * Inverses are recorded by the step executor as usual, so uninstall remains a
 * single `dsh plugin remove` plus allowBuild restore.
 */
export function builtinInstallSteps(options: BuiltinInstallOptions): StepSpec[] {
  const specs: StepSpec[] = []
  const allowBuild = options.allowBuild && (isGitSpec(options.source) || options.sourceKind === 'npm')

  if (allowBuild && options.packageName !== '') {
    specs.push({ uses: 'profile.allowBuild.add', package: options.packageName })
  }
  specs.push({
    uses: 'profile.dependency.add',
    spec: options.profileSpec,
    ...(options.packageName === '' ? {} : { packageName: options.packageName }),
  })
  specs.push({
    uses: 'profile.bundles.reconcile',
    ...(options.packageName === '' ? {} : { packageName: options.packageName }),
  })
  return specs
}
