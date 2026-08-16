/**
 * Built-in adapter for standard DSH bundle plugins (packages declaring
 * `dsh.bundle.patch`): pnpm add/remove in the profile plus bundle-list
 * reconciliation. This is the adapter every dsh-visualize-shaped plugin gets
 * for free; anything else goes through the custom adapter.
 * @module @dsh-ext/dsh-package-manager/adapters/builtin-bundle
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AdapterContext, ProbeResult, StepRecord, StepSpec } from '../types.ts'

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
  ref: string
  allowBuild: boolean
  packageName: string
  executor: {
    run(specs: readonly StepSpec[], ctx: AdapterContext, backupRoot: string): Promise<StepRecord[]>
  }
}

/**
 * Install plan for a bundle plugin. The allowBuild whitelist entry is added
 * BEFORE pnpm add so git-hosted plugins may run their prepare scripts, and its
 * inverse restores the previous list on uninstall.
 * @param options - resolved install inputs.
 * @param ctx - adapter context.
 * @returns the step list to execute.
 */
export function builtinInstallSteps(options: BuiltinInstallOptions, ctx: AdapterContext): StepSpec[] {
  const specs: StepSpec[] = []
  if (options.allowBuild && isGitSpec(options.source)) {
    specs.push({ uses: 'profile.allowBuild.add', package: options.packageName })
  }
  specs.push({ uses: 'profile.dependency.add', spec: options.source, packageName: options.packageName })
  specs.push({ uses: 'profile.bundles.reconcile' })
  return specs
}
