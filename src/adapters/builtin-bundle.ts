/**
 * Built-in adapter for standard DSH bundle plugins (packages declaring
 * `dsh.bundle.patch`). The plugin source is materialized into its own
 * workspace `.venv` (the python-virtualenv analogue for plugins), dependencies
 * are installed inside that isolated layer, and the profile links the package
 * in through `link:<.venv>`. This is the adapter every dsh-visualize-shaped
 * plugin gets for free; anything else goes through the custom adapter.
 * @module @dsh-ext/dsh-package-manager/adapters/builtin-bundle
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

export interface BuiltinInstallOptions {
  source: string
  sourceKind: SourceKind
  ref: string
  allowBuild: boolean
  packageName: string
  /** Absolute isolated dependency layer (`<workspace>/.venv`). */
  pluginEnvDir: string
  /** Materialized source root (`<workDir>/source`) for git/file specs. */
  workDir: string
  executor: {
    run(specs: readonly StepSpec[], ctx: AdapterContext, backupRoot: string): Promise<StepRecord[]>
  }
}

/**
 * Install plan for a bundle plugin. The allowBuild whitelist entry is added
 * BEFORE pnpm runs so git-hosted plugins may run their prepare scripts, and
 * its inverse restores the previous list on uninstall.
 * @param options - resolved install inputs.
 * @returns the step list to execute.
 */
export function builtinInstallSteps(options: BuiltinInstallOptions): StepSpec[] {
  const specs: StepSpec[] = []
  const allowBuild = options.allowBuild && (isGitSpec(options.source) || options.sourceKind === 'npm')

  if (options.sourceKind === 'npm') {
    // npm: the `.venv` is a tiny linker project whose node_modules holds the
    // real package. Profile then links the package root itself.
    specs.push({ uses: 'pluginEnv.create', path: options.pluginEnvDir })
    specs.push({
      uses: 'file.write',
      path: join(options.pluginEnvDir, 'package.json'),
      content: JSON.stringify({
        name: `@dsh-pm/plugin-env-${safeName(options.packageName)}`,
        private: true,
        version: '0.0.0',
        type: 'module',
      }, undefined, 2) + '\n',
    })
    if (allowBuild) {
      specs.push({ uses: 'pluginEnv.allowBuild.add', dir: options.pluginEnvDir, package: options.packageName })
    }
    specs.push({ uses: 'pnpm', args: ['add', options.source], cwd: options.pluginEnvDir, unargs: [] })
    specs.push({
      uses: 'profile.dependency.add',
      spec: `link:${join(options.pluginEnvDir, 'node_modules', options.packageName)}`,
      packageName: options.packageName,
    })
  } else {
    // git/file: the `.venv` IS the package root (copy of the materialized
    // snapshot), so its dependencies install beside the plugin instead of
    // touching the profile.
    specs.push({ uses: 'file.copy', from: join(options.workDir, 'source'), to: options.pluginEnvDir })
    if (allowBuild) {
      specs.push({ uses: 'pluginEnv.allowBuild.add', dir: options.pluginEnvDir, package: options.packageName })
    }
    specs.push({ uses: 'pnpm', args: ['install'], cwd: options.pluginEnvDir, unargs: [] })
    specs.push({ uses: 'profile.dependency.add', spec: `link:${options.pluginEnvDir}`, packageName: options.packageName })
  }

  specs.push({ uses: 'profile.bundles.reconcile' })
  return specs
}

function safeName(packageName: string): string {
  const safe = packageName.replaceAll(/[^A-Za-z0-9._-]/g, '-').replaceAll(/^-+|-+$/g, '')
  return safe.length > 0 ? safe : 'plugin'
}
