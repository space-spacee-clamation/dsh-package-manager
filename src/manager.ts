/**
 * Package manager core. There is exactly ONE install pipeline:
 *
 *   1. run one profile dependency install through the host's own
 *      `dsh plugin`/pnpm seam;
 *   2. write the bundle's patch rows into a marked block of the profile's
 *      `cordis.patch.yml`.
 *
 * Step 2 IS the hot-mount and hot-unmount surface. The DSH launcher already
 * watches `cordis.patch.yml` (`watchUserPatches`) and diffs the root Include
 * entry, so this manager never imports the Loader, never creates its own
 * Include subtrees, and never recomposes the profile itself. The previous
 * workspace/.venv channel and the injected profile composer are intentionally
 * gone.
 * @module @dsh-ext/dsh-package-manager/manager
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import YAML from 'yaml'
import { builtinInstallSteps, clientFaceOf, isGitSpec, probeBundleDir, validateBundleSource } from './adapters/builtinBundle.ts'
import { loadCustomAdapter, runCustomInstall, scaffoldCustomAdapter } from './adapters/custom.ts'
import { getEntry, isEntryEffective, listEntries, loadEffectiveLedger, loadLedger, removeEntry, saveLedger, setEntry } from './ledger.ts'
import { createHost, type PackageManagerHost } from './hostAsync.ts'
import { defaultWorkspaceRoot, packageStoreRoot, pmRoot, profileDir, resolveHome, workRoot } from './paths.ts'
import { syncGitMirror } from './packageStore.ts'
import { pluginEnvDir, pluginWorkspaceDir } from './pluginWorkspace.ts'
import { loadConfig, loadDisabled, removeDisabledEntry, saveConfig, upsertDisabledEntry } from './config.ts'
import { DEFAULT_PROFILE_BUNDLES, ensureProfile, healProfiles, listProfiles, PROFILE_TEMPLATES, readManifest } from './profile.ts'
import { detectSourceKind, materializeSource, parseGithubSpec, type GitRunner } from './source.ts'
import { clearWorkspaceHistory, forgetWorkspaceHistory, loadWorkspaceHistory, recordWorkspaceHistory } from './runtimeStore.ts'
import { parseRequirements, planRestore, planWorkspaceSwitch, resolveAdapterDir } from './spec.ts'
import { StepExecutor, type CommandRunner, type DshRunner, type PnpmRunner } from './steps.ts'
import {
  hasManagedPatch,
  managedPatchForPackage,
  patchRowIdsForEntry,
  removeManagedPatch,
  resolveBundlePackageDir,
  writeManagedPatch,
} from './profilePatch.ts'
import type {
  AdapterContext, AdapterInitRequest, AdapterInitResult, DisabledEntry, InstallRequest, InstallResult, Ledger,
  LedgerEntry, ManagerState, OperationLog, PackageManagerConfig, PlanAction, RestoreRequest, RequirementsSpec,
  RestoreResult, SpecEntry, StepRecord, SyncRequest, ToggleRequest, UninstallRequest, UninstallResult,
  UpdateCheckRequest, UpdateCheckResult,
} from './types.ts'

export interface PackageManagerOptions {
  home?: string
  pnpm?: PnpmRunner
  command?: CommandRunner
  /** Existing `dsh plugin` add/remove tool; defaults to the process-host adapter. */
  dsh?: DshRunner
  git?: GitRunner
  /** Process-host adapter for pnpm/git/dsh/shell; defaults to local or harness execution. */
  host?: PackageManagerHost
}

const RESTART_MARKER = 'restart-needed'
const WEB_REFRESH_MARKER = 'web-refresh-needed'
const DEPS_FILENAME = 'deps.yaml'

export class PackageManager {
  readonly home: string
  private readonly executor: StepExecutor
  private readonly git: GitRunner
  private reconciling = false
  /** Serializes profile/ledger mutations; the host runs pnpm without a lock, so install/uninstall/restore must never interleave. */
  private chain: Promise<unknown> = Promise.resolve()
  private switchError = ''

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const task = this.chain.then(run, run)
    this.chain = task.catch(() => {})
    return task
  }

  constructor(options: PackageManagerOptions = {}) {
    this.home = options.home ?? resolveHome()
    const host = options.host ?? createHost()
    this.executor = new StepExecutor(
      options.pnpm ?? ((args, cwd, env) => host.pnpm(args, cwd, env)),
      options.command ?? ((command, cwd, env) => host.shell(command, cwd, env)),
      options.dsh ?? ((args, cwd, env) => host.dsh(args, cwd, env)),
    )
    this.git = options.git ?? ((args, cwd) => host.git(args, cwd))
  }

  /** Resolved root for per-plugin workspaces (AI session cwd; not a dependency layer). */
  workspaceRoot(): string {
    const configured = this.getConfig().workspaceRoot.trim()
    if (configured === '') return defaultWorkspaceRoot(this.home)
    return isAbsolute(configured) ? resolve(configured) : resolve(this.home, configured)
  }

  workspaceDefault(): string {
    return defaultWorkspaceRoot(this.home)
  }

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
      workspaceHistory: loadWorkspaceHistory(this.home),
      reconciling: this.reconciling,
      switchError: this.switchError,
      restartNeeded: existsSync(this.restartMarker()),
      webRefreshNeeded: existsSync(this.webRefreshMarker()),
      profiles,
      entries: listEntries(loadEffectiveLedger(this.home)),
      localPlugins: [],
      disabled: loadDisabled(this.home),
      config: loadConfig(this.home),
    }
  }

  clearRestartMarker(): void {
    rmSync(this.restartMarker(), { force: true })
  }

  clearWebRefreshMarker(): void {
    rmSync(this.webRefreshMarker(), { force: true })
  }

  async install(request: InstallRequest): Promise<InstallResult> {
    return this.enqueue(() => this.installInner(request))
  }

  private async installInner(request: InstallRequest): Promise<InstallResult> {
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
    if (getEntry(loadEffectiveLedger(this.home), profile, id) !== undefined) {
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
    let patchWritten = false
    let managedBlock: { entries: Record<string, unknown>[]; rowIds: string[] } | undefined
    try {
      const materialized = kind === 'npm' ? undefined : await materializeSource(workDir, source, ref, this.git, packageStoreRoot(this.home))
      const resolved = this.resolveAdapter(request.adapter, request.adapterDir ?? '', source, materialized?.dir ?? '')
      let packageName = resolved.packageName ?? (kind === 'npm' ? npmNameOf(source) : '')
      log('info', `adapter: ${resolved.kind}${resolved.reason === '' ? '' : ` (${resolved.reason})`}`)

      if (resolved.kind === 'dsh-bundle') {
        const shippedBundles = PROFILE_TEMPLATES[profile] ?? DEFAULT_PROFILE_BUNDLES
        if (packageName !== '' && shippedBundles.includes(packageName)) {
          throw new Error(`bundle ${JSON.stringify(packageName)} is one of this profile's shipped base bundles and is owned by the host launcher, not the package manager`)
        }
        if (materialized !== undefined && materialized.dir !== '') {
          const problems = validateBundleSource(materialized.dir)
          if (problems.length > 0) {
            throw new Error(`bundle source rejected before any profile edit: ${problems.join('; ')}`)
          }
          managedBlock = managedPatchForPackage(materialized.dir, profile, id)
          if (managedBlock === undefined) {
            throw new Error(`bundle ${JSON.stringify(packageName || source)} declares no dsh.bundle.patch`)
          }
        }
        records = await this.executor.run(builtinInstallSteps({
          source,
          sourceKind: kind,
          ref,
          allowBuild,
          packageName,
          profileSpec: this.profileSpecFor(source, kind),
          removeBundleRow: true,
          executor: this.executor,
        }), ctx, join(workDir, 'backups'))
        const recordedPackage = records.find(record => record.kind === 'profile.dependency.add')?.params['packageName']
        if (typeof recordedPackage === 'string' && recordedPackage !== '') packageName = recordedPackage

        const entry: LedgerEntry = {
          id,
          profile,
          profileDir: dir,
          source,
          sourceKind: kind,
          ref,
          adapter: 'dsh-bundle',
          adapterDir: '',
          packageName,
          materializedDir: materialized?.dir ?? '',
          resolvedCommit: materialized?.resolvedCommit ?? '',
          workDir,
          workspaceDir,
          pluginEnvDir: envDir,
          steps: records,
          installedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          spec: { source, adapter: request.adapter, adapterDir: request.specAdapterDir ?? request.adapterDir ?? '', ref, allowBuild },
          allowBuild,
        }
        if (managedBlock === undefined) {
          const packageDir = resolveBundlePackageDir(entry)
          if (packageDir === undefined) {
            throw new Error(`cannot resolve installed bundle ${JSON.stringify(packageName)} from profile ${JSON.stringify(profile)}`)
          }
          managedBlock = managedPatchForPackage(packageDir, profile, id)
        }
        if (managedBlock === undefined) {
          throw new Error(`bundle ${JSON.stringify(packageName)} declares no dsh.bundle.patch`)
        }
        // Official hot-reload: the launcher's watchUserPatches observes this
        // write and diffs the root Include. No loader API is touched here.
        writeManagedPatch(dir, id, managedBlock.entries, false, managedBlock.rowIds)
        patchWritten = true
        log('info', `wrote hot-reload block for ${packageName} into ${join(dir, 'cordis.patch.yml')}; the official watchUserPatches diff hot-mounts it`)

        setEntry(ledger, entry)
        saveLedger(this.home, ledger)
        this.clearDisabled(profile, id)
        this.noteClientFace(entry, log)
        log('info', `installed ${id} in profile ${profile} (${records.length} steps recorded)`)
        return {
          profile,
          id,
          adapter: resolved.kind,
          packageName,
          pluginEnvDir: envDir,
          workspaceDir,
          hotMounted: true,
          steps: records,
          logs,
          dryRun: false,
        }
      }

      if (resolved.adapterDir === '') {
        throw new Error(`plugin ${JSON.stringify(id)} needs a custom adapter but none was provided — run adapter-init to scaffold one`)
      }
      const adapter = loadCustomAdapter(resolved.adapterDir, this.adapterVars(ctx))
      records = await runCustomInstall(
        { adapter, executor: this.executor, backupRoot: join(workDir, 'backups') },
        ctx,
      )
      const entry: LedgerEntry = {
        id,
        profile,
        profileDir: dir,
        source,
        sourceKind: kind,
        ref,
        adapter: 'custom',
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
        spec: { source, adapter: request.adapter, adapterDir: request.specAdapterDir ?? request.adapterDir ?? '', ref, allowBuild },
        allowBuild,
      }
      setEntry(ledger, entry)
      saveLedger(this.home, ledger)
      this.clearDisabled(profile, id)
      // Custom adapters may write profile files the boot loader reads; a
      // dsh-bundle install is hot via its patch block, a custom one is not.
      this.touchRestart()
      log('info', `installed ${id} in profile ${profile} through custom adapter (${records.length} steps recorded)`)
      return {
        profile,
        id,
        adapter: 'custom',
        packageName,
        pluginEnvDir: envDir,
        workspaceDir,
        hotMounted: false,
        steps: records,
        logs,
        dryRun: false,
      }
    } catch (error) {
      const message = buildScriptHint(source, allowBuild, error)
      try {
        if (patchWritten) removeManagedPatch(dir, id)
        if (records.length > 0) await this.executor.rollback(records, ctx, join(workDir, 'backups'))
      } catch (rollbackError) {
        throw new Error(`${messageOf(error)}\n${messageOf(rollbackError)}`)
      }
      throw new Error(message)
    }
  }

  async uninstall(request: UninstallRequest): Promise<UninstallResult> {
    return this.enqueue(() => this.uninstallInner(request))
  }

  private async uninstallInner(request: UninstallRequest): Promise<UninstallResult> {
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
    const dir = entry.profileDir ?? profileDir(this.home, entry.profile)
    if (!isEntryEffective(this.home, entry)) {
      // The host profile no longer carries this dependency (removed with
      // `dsh plugin remove` or by hand): drop the ledger record and remove any
      // hot-reload block it left behind so it cannot fail the next boot.
      const cleaned = entry.adapter === 'dsh-bundle' ? removeManagedPatch(dir, entry.id) : false
      // Old workspace-channel entries kept their files under the AI workspace;
      // the workspace pipeline is gone, so drop the stale dependency layer too.
      if (entry.pluginEnvDir !== undefined && entry.pluginEnvDir !== '' && existsSync(entry.pluginEnvDir)) {
        rmSync(entry.pluginEnvDir, { recursive: true, force: true })
        log('info', `removed stale plugin dependency layer ${entry.pluginEnvDir}`)
      }
      removeEntry(ledger, entry.profile, entry.id)
      saveLedger(this.home, ledger)
      log('info', cleaned
        ? `removed stale ledger record and hot-reload block for ${entry.id}`
        : `removed stale ledger record for ${entry.id} (the profile no longer has it installed)`)
      return { profile: entry.profile, id: entry.id, hotUnmounted: cleaned, steps: [], logs, dryRun: false }
    }

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

    // Official hot-unmount happens first: deleting the managed block makes
    // watchUserPatches diff the rows out of the live loader tree. The
    // dependency is removed only after the live rows are gone.
    let hotUnmounted = false
    if (entry.adapter === 'dsh-bundle') {
      hotUnmounted = removeManagedPatch(dir, entry.id)
      if (hotUnmounted) log('info', `removed hot-reload block for ${entry.packageName}; the official watchUserPatches diff hot-unmounts it`)
      else log('warn', `no hot-reload block found for ${entry.packageName}; it is already unloaded from the patch layer`)
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
    removeDisabledEntry(this.home, entry.profile, entry.id)
    rmSync(workDir, { recursive: true, force: true })
    if (!hotUnmounted) this.touchRestart()
    this.noteClientFace(entry, log)
    log('info', `uninstalled ${entry.id} from profile ${entry.profile}`)
    return {
      profile: entry.profile,
      id: entry.id,
      hotUnmounted,
      steps: entry.steps,
      logs,
      dryRun: false,
    }
  }

  async restore(request: RestoreRequest): Promise<RestoreResult> {
    return this.enqueue(() => this.restoreInner(request))
  }

  private async restoreInner(request: RestoreRequest): Promise<RestoreResult> {
    const logs: OperationLog[] = []
    const log = (level: OperationLog['level'], message: string): void => { logs.push({ level, message }) }
    const file = resolve(request.file)
    const spec = parseRequirements(readFileSync(file, 'utf8'), dirname(file))
    const ledger = loadEffectiveLedger(this.home)
    const actions = planRestore(spec, ledger, request.modes ?? [])
    const reconciled = await this.reconcilePlan(spec, actions, request.dryRun === true, logs, log, 'restore')
    return { file, actions, ...reconciled, logs, dryRun: request.dryRun === true }
  }

  /**
   * Repair home state so the next boot cannot die on profile composition:
   * prune unresolvable bundle rows, drop stale ledger records together with
   * their managed hot-reload blocks, and reconcile profile pnpm trees.
   */
  async doctor(): Promise<{ profiles: ReturnType<typeof healProfiles>; droppedLedger: string[]; reconciled: string[] }> {
    const profiles = healProfiles(this.home)
    const ledger = loadLedger(this.home)
    const droppedLedger: string[] = []
    for (const entry of listEntries(ledger)) {
      if (!isEntryEffective(this.home, entry)) {
        if (entry.adapter === 'dsh-bundle') removeManagedPatch(entry.profileDir ?? profileDir(this.home, entry.profile), entry.id)
        if (entry.pluginEnvDir !== undefined && entry.pluginEnvDir !== '' && existsSync(entry.pluginEnvDir)) {
          rmSync(entry.pluginEnvDir, { recursive: true, force: true })
        }
        removeEntry(ledger, entry.profile, entry.id)
        droppedLedger.push(`${entry.profile}/${entry.id}`)
      }
    }
    if (droppedLedger.length > 0) saveLedger(this.home, ledger)
    const reconciled: string[] = []
    for (const name of listProfiles(this.home)) {
      const dir = profileDir(this.home, name)
      if (!existsSync(join(dir, 'pnpm-lock.yaml')) && !existsSync(join(dir, 'node_modules'))) continue
      try {
        await this.executor.reconcileProfile({ home: this.home, profileDir: dir, workDir: dir, source: 'doctor', ref: '', log: () => {} })
        reconciled.push(name)
      } catch (error) {
        reconciled.push(`${name} (reconcile failed: ${messageOf(error)})`)
      }
    }
    return { profiles, droppedLedger, reconciled }
  }

  /**
   * Switch the active requirements root and reconcile the installed set.
   * Modes present in the ledger but absent from the target file are reconciled
   * to an empty desired set; switchable entries are disabled in place, not
   * uninstalled.
   */
  async switchWorkspace(path: string, dryRun = false): Promise<RestoreResult> {
    return this.enqueue(() => this.switchWorkspaceInner(path, dryRun))
  }

  private async switchWorkspaceInner(path: string, dryRun: boolean): Promise<RestoreResult> {
    if (this.reconciling) throw new Error('a workspace switch is already running')
    this.reconciling = true
    this.switchError = ''
    try {
      const logs: OperationLog[] = []
      const log = (level: OperationLog['level'], message: string): void => { logs.push({ level, message }) }
      const healed = await this.doctor()
      for (const report of healed.profiles) {
        for (const packageName of report.pruned) {
          log('warn', `healed profile ${report.profile}: pruned unresolvable bundle row ${packageName}`)
        }
      }
      for (const id of healed.droppedLedger) {
        log('warn', `healed ledger: dropped stale record ${id}`)
      }
      const root = this.resolveWorkspaceInput(path)
      const file = this.workspaceRequirementsFile(root)
      if (file === '') {
        log('info', `${dryRun ? 'dry run: ' : ''}workspace switch to ${root} (no requirements/deps.yaml found — installed set left unchanged)`)
        if (!dryRun) this.setConfig({ ...this.getConfig(), workspaceRoot: root })
        return { file: '', actions: [], installed: [], uninstalled: [], updated: [], logs, dryRun }
      }
      const spec = parseRequirements(readFileSync(file, 'utf8'), dirname(file))
      const ledger = loadEffectiveLedger(this.home)
      const actions = planWorkspaceSwitch(spec, ledger).map(action => {
        if (action.action !== 'uninstall' || action.current === undefined || !this.isDisableable(action.current)) return action
        return { ...action, action: 'disable' as const, reason: 'not declared by the target workspace — switched off' }
      })
      if (dryRun) {
        for (const action of actions) log('info', `${action.action}: ${action.profile}/${action.id} — ${action.reason}`)
        return { file, actions, installed: [], uninstalled: [], updated: [], logs, dryRun }
      }
      this.setConfig({ ...this.getConfig(), workspaceRoot: root })
      const reconciled = await this.reconcilePlan(spec, actions, false, logs, log, 'workspace switch')
      return { file, actions, ...reconciled, logs, dryRun }
    } catch (error) {
      this.switchError = messageOf(error)
      throw error
    } finally {
      this.reconciling = false
    }
  }

  private isDisableable(entry: LedgerEntry): boolean {
    return entry.adapter === 'dsh-bundle' && patchRowIdsForEntry(entry).length > 0
  }

  private async reconcilePlan(
    spec: RequirementsSpec,
    actions: PlanAction[],
    dryRun: boolean,
    logs: OperationLog[],
    log: (level: OperationLog['level'], message: string) => void,
    label: string,
  ): Promise<{ installed: InstallResult[]; uninstalled: UninstallResult[]; updated: InstallResult[] }> {
    const installed: InstallResult[] = []
    const uninstalled: UninstallResult[] = []
    const updated: InstallResult[] = []
    for (const action of actions) {
      log('info', `${action.action}: ${action.profile}/${action.id} — ${action.reason}`)
      if (action.action === 'keep' || dryRun) continue
      try {
        if (action.action === 'disable') {
          const result = await this.disableInner({ profile: action.profile, id: action.id })
          uninstalled.push(result)
          logs.push(...result.logs)
        } else if (action.action === 'enable') {
          const result = await this.enableInner({ profile: action.profile, id: action.id })
          logs.push(...result.logs)
        } else if (action.action === 'uninstall') {
          const result = await this.uninstallInner({ profile: action.profile, id: action.id })
          uninstalled.push(result)
          logs.push(...result.logs)
        } else {
          const entry = action.entry as SpecEntry
          const result = await this.installInner({
            id: entry.id,
            profile: action.profile,
            source: entry.source,
            adapter: entry.adapter,
            adapterDir: entry.adapter === 'custom' && entry.adapterDir !== '' ? resolveAdapterDir(spec, entry.adapterDir) : '',
            specAdapterDir: entry.adapterDir,
            ref: entry.ref,
            allowBuild: entry.allowBuild,
          })
          installed.push(result)
          if (action.action === 'update') updated.push(result)
          logs.push(...result.logs)
        }
      } catch (error) {
        throw new Error(`${label} failed at ${action.action} ${action.profile}/${action.id}: ${messageOf(error)}`)
      }
    }
    return { installed, uninstalled, updated }
  }

  private resolveWorkspaceInput(path: string): string {
    const value = path.trim()
    if (value === '') return defaultWorkspaceRoot(this.home)
    if (isAbsolute(value) || /^[A-Za-z]:[\/]/.test(value) || /^[A-Za-z]:$/.test(value)) return resolve(value)
    return resolve(process.cwd(), value)
  }

  private workspaceRequirementsFile(root: string): string {
    for (const candidate of [join(root, 'requirements', DEPS_FILENAME), join(root, DEPS_FILENAME)]) {
      if (existsSync(candidate)) return candidate
    }
    return ''
  }

  async sync(request: SyncRequest): Promise<RestoreResult> {
    return this.enqueue(() => this.syncInner(request))
  }

  private async syncInner(request: SyncRequest): Promise<RestoreResult> {
    const repo = resolve(request.repo)
    if (!existsSync(join(repo, '.git'))) throw new Error(`sync repo is not a git checkout: ${repo}`)
    const pulled = await this.git(['pull', '--ff-only'], repo)
    if (pulled.exitCode !== 0) throw new Error(`git pull failed (exit ${pulled.exitCode}): ${pulled.stderr || pulled.stdout}`)
    const file = resolve(request.file ?? join(repo, 'requirements', DEPS_FILENAME))
    return this.restoreInner({
      file,
      ...(request.modes === undefined ? {} : { modes: request.modes }),
      ...(request.dryRun === undefined ? {} : { dryRun: request.dryRun }),
    })
  }

  getConfig(): PackageManagerConfig {
    return loadConfig(this.home)
  }

  setConfig(config: PackageManagerConfig): PackageManagerConfig {
    const previous = this.getConfig()
    const saved = saveConfig(this.home, config)
    if (saved.workspaceRoot.trim() !== '' && saved.workspaceRoot.trim() !== previous.workspaceRoot.trim()) {
      recordWorkspaceHistory(this.home, this.workspaceRoot())
    }
    return saved
  }

  workspaceHistory(): string[] {
    return loadWorkspaceHistory(this.home)
  }

  recordWorkspaceHistory(path: string): string[] {
    return recordWorkspaceHistory(this.home, path)
  }

  forgetWorkspaceHistory(path: string): string[] {
    return forgetWorkspaceHistory(this.home, path)
  }

  clearWorkspaceHistory(): string[] {
    return clearWorkspaceHistory(this.home)
  }

  forgetDisabled(request: ToggleRequest): DisabledEntry | undefined {
    return removeDisabledEntry(this.home, request.profile, request.id)
  }

  async syncConfigured(): Promise<RestoreResult> {
    return this.enqueue(() => this.syncConfiguredInner())
  }

  private async syncConfiguredInner(): Promise<RestoreResult> {
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
    return this.restoreInner({ file })
  }

  /** Check a git-installed plugin for a newer remote commit and install it. */
  async checkUpdate(request: UpdateCheckRequest): Promise<UpdateCheckResult> {
    return this.enqueue(() => this.checkUpdateInner(request))
  }

  private async checkUpdateInner(request: UpdateCheckRequest): Promise<UpdateCheckResult> {
    const { profile, id } = request
    const logs: OperationLog[] = []
    const log = (level: OperationLog['level'], message: string): void => { logs.push({ level, message }) }
    const ledger = loadLedger(this.home)
    const entry = getEntry(ledger, profile, id)
    if (entry === undefined) throw new Error(`plugin ${JSON.stringify(id)} is not installed in profile ${JSON.stringify(profile)}`)
    if (entry.sourceKind !== 'git') {
      log('info', `${id} is not a git source; update check skipped`)
      return { profile, id, status: 'not-git', previousCommit: entry.resolvedCommit, latestCommit: '', updated: false, logs }
    }

    const github = parseGithubSpec(entry.source)
    const url = github?.url ?? entry.source.replace(/^git\+/, '')
    const targetRef = github !== undefined && github.ref !== '' ? github.ref : entry.ref
    if (/^[0-9a-f]{7,40}$/i.test(targetRef)) {
      log('info', `${id} is pinned to commit ${targetRef}; treated as up-to-date`)
      return { profile, id, status: 'up-to-date', previousCommit: entry.resolvedCommit, latestCommit: entry.resolvedCommit, updated: false, logs }
    }

    const args = ['ls-remote', url]
    if (targetRef !== '') args.push(targetRef)
    else args.push('HEAD')
    const remote = await this.git(args, this.home)
    if (remote.exitCode !== 0) throw new Error(`git ls-remote failed (exit ${remote.exitCode}): ${remote.stderr || remote.stdout}`)
    const latestCommit = remote.stdout.trim().split(/\s+/)[0] ?? ''
    if (latestCommit === '') throw new Error(`git ls-remote returned no commit for ${url}`)
    log('info', `checked ${id}: installed ${entry.resolvedCommit} -> remote ${latestCommit}`)
    if (latestCommit === entry.resolvedCommit) {
      return { profile, id, status: 'up-to-date', previousCommit: entry.resolvedCommit, latestCommit, updated: false, logs }
    }

    // Force-refresh the shared mirror so the subsequent install cannot clone
    // a stale mirror back.
    await syncGitMirror(packageStoreRoot(this.home), url, targetRef, this.git)
    const previousCommit = entry.resolvedCommit
    const reinstall: InstallRequest = {
      profile: entry.profile,
      id: entry.id,
      source: entry.source,
      adapter: entry.adapter,
      ...(entry.adapterDir === '' ? {} : { adapterDir: entry.adapterDir }),
      ...(entry.ref === '' ? {} : { ref: entry.ref }),
      allowBuild: entry.allowBuild ?? false,
    }
    await this.uninstallInner({ profile, id })
    try {
      const installed = await this.installInner(reinstall)
      logs.push(...installed.logs)
      log('info', `updated ${id} from ${previousCommit} to ${latestCommit}`)
      return { profile, id, status: 'updated', previousCommit, latestCommit, updated: true, logs }
    } catch (error) {
      // Best-effort restore of the previous commit so a failed update does not
      // leave the plugin uninstalled.
      try {
        await this.installInner({ ...reinstall, ref: previousCommit })
      } catch (rollbackError) {
        throw new Error(`update failed (${messageOf(error)}); rollback to ${previousCommit} also failed: ${messageOf(rollbackError)}`)
      }
      throw new Error(`update failed and was rolled back to ${previousCommit}: ${messageOf(error)}`)
    }
  }

  async disable(request: ToggleRequest): Promise<UninstallResult> {
    return this.enqueue(() => this.disableInner(request))
  }

  private async disableInner(request: ToggleRequest): Promise<UninstallResult> {
    const { profile, id } = request
    const ledger = loadLedger(this.home)
    const entry = getEntry(ledger, profile, id)
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
    const rowIds = patchRowIdsForEntry(entry)
    if (entry.adapter === 'dsh-bundle' && rowIds.length > 0) {
      const dir = entry.profileDir ?? profileDir(this.home, profile)
      const packageDir = resolveBundlePackageDir(entry)
      const managed = packageDir === undefined ? undefined : managedPatchForPackage(packageDir, profile, id)
      if (managed === undefined) {
        throw new Error(`cannot disable ${JSON.stringify(id)}: its installed bundle patch is no longer resolvable`)
      }
      // Rewrite the same managed block with trailing disabled rows; the
      // official watcher diffs the live rows off, and the state persists
      // across a restart without uninstalling anything.
      writeManagedPatch(dir, id, managed.entries, true, rowIds)
      entry.disabled = true
      saveLedger(this.home, ledger)
      return {
        profile,
        id,
        hotUnmounted: true,
        steps: entry.steps,
        logs: [{ level: 'info', message: `disabled ${rowIds.length} bundle patch row(s) — install kept, switched off through cordis.patch.yml` }],
        dryRun: false,
      }
    }

    // A custom adapter (or a bundle with no stable rows) has no live patch
    // row to switch off: keep the old uninstall-and-remember flow.
    upsertDisabledEntry(this.home, disabled)
    try {
      const result = await this.uninstallInner({ profile, id })
      upsertDisabledEntry(this.home, disabled)
      return result
    } catch (error) {
      if (!alreadyDisabled) removeDisabledEntry(this.home, profile, id)
      throw error
    }
  }

  async enable(request: ToggleRequest): Promise<InstallResult> {
    return this.enqueue(() => this.enableInner(request))
  }

  private async enableInner(request: ToggleRequest): Promise<InstallResult> {
    const installedRaw = getEntry(loadEffectiveLedger(this.home), request.profile, request.id)
    if (installedRaw?.disabled === true && installedRaw.adapter === 'dsh-bundle') {
      const rowIds = patchRowIdsForEntry(installedRaw)
      if (rowIds.length > 0) {
        const dir = installedRaw.profileDir ?? profileDir(this.home, request.profile)
        const packageDir = resolveBundlePackageDir(installedRaw)
        const managed = packageDir === undefined ? undefined : managedPatchForPackage(packageDir, request.profile, request.id)
        if (managed === undefined) {
          throw new Error(`cannot enable ${JSON.stringify(request.id)}: its installed bundle patch is no longer resolvable`)
        }
        writeManagedPatch(dir, request.id, managed.entries, false, rowIds)
        const ledger = loadLedger(this.home)
        const stored = getEntry(ledger, request.profile, request.id)
        if (stored !== undefined) {
          stored.disabled = false
          saveLedger(this.home, ledger)
        }
        removeDisabledEntry(this.home, request.profile, request.id)
        const logs: OperationLog[] = [{ level: 'info', message: `enabled ${rowIds.length} bundle patch row(s) — switched back on through cordis.patch.yml` }]
        this.noteClientFace(installedRaw, (level, message) => logs.push({ level, message }))
        return {
          profile: request.profile,
          id: request.id,
          adapter: installedRaw.adapter,
          packageName: installedRaw.packageName,
          pluginEnvDir: installedRaw.pluginEnvDir ?? '',
          workspaceDir: installedRaw.workspaceDir ?? this.pluginWorkspaceDir(request.profile, request.id),
          hotMounted: true,
          steps: installedRaw.steps,
          logs,
          dryRun: false,
        }
      }
    }
    const disabled = loadDisabled(this.home).find(item => item.profile === request.profile && item.id === request.id)
    if (disabled === undefined) throw new Error(`plugin ${JSON.stringify(request.id)} is not disabled in profile ${JSON.stringify(request.profile)}`)
    return this.installInner({
      profile: disabled.profile,
      id: disabled.id,
      source: disabled.source,
      adapter: disabled.adapter,
      ...(disabled.adapterDir === '' ? {} : { adapterDir: disabled.adapterDir }),
      ...(disabled.ref === '' ? {} : { ref: disabled.ref }),
      allowBuild: disabled.allowBuild,
    })
  }

  async adapterInit(request: AdapterInitRequest): Promise<AdapterInitResult> {
    const logs: OperationLog[] = []
    const log = (level: OperationLog['level'], message: string): void => { logs.push({ level, message }) }
    const outDir = resolve(request.outDir)
    mkdirSync(outDir, { recursive: true })
    const workDir = this.workDir('probe', request.id)
    const materialized = await materializeSource(workDir, request.source, request.ref ?? '', this.git, packageStoreRoot(this.home))
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
    if (materializedDir === '') return { kind: 'dsh-bundle', reason: 'npm dependency — bundle declaration resolved after install', adapterDir: '' }
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
    return join(workRoot(this.home), `${profile}-${safe}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  }

  /** Anchor local directory sources so `dsh plugin add` never resolves them against the profile dir. */
  private profileSpecFor(source: string, kind: ReturnType<typeof detectSourceKind>): string {
    if (kind !== 'file') return source
    const prefix = source.startsWith('link:') ? 'link:' : source.startsWith('file:') ? 'file:' : 'file:'
    const raw = source.replace(/^(?:link|file):/, '')
    return `${prefix}${resolve(raw)}`
  }

  private restartMarker(): string {
    return join(pmRoot(this.home), RESTART_MARKER)
  }

  private touchRestart(): void {
    mkdirSync(pmRoot(this.home), { recursive: true })
    writeFileSync(this.restartMarker(), new Date().toISOString() + '\n')
  }

  private webRefreshMarker(): string {
    return join(pmRoot(this.home), WEB_REFRESH_MARKER)
  }

  private touchWebRefresh(): void {
    mkdirSync(pmRoot(this.home), { recursive: true })
    writeFileSync(this.webRefreshMarker(), new Date().toISOString() + '\n')
  }

  /**
   * The host's client-modules graph updates live from the loader diff; open
   * web tabs only need a reload. Missing client artifacts are reported instead
   * of failing the install.
   */
  private noteClientFace(entry: LedgerEntry, log: (level: OperationLog['level'], message: string) => void): void {
    if (entry.adapter !== 'dsh-bundle' || entry.packageName === '') return
    const packageDir = resolveBundlePackageDir(entry)
    if (packageDir === undefined) return
    let face: ReturnType<typeof clientFaceOf>
    try {
      face = clientFaceOf(packageDir)
    } catch {
      return
    }
    if (!face.declared) return
    if (!face.platformOk) {
      log('warn', `bundle ${entry.packageName} declares dsh.client with a non-web platform; the host client-modules registry will ignore this row`)
      return
    }
    this.touchWebRefresh()
    if (face.artifactPath === undefined || !existsSync(face.artifactPath)) {
      log('warn', `bundle ${entry.packageName} declares dsh.client but the client artifact is missing (expected ${face.artifactPath ?? 'lib/client.js'}); build it before reloading the web tab`)
    } else {
      log('info', `bundle ${entry.packageName} client module registered live; reload the web tab to load it`)
    }
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
