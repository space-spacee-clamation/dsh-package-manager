/**
 * Step executor: the package manager's runtime realization of revertible
 * effects. Every install action is a step whose execution returns an explicit
 * inverse; installed entries persist both, and uninstall (or a failed install)
 * replays inverses LIFO. The built-in step kinds cover the exact profile files
 * `dsh plugin` owns; custom adapters authored by humans or an AI use the same
 * declarative vocabulary, so arbitrary plugins get a wrapped installer and
 * uninstaller without touching this code.
 * @module @dsh-ext/dsh-package-manager/steps
 */

import { spawnSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import {
  readAllowBuilds, readManifest, readWorkspace, reconcileBundles, writeAllowBuilds, writeManifest,
} from './profile.ts'
import type { AdapterContext, SpawnResult, StepRecord, StepSpec } from './types.ts'

/** pnpm invocation seam: tests substitute a fake, production shells out. */
export type PnpmRunner = (args: string[], cwd: string, env: Record<string, string>) => SpawnResult

export type CommandRunner = (command: string, cwd: string, env: Record<string, string>) => SpawnResult

export function defaultPnpmRunner(): PnpmRunner {
  return (args, cwd, env) => spawnResult('pnpm', args, cwd, env)
}

export function defaultCommandRunner(): CommandRunner {
  return (command, cwd, env) => {
    const result = spawnSync(command, {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      shell: process.platform === 'win32' ? true : command.includes(' '),
      windowsHide: true,
    })
    const status = result.status ?? 1
    const error = result.error
    if (error !== undefined) throw new Error(`command failed to start: ${String(error.message ?? error)}`)
    return { exitCode: status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
  }
}

function spawnResult(command: string, args: string[], cwd: string, env: Record<string, string>): SpawnResult {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
  })
  const status = result.status ?? 1
  const error = result.error
  if (error !== undefined) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error(`${command} not found on PATH`)
    throw new Error(`${command} failed to start: ${String(error.message ?? error)}`)
  }
  return { exitCode: status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
}

/** All step kinds the declarative adapter DSL accepts. */
export const STEP_KINDS = new Set([
  'noop',
  'profile.dependency.add',
  'profile.dependency.remove',
  'profile.bundles.add',
  'profile.bundles.remove',
  'profile.bundles.reconcile',
  'profile.bundles.set',
  'profile.allowBuild.add',
  'profile.allowBuild.set',
  'pluginEnv.create',
  'pluginEnv.remove',
  'pluginEnv.restore',
  'pluginEnv.allowBuild.add',
  'pnpm',
  'file.copy',
  'file.write',
  'file.remove',
  'file.restore',
  'command',
  'check',
])

const STRING_FIELDS: Record<string, string[]> = {
  'profile.dependency.add': ['spec'],
  'profile.dependency.remove': ['packageName'],
  'profile.bundles.add': ['package'],
  'profile.bundles.remove': ['package'],
  'profile.allowBuild.add': ['package'],
  'pluginEnv.create': ['path'],
  'pluginEnv.remove': ['path'],
  'pluginEnv.restore': ['backup', 'to'],
  'pluginEnv.allowBuild.add': ['dir', 'package'],
  'file.copy': ['from', 'to'],
  'file.write': ['path', 'content'],
  'file.remove': ['path'],
  'file.restore': ['backup', 'to'],
  'command': ['run', 'unrun'],
  'check': ['run'],
}

/** Validate one declarative step before it ever touches the filesystem. */
export function validateStepSpec(spec: StepSpec, where: string): void {
  if (typeof spec.uses !== 'string' || !STEP_KINDS.has(spec.uses)) {
    throw new Error(`${where}: unsupported step kind ${JSON.stringify(spec.uses)}`)
  }
  if (spec.uses === 'profile.allowBuild.set' || spec.uses === 'profile.bundles.set') {
    const packages = spec.uses === 'profile.allowBuild.set' ? spec.packages : spec.bundles
    if (!Array.isArray(packages) || packages.some(packageName => typeof packageName !== 'string')) {
      throw new Error(`${where}: ${spec.uses} needs a string array (${spec.uses === 'profile.allowBuild.set' ? 'packages' : 'bundles'})`)
    }
    return
  }
  if (spec.uses === 'pnpm') {
    if (!Array.isArray(spec.args) || spec.args.some(arg => typeof arg !== 'string')) {
      throw new Error(`${where}: pnpm needs a string array field "args"`)
    }
    if (typeof spec.cwd !== 'string' || spec.cwd === '') throw new Error(`${where}: pnpm needs string field "cwd"`)
    if (spec.unargs !== undefined && (!Array.isArray(spec.unargs) || spec.unargs.some(arg => typeof arg !== 'string'))) {
      throw new Error(`${where}: pnpm.unargs must be a string array`)
    }
    return
  }
  for (const field of STRING_FIELDS[spec.uses] ?? []) {
    if (typeof spec[field] !== 'string') throw new Error(`${where}: ${spec.uses} needs string field ${JSON.stringify(field)}`)
  }
  if (spec.uses === 'command' || spec.uses === 'check') {
    const env = spec.env
    if (env !== undefined && (env === null || typeof env !== 'object' || Array.isArray(env))) {
      throw new Error(`${where}: ${spec.uses}.env must be a mapping of string values`)
    }
  }
}

/**
 * Execute a list of steps inside one install. Steps run in order; each
 * executed step becomes a {@link StepRecord} carrying its inverse. Callers
 * persist the records in the ledger and call {@link rollback} when any step
 * throws — including after a partial install — to restore the previous state.
 */
export class StepExecutor {
  constructor(
    private readonly pnpm: PnpmRunner = defaultPnpmRunner(),
    private readonly command: CommandRunner = defaultCommandRunner(),
  ) {}

  async run(specs: readonly StepSpec[], ctx: AdapterContext, backupRoot: string): Promise<StepRecord[]> {
    const records: StepRecord[] = []
    mkdirSync(backupRoot, { recursive: true })
    for (let index = 0; index < specs.length; index++) {
      const spec = specs[index]
      if (spec === undefined) continue
      const record = await this.execute(spec, ctx, join(backupRoot, String(index)))
      records.push(record)
    }
    return records
  }

  /** Replay recorded inverses LIFO; every failure is reported, none stops the sweep. */
  async rollback(records: readonly StepRecord[], ctx: AdapterContext, backupRoot: string): Promise<void> {
    const failures: string[] = []
    for (let index = records.length - 1; index >= 0; index--) {
      const record = records[index]
      if (record === undefined) continue
      try {
        await this.execute(record.inverse, ctx, join(backupRoot, String(index)))
        ctx.log('info', `rolled back: ${record.label}`)
      } catch (error) {
        failures.push(`${record.label}: ${messageOf(error)}`)
        ctx.log('error', `rollback failed: ${record.label}: ${messageOf(error)}`)
      }
    }
    if (failures.length > 0) {
      throw new Error(`rollback incomplete: ${failures.join('; ')}`)
    }
  }

  private async execute(spec: StepSpec, ctx: AdapterContext, backupDir: string): Promise<StepRecord> {
    const base = { kind: spec.uses }
    switch (spec.uses) {
      case 'noop':
        return { ...base, label: 'no-op', params: {}, inverse: { uses: 'noop' } }

      case 'profile.dependency.add': {
        const specText = String(spec.spec)
        const before = readManifest(ctx.profileDir).dependencies ?? {}
        this.runPnpm(['add', specText], ctx.profileDir, ctx)
        const after = readManifest(ctx.profileDir).dependencies ?? {}
        const packageName = addedDependency(before, after)
        if (packageName === undefined) throw new Error(`pnpm add ${JSON.stringify(specText)} reported success but wrote no dependency`)
        const label = `pnpm add ${specText} (${packageName})`
        return { ...base, label, params: { spec: specText, packageName }, inverse: { uses: 'profile.dependency.remove', packageName } }
      }

      case 'profile.dependency.remove': {
        const packageName = String(spec.packageName)
        const before = readManifest(ctx.profileDir).dependencies ?? {}
        const previousSpec = before[packageName]
        this.runPnpm(['remove', packageName], ctx.profileDir, ctx)
        const label = `pnpm remove ${packageName}`
        return {
          ...base,
          label,
          params: { packageName },
          inverse: previousSpec === undefined
            ? { uses: 'noop' }
            : { uses: 'profile.dependency.add', spec: previousSpec, packageName },
        }
      }

      case 'profile.bundles.add': {
        const packageName = String(spec.package)
        const manifest = readManifest(ctx.profileDir)
        const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
        if (!bundles.includes(packageName)) {
          bundles.push(packageName)
          manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
          writeManifest(ctx.profileDir, manifest)
        }
        return {
          ...base,
          label: `bundles += ${packageName}`,
          params: { package: packageName },
          inverse: { uses: 'profile.bundles.remove', package: packageName },
        }
      }

      case 'profile.bundles.remove': {
        const packageName = String(spec.package)
        const manifest = readManifest(ctx.profileDir)
        const bundles = [...(manifest.dsh?.profile?.bundles ?? [])]
        const index = bundles.indexOf(packageName)
        if (index >= 0) {
          bundles.splice(index, 1)
          manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
          writeManifest(ctx.profileDir, manifest)
        }
        return {
          ...base,
          label: `bundles -= ${packageName}`,
          params: { package: packageName },
          inverse: { uses: 'profile.bundles.add', package: packageName },
        }
      }

      case 'profile.bundles.reconcile': {
        const before = [...(readManifest(ctx.profileDir).dsh?.profile?.bundles ?? [])]
        const result = reconcileBundles(ctx.profileDir)
        return {
          ...base,
          label: result.changed ? `bundles reconciled (+${result.added.join(',')})` : 'bundles reconciled (no change)',
          params: { added: result.added },
          inverse: { uses: 'profile.bundles.set', bundles: before },
        }
      }

      case 'profile.bundles.set': {
        const bundles = (spec.bundles as string[]).map(packageName => String(packageName))
        const before = [...(readManifest(ctx.profileDir).dsh?.profile?.bundles ?? [])]
        const manifest = readManifest(ctx.profileDir)
        manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
        writeManifest(ctx.profileDir, manifest)
        return {
          ...base,
          label: `bundles = [${bundles.join(', ')}]`,
          params: { bundles, before },
          inverse: { uses: 'profile.bundles.set', bundles: before },
        }
      }

      case 'profile.allowBuild.add': {
        const packageName = String(spec.package)
        const before = readAllowBuilds(ctx.profileDir)
        if (!before.includes(packageName)) writeAllowBuilds(ctx.profileDir, [...before, packageName])
        return {
          ...base,
          label: `allowBuilds += ${packageName}`,
          params: { package: packageName, before },
          inverse: { uses: 'profile.allowBuild.set', packages: before },
        }
      }

      case 'profile.allowBuild.set': {
        const packages = (spec.packages as string[]).map(packageName => String(packageName))
        const dir = typeof spec.dir === 'string' && spec.dir !== '' ? spec.dir : ctx.profileDir
        const before = readAllowBuilds(dir)
        writeAllowBuilds(dir, packages)
        return {
          ...base,
          label: `allowBuilds = [${packages.join(', ')}]`,
          params: { packages, before, dir },
          inverse: { uses: 'profile.allowBuild.set', packages: before, dir },
        }
      }

      case 'pluginEnv.create': {
        const path = String(spec.path)
        mkdirSync(path, { recursive: true })
        return {
          ...base,
          label: `create plugin env ${path}`,
          params: { path },
          inverse: { uses: 'pluginEnv.remove', path },
        }
      }

      case 'pluginEnv.remove': {
        const path = String(spec.path)
        if (!existsSync(path)) return { ...base, label: `remove plugin env ${path} (absent)`, params: { path }, inverse: { uses: 'noop' } }
        mkdirSync(backupDir, { recursive: true })
        const backup = join(backupDir, 'target')
        renameSync(path, backup)
        return {
          ...base,
          label: `remove plugin env ${path}`,
          params: { path, backup },
          inverse: { uses: 'pluginEnv.restore', backup, to: path },
        }
      }

      case 'pluginEnv.restore': {
        const backup = String(spec.backup)
        const to = String(spec.to)
        if (!existsSync(backup)) throw new Error(`pluginEnv.restore backup is missing: ${backup}`)
        mkdirSync(dirname(to), { recursive: true })
        rmSync(to, { recursive: true, force: true })
        renameSync(backup, to)
        return {
          ...base,
          label: `restore plugin env ${to}`,
          params: { backup, to },
          inverse: { uses: 'pluginEnv.remove', path: to },
        }
      }

      case 'pluginEnv.allowBuild.add': {
        const dir = String(spec.dir)
        const packageName = String(spec.package)
        const before = readAllowBuilds(dir)
        if (!before.includes(packageName)) writeAllowBuilds(dir, [...before, packageName])
        return {
          ...base,
          label: `plugin env allowBuilds += ${packageName}`,
          params: { dir, package: packageName, before },
          inverse: { uses: 'profile.allowBuild.set', packages: before, dir },
        }
      }

      case 'pnpm': {
        const args = (spec.args as string[]).map(arg => String(arg))
        const cwd = String(spec.cwd)
        const unargs = (spec.unargs as string[] | undefined)?.map(arg => String(arg)) ?? []
        if (args.length > 0) this.runPnpm(args, cwd, ctx)
        return {
          ...base,
          label: `pnpm ${args.join(' ')} (${cwd})`,
          params: { args, cwd, unargs },
          inverse: unargs.length === 0
            ? { uses: 'noop' }
            : { uses: 'pnpm', args: unargs, cwd },
        }
      }

      case 'file.copy': {
        const from = String(spec.from)
        const to = String(spec.to)
        if (!existsSync(from)) throw new Error(`file.copy source does not exist: ${from}`)
        mkdirSync(dirname(to), { recursive: true })
        const existed = existsSync(to)
        const backup = join(backupDir, 'target')
        if (existed) {
          mkdirSync(backupDir, { recursive: true })
          renameSync(to, backup)
        }
        const directory = statSync(from).isDirectory()
        if (directory) {
          // Recursive copy: the isolated `.venv` install moves a whole source
          // tree in one step. `.git` is deliberately not copied — the ledger
          // already records the resolved commit.
          cpSync(from, to, {
            recursive: true,
            force: true,
            filter: candidate => basename(candidate) !== '.git' && basename(candidate) !== 'node_modules',
          })
        } else {
          cpSync(from, to)
        }
        return {
          ...base,
          label: `copy ${directory ? 'tree' : 'file'} ${from} -> ${to}`,
          params: { from, to, existed, directory },
          inverse: existed
            ? { uses: 'file.restore', backup, to }
            : { uses: 'file.remove', path: to },
        }
      }

      case 'file.write': {
        const path = String(spec.path)
        const content = String(spec.content)
        mkdirSync(dirname(path), { recursive: true })
        const existed = existsSync(path)
        const backup = join(backupDir, 'target')
        if (existed) {
          mkdirSync(backupDir, { recursive: true })
          renameSync(path, backup)
        }
        writeFileSync(path, content)
        return {
          ...base,
          label: `write ${path}`,
          params: { path, existed },
          inverse: existed
            ? { uses: 'file.restore', backup, to: path }
            : { uses: 'file.remove', path },
        }
      }

      case 'file.remove': {
        const path = String(spec.path)
        if (!existsSync(path)) return { ...base, label: `remove ${path} (absent)`, params: { path }, inverse: { uses: 'noop' } }
        mkdirSync(backupDir, { recursive: true })
        const backup = join(backupDir, 'target')
        renameSync(path, backup)
        return {
          ...base,
          label: `remove ${path}`,
          params: { path },
          inverse: { uses: 'file.restore', backup, to: path },
        }
      }

      case 'file.restore': {
        const backup = String(spec.backup)
        const to = String(spec.to)
        if (!existsSync(backup)) throw new Error(`file.restore backup is missing: ${backup}`)
        mkdirSync(dirname(to), { recursive: true })
        rmSync(to, { recursive: true, force: true })
        renameSync(backup, to)
        return {
          ...base,
          label: `restore ${to}`,
          params: { backup, to },
          inverse: { uses: 'noop' },
        }
      }

      case 'command': {
        const run = String(spec.run)
        const unrun = String(spec.unrun)
        const cwd = typeof spec.cwd === 'string' ? spec.cwd : ctx.profileDir
        const env = envOf(spec)
        this.runCommand(run, cwd, env)
        return {
          ...base,
          label: `command: ${run}`,
          params: { run, unrun, cwd, env },
          inverse: { uses: 'command', run: unrun, unrun: run, cwd, env },
        }
      }

      case 'check': {
        const run = String(spec.run)
        const cwd = typeof spec.cwd === 'string' ? spec.cwd : ctx.profileDir
        const env = envOf(spec)
        this.runCommand(run, cwd, env)
        return { ...base, label: `check: ${run}`, params: { run, cwd, env }, inverse: { uses: 'noop' } }
      }

      default:
        throw new Error(`unsupported step kind ${JSON.stringify(spec.uses)}`)
    }
  }

  private runPnpm(args: string[], cwd: string, ctx: AdapterContext): void {
    const result = this.pnpm(args, cwd, { PM_PROFILE: ctx.profileDir, PM_HOME: ctx.home })
    if (result.exitCode !== 0) {
      throw new Error(`pnpm ${args.join(' ')} failed (exit ${result.exitCode}): ${tail(result.stderr || result.stdout)}`)
    }
    ctx.log('info', `pnpm ${args.join(' ')} (${cwd})`)
  }

  private runCommand(run: string, cwd: string, env: Record<string, string>): void {
    const result = this.command(run, cwd, env)
    if (result.exitCode !== 0) {
      throw new Error(`command failed (exit ${result.exitCode}): ${run}\n${tail(result.stderr || result.stdout)}`)
    }
  }
}

/** Find the dependency key a pnpm add created or changed. */
export function addedDependency(
  before: Record<string, string>,
  after: Record<string, string>,
): string | undefined {
  for (const [key, value] of Object.entries(after)) {
    if (before[key] !== value) return key
  }
  return undefined
}

function envOf(spec: StepSpec): Record<string, string> {
  const raw = spec.env
  if (raw === undefined) return {}
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') throw new Error(`step env.${key} must be a string`)
    env[key] = value
  }
  return env
}

function tail(text: string): string {
  const lines = text.trim().split(/\r?\n/)
  return lines.slice(-12).join('\n')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
