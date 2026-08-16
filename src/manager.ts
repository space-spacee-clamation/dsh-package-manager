/**
 * Package manager core: installs, uninstalls, restores, syncs, and scaffolds
 * adapters. Install steps are transactional — any failure replays the recorded
 * inverses LIFO — and every successful install persists its step records so
 * uninstall is the same replay, never a separately authored procedure.
 * @module @dsh-ext/dsh-package-manager/manager
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import YAML from 'yaml'
import { builtinInstallSteps, isGitSpec, probeBundleDir } from './adapters/builtin-bundle.ts'
import { loadCustomAdapter, runCustomInstall, scaffoldCustomAdapter } from './adapters/custom.ts'
import { getEntry, listEntries, loadLedger, removeEntry, saveLedger, setEntry } from './ledger.ts'
import { createHost, type PackageManagerHost } from './host.ts'
import { cacheRoot, defaultWorkspaceRoot, pmRoot, profileDir, resolveHome } from './paths.ts'
import { pluginEnvDir, pluginWorkspaceDir } from './pluginWorkspace.ts'
import { loadConfig, loadDisabled, removeDisabledEntry, saveConfig, saveDisabled, upsertDisabledEntry } from './config.ts'
import { ensureProfile, listProfiles, readManifest } from './profile.ts'
import { detectSourceKind, materializeSource, type GitRunner } from './source.ts'
import { parseRequirements, planRestore, resolveAdapterDir, fingerprint } from './spec.ts'
import { StepExecutor, type CommandRunner, type PnpmRunner } from './steps.ts'
import type {
  AdapterContext, AdapterInitRequest, AdapterInitResult, DisabledEntry, InstallRequest, InstallResult, Ledger,
  LedgerEntry, ManagerState, OperationLog, PackageManagerConfig, PackageManagerRuntime, PlanAction, RestoreRequest,
  RestoreResult, RuntimeMountResult, SpecEntry, StepRecord, SyncRequest, ToggleRequest, UninstallRequest, UninstallResult,
} from './types.ts'

export interface PackageManagerOptions {
  home?: string
  pnpm?: PnpmRunner
  command?: CommandRunner
  git?: GitRunner
  /** Process-host adapter for pnpm/git/shell; defaults to local or harness execution. */
  host?: PackageManagerHost
  /** In-process Cordis hot-plug seam; absent for the CLI and tests. */
  runtime?: PackageManagerRuntime
}

const RESTART_MARKER = 'restart-needed'
const DEPS_FILENAME = 'deps.yaml'

export class PackageManager {
  readonly home: string
  private readonly executor: StepExecutor
  private readonly git: GitRunner
  private readonly runtime: PackageManagerRuntime | undefined

  constructor(options: PackageManagerOptions = {}) {
    this.home = options.home ?? resolveHome()
    const host = options.host ?? createHost()
    this.executor = new StepExecutor(
      options.pnpm ?? ((args, cwd, env) => host.pnpm(args, cwd, env)),
      options.command ?? ((command, cwd, env) => host.shell(command, cwd, env)),
    )
    this.git = options.git ?? ((args, cwd) => host.git(args, cwd))
    this.runtime = options.runtime
  }

  /** Resolved root for per-plugin workspaces (config or default). */
  workspaceRoot(): string {
    const configured = this.getConfig().workspaceRoot.trim()
    if (configured === '') return defaultWorkspaceRoot(this.home)
    return isAbsolute(configured) ? resolve(configured) : resolve(this.home, configured)
  }

  /** `<workspaceRoot>/<profile>/<safe-id>` for one plugin install. */
  pluginWorkspaceDir(profile: string, id: string): string {
    return pluginWorkspaceDir(this.workspaceRoot(), profile, id)
  }

  /** Read-only view for the Web UI and CLI. */
  state(): ManagerState {
    const profiles = listProfiles(this.home).map(name => {
      const dir = profileDir(this.home, name)
      const manifest = readManifest(dir)
      return {
        name,
        dir,
        exists: true,
        bundles: [...(manifest.dsh?.profile?.bundles ?? [])],
        dependencies: Object.keys(manifest.dependencies ?? {}),
      }
    })
    return {
      home: this.home,
      workspaceRoot: this.workspaceRoot(),
      workspaceDefault: defaultWorkspaceRoot(this.home),
      restartNeeded: existsSync(this.restartMarker()),
      profiles,
      entries: listEntries(loadLedger(this.home)),
      disabled: loadDisabled(this.home),
      config: loadConfig(this.home),
    }
  }

  /** Remove the restart hint (the Web UI calls this once the user acknowledged it). */
  clearRestartMarker(): void {
    rmSync(this.restartMarker(), { force: true })
  }

  async install(request: InstallRequest): Promise<InstallResult> {
    const logs: OperationLog[] = []
    const log = (level: OperationLog['level'], message: string): void => { logs.push({ level, message }) }
    const profile = request.profile
    const id = request.id ?? idFromSource(request.source)
    const dir = profileDir(this.home, profile)
    ensureProfile(dir, profile)
    const source = request.source
    const ref = request.ref ?? ''
    const allowBuild = request.allowBuild ?? false

    const workspaceDir = this.pluginWorkspaceDir(profile, id)
    const envDir = pluginEnvDir(workspaceDir)

    if (request.dryRun === true) {
      log('info', `dry run: would install ${JSON.stringify(id)} into profile ${JSON.stringify(profile)} from ${JSON.stringify(source)}`)
      log('info', `dry run: plugin workspace ${workspaceDir}, isolated env ${envDir}`)
      log('info', `dry run: adapter ${request.adapter}, allowBuild ${String(allowBuild)}`)
      return {
        profile,
        id,
        adapter: request.adapter,
        packageName: '',
        pluginEnvDir: envDir,
        workspaceDir,
        hotMounted: false,
        steps: [],
        logs,
        dryRun: true,
      }
    }

    const ledger = loadLedger(this.home)
    if (getEntry(ledger, profile, id) !== undefined) {
      throw new Error(`plugin ${JSON.stringify(id)} is already installed in profile ${JSON.stringify(profile)} — uninstall it first, or change its spec via restore`)
    }

    const kind = detectSourceKind(source)
    const workDir = this.workDir(profile, id)
    const ctx: AdapterContext = {
      home: this.home,
      profileDir: dir,
      workDir,
      workspaceDir,
      pluginEnvDir: envDir,
      source,
      ref,
      log,
    }

    let records: StepRecord[] = []
    try {
      const materialized = kind === 'npm' ? undefined : await materializeSource(workDir, source, ref, this.git)
      const resolved = this.resolveAdapter(request.adapter, request.adapterDir ?? '', source, materialized?.dir ?? '')
      const packageName = resolved.packageName ?? (kind === 'npm' ? npmNameOf(source) : '')
      log('info', `adapter: ${resolved.kind}${resolved.reason === '' ? '' : ` (${resolved.reason})`}`)

      if (resolved.kind === 'dsh-bundle') {
        const steps = builtinInstallSteps({
          source,
          sourceKind: kind,
          ref,
          allowBuild,
          packageName,
          pluginEnvDir: envDir,
          workDir,
          executor: this.executor,
        })
        records = await this.executor.run(steps, ctx, join(workDir, 'backups'))
      } else {
        if (resolved.adapterDir === '') {
          throw new Error(`plugin ${JSON.stringify(id)} needs a custom adapter but none was provided — run adapter-init to scaffold one`)
        }
        const adapter = loadCustomAdapter(resolved.adapterDir, this.adapterVars(ctx))
        records = await runCustomInstall(
          { adapter, executor: this.executor, backupRoot: join(workDir, 'backups') },
          ctx,
        )
      }
      const entry: LedgerEntry = {
        id,
        profile,
        profileDir: dir,
        source,
        sourceKind: kind,
        ref,
        adapter: resolved.kind,
        adapterDir: resolved.adapterDir,
        packageName,
        materializedDir: materialized?.dir ?? '',
        resolvedCommit: materialized?.resolvedCommit ?? '',
        workDir,
        workspaceDir,
        pluginEnvDir: envDir,
        steps: records,
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        spec: { source, adapter: request.adapter, adapterDir: request.specAdapterDir ?? request.adapterDir ?? '', ref },
        allowBuild,
      }

      // Cordis hot-plug: a dsh-bundle package is already linked in the
      // profile's node_modules, so import + ctx.plugin() mounts it NOW.
      // Uninstall disposes the same fiber before replaying inverse steps.
      let runtime: RuntimeMountResult = { mounted: false, reason: 'no in-process runtime (CLI/tests)' }
      if (resolved.kind === 'dsh-bundle' && this.runtime !== undefined && packageName !== '') {
        runtime = await this.runtime.mount(entry)
        if (runtime.mounted) log('info', `hot-mounted ${packageName} through Cordis`)
        else log('warn', `live mount skipped: ${runtime.reason}`)
      }

      setEntry(ledger, entry)
      saveLedger(this.home, ledger)
      this.clearDisabled(profile, id)
      if (!runtime.mounted) this.touchRestart()
      log('info', `installed ${id} in profile ${profile} (${records.length} steps recorded)`)
      return {
        profile,
        id,
        adapter: resolved.kind,
        packageName,
        pluginEnvDir: envDir,
        workspaceDir,
        hotMounted: runtime.mounted,
        steps: records,
        logs,
        dryRun: false,
      }
    } catch (error) {
      const message = buildScriptHint(source, allowBuild, error)
      try {
        if (records.length > 0) await this.executor.rollback(records, ctx, join(workDir, 'backups'))
      } catch (rollbackError) {
        throw new Error(`${messageOf(error)}\n${messageOf(rollbackError)}`)
      }
      throw new Error(message)
    }
  }

  async uninstall(request: UninstallRequest): Promise<UninstallResult> {
    const logs: OperationLog[] = []
    const log = (level: OperationLog['level'], message: string): void => { logs.push({ level, message }) }
    const ledger = loadLedger(this.home)
    const entry = getEntry(ledger, request.profile, request.id)
    if (entry === undefined) {
      throw new Error(`plugin ${JSON.stringify(request.id)} is not installed in profile ${JSON.stringify(request.profile)}`)
    }
    if (request.dryRun === true) {
      log('info', `dry run: would uninstall ${entry.id} from profile ${entry.profile} (${entry.steps.length} inverse steps)`)
      return { profile: entry.profile, id: entry.id, hotUnmounted: false, steps: [], logs, dryRun: true }
    }
    const dir = profileDir(this.home, entry.profile)
    const workDir = entry.workDir !== undefined && entry.workDir !== '' && existsSync(entry.workDir)
      ? entry.workDir
      : entry.materializedDir === ''
        ? this.workDir(entry.profile, entry.id)
        : dirname(entry.materializedDir)
    const ctx: AdapterContext = {
      home: this.home,
      profileDir: dir,
      workDir,
      ...(entry.workspaceDir === undefined ? {} : { workspaceDir: entry.workspaceDir }),
      ...(entry.pluginEnvDir === undefined ? {} : { pluginEnvDir: entry.pluginEnvDir }),
      source: entry.source,
      ref: entry.ref,
      log,
    }

    // Time compositionality: dispose the live Cordis fiber BEFORE replaying the
    // inverse effects that remove its files. Failed hot-unmount keeps the
    // ledger untouched so uninstall can be retried.
    let runtime: RuntimeMountResult = { mounted: false, reason: 'no in-process runtime' }
    if (entry.adapter === 'dsh-bundle' && this.runtime !== undefined && entry.packageName !== '') {
      runtime = await this.runtime.unmount(entry)
      if (runtime.mounted) log('info', `hot-unmounted ${entry.packageName} through Cordis`)
      else log('warn', `live unmount skipped: ${runtime.reason}`)
    }

    try {
      await this.executor.rollback(entry.steps, ctx, join(workDir, 'backups'))
      if (entry.adapter === 'custom' && entry.adapterDir !== '') {
        const adapter = loadCustomAdapter(entry.adapterDir, this.adapterVars(ctx))
        const extra = adapter.uninstall ?? []
        if (extra.length > 0) {
          await this.executor.run(extra, ctx, join(workDir, 'extra-backups'))
          log('info', `custom adapter uninstall steps: ${extra.length}`)
        }
      }
    } catch (error) {
      throw new Error(`uninstall failed (ledger entry kept for retry): ${messageOf(error)}`)
    }
    removeEntry(ledger, entry.profile, entry.id)
    saveLedger(this.home, ledger)
    rmSync(workDir, { recursive: true, force: true })
    if (!runtime.mounted) this.touchRestart()
    log('info', `uninstalled ${entry.id} from profile ${entry.profile}`)
    return {
      profile: entry.profile,
      id: entry.id,
      hotUnmounted: runtime.mounted,
      steps: entry.steps,
      logs,
      dryRun: false,
    }
  }

  async restore(request: RestoreRequest): Promise<RestoreResult> {
    const logs: OperationLog[] = []
    const log = (level: OperationLog['level'], message: string): void => { logs.push({ level, message }) }
    const file = resolve(request.file)
    const spec = parseRequirements(readFileSync(file, 'utf8'), dirname(file))
    const ledger = loadLedger(this.home)
    const actions = planRestore(spec, ledger, request.modes ?? [])
    const installed: InstallResult[] = []
    const uninstalled: UninstallResult[] = []
    const updated: InstallResult[] = []

    for (const action of actions) {
      log('info', `${action.action}: ${action.profile}/${action.id} — ${action.reason}`)
      if (action.action === 'keep' || request.dryRun === true) continue
      try {
        if (action.action === 'uninstall' || action.action === 'update') {
          const result = await this.uninstall({ profile: action.profile, id: action.id })
          uninstalled.push(result)
          logs.push(...result.logs)
        }
        if (action.action === 'install' || action.action === 'update') {
          const entry = action.entry as SpecEntry
          const adapterDir = entry.adapter === 'custom' && entry.adapterDir !== ''
            ? resolveAdapterDir(spec, entry.adapterDir)
            : ''
          const result = await this.install({
            id: entry.id,
            profile: action.profile,
            source: entry.source,
            adapter: entry.adapter,
            adapterDir,
            specAdapterDir: entry.adapterDir,
            ref: entry.ref,
            allowBuild: entry.allowBuild,
          })
          installed.push(result)
          if (action.action === 'update') updated.push(result)
          logs.push(...result.logs)
        }
      } catch (error) {
        throw new Error(`restore failed at ${action.action} ${action.profile}/${action.id}: ${messageOf(error)}`)
      }
    }
    return { file, actions, installed, uninstalled, updated, logs, dryRun: request.dryRun === true }
  }

  async sync(request: SyncRequest): Promise<RestoreResult> {
    const repo = resolve(request.repo)
    if (!existsSync(join(repo, '.git'))) throw new Error(`sync repo is not a git checkout: ${repo}`)
    const pulled = await this.git(['pull', '--ff-only'], repo)
    if (pulled.exitCode !== 0) throw new Error(`git pull failed (exit ${pulled.exitCode}): ${pulled.stderr || pulled.stdout}`)
    const file = resolve(request.file ?? join(repo, 'requirements', DEPS_FILENAME))
    return this.restore({
      file,
      ...(request.modes === undefined ? {} : { modes: request.modes }),
      ...(request.dryRun === undefined ? {} : { dryRun: request.dryRun }),
    })
  }

  /** Persistent preferences: local requirements storage, remote URL, auto sync. */
  getConfig(): PackageManagerConfig {
    return loadConfig(this.home)
  }

  /** Validate and persist manager preferences. */
  setConfig(config: PackageManagerConfig): PackageManagerConfig {
    return saveConfig(this.home, config)
  }

  /** Clone/pull the configured requirements repo, then restore its default deps.yaml. */
  async syncConfigured(): Promise<RestoreResult> {
    const config = this.getConfig()
    const storage = config.storagePath.trim()
    if (storage === '') throw new Error('package-manager storage path is not configured')
    const repo = resolve(storage)
    if (config.remoteUrl !== '') {
      if (!existsSync(join(repo, '.git'))) {
        if (existsSync(repo) && readdirSync(repo).length > 0) {
          throw new Error(`package storage path is not empty and is not a git checkout: ${repo}`)
        }
        const parent = dirname(repo)
        mkdirSync(parent, { recursive: true })
        mkdirSync(repo, { recursive: true })
        const clone = await this.git(['clone', '--quiet', config.remoteUrl, repo], parent)
        if (clone.exitCode !== 0) throw new Error(`git clone failed (exit ${clone.exitCode}): ${clone.stderr || clone.stdout}`)
      } else {
        const remote = await this.git(['remote', 'get-url', 'origin'], repo)
        if (remote.exitCode !== 0) {
          const add = await this.git(['remote', 'add', 'origin', config.remoteUrl], repo)
          if (add.exitCode !== 0) throw new Error(`git remote add failed (exit ${add.exitCode}): ${add.stderr || add.stdout}`)
        } else if (remote.stdout.trim() !== config.remoteUrl) {
          const set = await this.git(['remote', 'set-url', 'origin', config.remoteUrl], repo)
          if (set.exitCode !== 0) throw new Error(`git remote set-url failed (exit ${set.exitCode}): ${set.stderr || set.stdout}`)
        }
      }
    }
    if (!existsSync(join(repo, '.git'))) throw new Error(`package storage path is not a git checkout: ${repo}`)
    const pulled = await this.git(['pull', '--ff-only'], repo)
    if (pulled.exitCode !== 0) throw new Error(`git pull failed (exit ${pulled.exitCode}): ${pulled.stderr || pulled.stdout}`)
    const file = join(repo, 'requirements', DEPS_FILENAME)
    if (!existsSync(file)) throw new Error(`requirements file not found: ${file}`)
    return this.restore({ file })
  }

  /** Switch a plugin off: remember its request, then uninstall it. */
  async disable(request: ToggleRequest): Promise<UninstallResult> {
    const { profile, id } = request
    const entry = getEntry(loadLedger(this.home), profile, id)
    if (entry === undefined) throw new Error(`plugin ${JSON.stringify(id)} is not installed in profile ${JSON.stringify(profile)}`)
    const disabled: DisabledEntry = {
      profile,
      id,
      source: entry.source,
      adapter: entry.adapter,
      adapterDir: entry.adapterDir,
      ref: entry.ref,
      allowBuild: entry.allowBuild ?? entry.steps.some(step => step.kind === 'profile.allowBuild.add'),
    }
    const alreadyDisabled = loadDisabled(this.home).some(item => item.profile === profile && item.id === id)
    upsertDisabledEntry(this.home, disabled)
    try {
      return await this.uninstall({ profile, id })
    } catch (error) {
      if (!alreadyDisabled) removeDisabledEntry(this.home, profile, id)
      throw error
    }
  }

  /** Switch a disabled plugin back on by replaying its remembered request. */
  async enable(request: ToggleRequest): Promise<InstallResult> {
    const disabled = loadDisabled(this.home).find(item => item.profile === request.profile && item.id === request.id)
    if (disabled === undefined) throw new Error(`plugin ${JSON.stringify(request.id)} is not disabled in profile ${JSON.stringify(request.profile)}`)
    return this.install({
      profile: disabled.profile,
      id: disabled.id,
      source: disabled.source,
      adapter: disabled.adapter,
      ...(disabled.adapterDir === '' ? {} : { adapterDir: disabled.adapterDir }),
      ...(disabled.ref === '' ? {} : { ref: disabled.ref }),
      allowBuild: disabled.allowBuild,
    })
  }

  /** Analyze a source and scaffold a requirements entry + adapter for it. */
  async adapterInit(request: AdapterInitRequest): Promise<AdapterInitResult> {
    const logs: OperationLog[] = []
    const log = (level: OperationLog['level'], message: string): void => { logs.push({ level, message }) }
    const outDir = resolve(request.outDir)
    mkdirSync(outDir, { recursive: true })
    const workDir = this.workDir('probe', request.id)
    const materialized = await materializeSource(workDir, request.source, request.ref ?? '', this.git)
    if (materialized.kind === 'npm') {
      log('info', `npm source ${request.source}: the dsh-bundle adapter will drive pnpm directly (no adapter file needed)`)
      this.writeDepsEntry(outDir, request, 'dsh-bundle', '')
      return { id: request.id, adapter: 'dsh-bundle', reason: 'npm dependency resolved through pnpm', outDir, depsUpdated: true, logs }
    }
    const probe = probeBundleDir(materialized.dir)
    let adapter = probe.adapter
    let adapterDir = ''
    if (probe.adapter === 'dsh-bundle') {
      log('info', `detected dsh-bundle plugin${probe.packageName === undefined ? '' : ` ${probe.packageName}`}: no custom adapter needed`)
    } else {
      adapterDir = join(outDir, 'requirements', 'adapters', request.id)
      mkdirSync(adapterDir, { recursive: true })
      scaffoldCustomAdapter(adapterDir, request.id, probe.reason)
      log('info', `scaffolded custom adapter at ${adapterDir} — fill in install/uninstall/verify steps, then re-run install`)
      adapter = 'custom'
    }
    this.writeDepsEntry(outDir, request, adapter, adapterDir === '' ? '' : `adapters/${request.id}`)
    return { id: request.id, adapter, reason: probe.reason, outDir, depsUpdated: true, logs }
  }

  private resolveAdapter(
    requested: InstallRequest['adapter'],
    adapterDir: string,
    source: string,
    materializedDir: string,
  ): { kind: 'dsh-bundle' | 'custom'; reason: string; packageName?: string; adapterDir: string } {
    if (requested === 'custom') {
      if (adapterDir === '' || !existsSync(adapterDir)) throw new Error(`custom adapter requested but adapterDir does not exist: ${adapterDir || '(empty)'}`)
      return { kind: 'custom', reason: 'requested', adapterDir }
    }
    if (requested === 'dsh-bundle' && materializedDir !== '') {
      const probe = probeBundleDir(materializedDir)
      if (probe.adapter !== 'dsh-bundle') {
        throw new Error(`adapter dsh-bundle requested but ${JSON.stringify(source)} declares no dsh.bundle.patch — use adapter auto or a custom adapter`)
      }
      return {
        kind: 'dsh-bundle',
        reason: probe.reason,
        adapterDir: '',
        ...(probe.packageName === undefined ? {} : { packageName: probe.packageName }),
      }
    }
    if (requested === 'dsh-bundle') return { kind: 'dsh-bundle', reason: 'requested', adapterDir: '' }
    if (materializedDir === '') return { kind: 'dsh-bundle', reason: 'npm dependency — bundle declaration reconciled after install', adapterDir: '' }
    const probe = probeBundleDir(materializedDir)
    if (probe.adapter === 'dsh-bundle') {
      return {
        kind: 'dsh-bundle',
        reason: probe.reason,
        adapterDir: '',
        ...(probe.packageName === undefined ? {} : { packageName: probe.packageName }),
      }
    }
    return { kind: 'custom', reason: probe.reason, adapterDir }
  }

  private writeDepsEntry(outDir: string, request: AdapterInitRequest, adapter: string, relativeAdapterDir: string): void {
    const depsPath = join(outDir, 'requirements', DEPS_FILENAME)
    mkdirSync(dirname(depsPath), { recursive: true })
    let doc: Record<string, unknown>
    if (existsSync(depsPath)) {
      const parsed = YAML.parse(readFileSync(depsPath, 'utf8')) as unknown
      doc = (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as Record<string, unknown> : {}
    } else {
      doc = { version: 1, repo: '.', modes: {} }
    }
    const modes = (doc.modes !== null && typeof doc.modes === 'object' && !Array.isArray(doc.modes))
      ? doc.modes as Record<string, unknown>
      : {}
    const entries = (modes[request.profile ?? 'web'] !== undefined && Array.isArray(modes[request.profile ?? 'web']))
      ? [...(modes[request.profile ?? 'web'] as Record<string, unknown>[])]
      : []
    const index = entries.findIndex(entry => entry !== null && typeof entry === 'object' && (entry as Record<string, unknown>).id === request.id)
    const entry: Record<string, unknown> = {
      id: request.id,
      source: request.source,
      adapter,
      allowBuild: false,
    }
    if (request.ref !== undefined && request.ref !== '') entry.ref = request.ref
    if (relativeAdapterDir !== '') entry.adapterDir = relativeAdapterDir
    if (index >= 0) entries[index] = entry
    else entries.push(entry)
    modes[request.profile ?? 'web'] = entries
    doc.modes = modes
    writeFileSync(depsPath, YAML.stringify(doc))
  }

  private clearDisabled(profile: string, id: string): void {
    removeDisabledEntry(this.home, profile, id)
  }

  private adapterVars(ctx: AdapterContext) {
    return {
      home: ctx.home,
      profileDir: ctx.profileDir,
      workDir: ctx.workDir,
      ...(ctx.workspaceDir === undefined ? {} : { workspaceDir: ctx.workspaceDir }),
      ...(ctx.pluginEnvDir === undefined ? {} : { pluginEnvDir: ctx.pluginEnvDir }),
    }
  }

  private workDir(profile: string, id: string): string {
    const safe = id.replaceAll(/[^A-Za-z0-9._-]/g, '-')
    return join(cacheRoot(this.home), 'work', `${profile}-${safe}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  }

  private restartMarker(): string {
    return join(pmRoot(this.home), RESTART_MARKER)
  }

  private touchRestart(): void {
    mkdirSync(pmRoot(this.home), { recursive: true })
    writeFileSync(this.restartMarker(), new Date().toISOString() + '\n')
  }
}

/** Create a manager bound to one harness home (CLI / tests seam). */
export function createPackageManager(options: PackageManagerOptions = {}): PackageManager {
  return new PackageManager(options)
}

export function idFromSource(source: string): string {
  const github = /^github:([^/#]+?)(?:#.*)?$/.exec(source)
  if (github !== null && github[1] !== undefined) return github[1].split('/').pop() ?? github[1]
  const clean = source.replace(/^git\+/, '').replace(/(?:\.git)?#.*$/, '').replace(/^.*[/:]/, '')
  return clean === '' || clean === '.' ? 'plugin' : clean
}

function npmNameOf(source: string): string {
  const stripped = source.replace(/^npm:/, '')
  if (stripped.startsWith('@')) {
    const parts = stripped.split('/')
    if (parts.length < 2) return stripped
    const scope = parts[0]
    const tail = (parts[1] ?? '').split('@')[0] ?? ''
    return tail === '' ? stripped : `${scope}/${tail}`
  }
  return stripped.split('@')[0] ?? stripped
}

function buildScriptHint(source: string, allowBuild: boolean, error: unknown): string {
  const message = messageOf(error)
  if (!allowBuild && isGitSpec(source) && /build script|ignored build|approve-builds|allowBuilds|build scripts/i.test(message)) {
    return `${message}\nhint: this git-hosted plugin runs build scripts. Re-run with allowBuild: true — the manager adds the exact package to the profile's pnpm allowBuilds list and records the inverse for uninstall.`
  }
  return message
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
