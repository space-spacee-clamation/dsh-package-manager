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
import { builtinInstallSteps, clientFaceOf, isGitSpec, probeBundleDir, validateBundleSource } from './adapters/builtinBundle.ts'
import { loadCustomAdapter, runCustomInstall, scaffoldCustomAdapter } from './adapters/custom.ts'
import { loadBundlePatch } from './bundlePatch.ts'
import { resolveBundlePackageDir } from './cordisRuntime.ts'
import { setRowDisabled } from './profilePatch.ts'
import { workspaceBundleInstallSteps } from './workspaceTree.ts'
import { getEntry, isEntryEffective, listEntries, loadEffectiveLedger, loadLedger, removeEntry, saveLedger, setEntry } from './ledger.ts'
import { createHost, type PackageManagerHost } from './hostAsync.ts'
import { defaultWorkspaceRoot, packageStoreRoot, pmRoot, profileDir, resolveHome, workRoot } from './paths.ts'
import { pluginEnvDir, pluginWorkspaceDir } from './pluginWorkspace.ts'
import { loadConfig, loadDisabled, removeDisabledEntry, saveConfig, saveDisabled, upsertDisabledEntry } from './config.ts'
import { ensureProfile, healProfiles, listProfiles, pruneBundles, readAllowBuilds, readManifest, reconcileBundles, removeDanglingLink, writeAllowBuilds } from './profile.ts'
import { detectSourceKind, materializeSource, type GitRunner } from './source.ts'
import { clearWorkspaceHistory, forgetWorkspaceHistory, loadWorkspaceHistory, recordWorkspaceHistory } from './runtimeStore.ts'
import { parseRequirements, planRestore, planWorkspaceSwitch, resolveAdapterDir, fingerprint } from './spec.ts'
import { addedDependency, StepExecutor, type CommandRunner, type DshRunner, type PnpmRunner } from './steps.ts'
import type {
  AdapterContext, AdapterInitRequest, AdapterInitResult, DisabledEntry, InstallRequest, InstallResult, Ledger,
  LedgerEntry, ManagerState, OperationLog, PackageManagerConfig, PackageManagerRuntime, PlanAction, RestoreRequest,
  RequirementsSpec, RestoreResult, RuntimeMountResult, SpecEntry, StepRecord, SyncRequest, ToggleRequest, UninstallRequest, UninstallResult,
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
  /** In-process Cordis hot-plug seam; absent for the CLI and tests. */
  runtime?: PackageManagerRuntime
}

const RESTART_MARKER = 'restart-needed'
const WEB_REFRESH_MARKER = 'web-refresh-needed'
const DEPS_FILENAME = 'deps.yaml'
interface PreparedBundleInstall {
  request: InstallRequest
  id: string
  profile: string
  dir: string
  sourceKind: ReturnType<typeof detectSourceKind>
  materializedDir: string
  resolvedCommit: string
  packageName: string
  profileSpec: string
  workDir: string
  ctx: AdapterContext
  logs: OperationLog[]
  log: (level: OperationLog['level'], message: string) => void
}

export class PackageManager {
  readonly home: string
  private readonly executor: StepExecutor
  private readonly git: GitRunner
  private readonly runtime: PackageManagerRuntime | undefined
  private reconciling = false
  /** Serializes profile/ledger mutations; the host runs pnpm without a lock, so install/uninstall/restore must never interleave. */
  private chain: Promise<unknown> = Promise.resolve()

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const task = this.chain.then(run, run)
    this.chain = task.catch(() => {})
    return task
  }
  private switchError = ''

  constructor(options: PackageManagerOptions = {}) {
    this.home = options.home ?? resolveHome()
    const host = options.host ?? createHost()
    this.executor = new StepExecutor(
      options.pnpm ?? ((args, cwd, env) => host.pnpm(args, cwd, env)),
      options.command ?? ((command, cwd, env) => host.shell(command, cwd, env)),
      options.dsh ?? ((args, cwd, env) => host.dsh(args, cwd, env)),
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

  /** Default workspace root used when config.workspaceRoot is empty. */
  workspaceDefault(): string {
    return defaultWorkspaceRoot(this.home)
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
      workspaceHistory: loadWorkspaceHistory(this.home),
      reconciling: this.reconciling,
      switchError: this.switchError,
      restartNeeded: existsSync(this.restartMarker()),
      webRefreshNeeded: existsSync(this.webRefreshMarker()),
      profiles,
      entries: listEntries(loadEffectiveLedger(this.home)),
      disabled: loadDisabled(this.home),
      config: loadConfig(this.home),
    }
  }

  /** Remove the restart hint (the Web UI calls this once the user acknowledged it). */
  clearRestartMarker(): void {
    rmSync(this.restartMarker(), { force: true })
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
    const channel = request.channel ?? 'profile'

    const workspaceDir = this.pluginWorkspaceDir(profile, id)
    const envDir = pluginEnvDir(workspaceDir)

    if (request.dryRun === true) {
      log('info', `dry run: would install ${JSON.stringify(id)} into profile ${JSON.stringify(profile)} from ${JSON.stringify(source)}`)
      log('info', `dry run: plugin workspace ${workspaceDir}, isolated env ${envDir}`)
      log('info', `dry run: adapter ${request.adapter}, channel ${channel}, allowBuild ${String(allowBuild)}`)
      return {
        profile,
        id,
        adapter: request.adapter,
        channel,
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
    try {
      const materialized = kind === 'npm' ? undefined : await materializeSource(workDir, source, ref, this.git, packageStoreRoot(this.home))
      const resolved = this.resolveAdapter(request.adapter, request.adapterDir ?? '', source, materialized?.dir ?? '')
      let packageName = resolved.packageName ?? (kind === 'npm' ? npmNameOf(source) : '')
      log('info', `adapter: ${resolved.kind}${resolved.reason === '' ? '' : ` (${resolved.reason})`}`)

      if (resolved.kind === 'dsh-bundle') {
        if (materialized !== undefined && materialized.dir !== '') {
          const problems = validateBundleSource(materialized.dir)
          if (problems.length > 0) {
            throw new Error(`bundle source rejected before any profile edit: ${problems.join('; ')}`)
          }
        }
        if (channel === 'workspace') {
          if (materialized === undefined || materialized.dir === '') {
            throw new Error(`workspace channel requires a git or file source (npm spec ${JSON.stringify(source)} cannot be materialized)`)
          }
          if (packageName === '') {
            throw new Error('workspace channel requires the bundle to declare a package name in package.json')
          }
          records = await this.executor.run(workspaceBundleInstallSteps({
            sourceDir: materialized.dir,
            pluginEnvDir: envDir,
            packageName,
            allowBuild,
          }), ctx, join(workDir, 'backups'))
        } else {
          const steps = builtinInstallSteps({
            source,
            sourceKind: kind,
            ref,
            allowBuild,
            packageName,
              profileSpec: this.profileSpecFor(source, kind),
            pluginEnvDir: envDir,
            workDir,
            executor: this.executor,
          })
          records = await this.executor.run(steps, ctx, join(workDir, 'backups'))
          const recordedPackage = records.find(record => record.kind === 'profile.dependency.add')?.params['packageName']
          if (typeof recordedPackage === 'string' && recordedPackage !== '') packageName = recordedPackage
        }
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
        channel,
        ...(channel === 'workspace' ? { disabled: false } : {}),
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
        if (channel !== 'workspace') {
          for (const row of this.patchRowsFor(entry)) setRowDisabled(dir, row.id, false)
        }

      // Cordis hot-plug: mount the bundle's patch rows, not the bundle package.
      // For the profile channel the bundle resolves through the profile's
      // node_modules; for the workspace channel it resolves through the
      // workspace include subtree. Uninstall disposes the same fiber before
      // replaying inverse steps.
      let runtime: RuntimeMountResult = { mounted: false, reason: 'no in-process runtime (CLI/tests)' }
      if (resolved.kind === 'dsh-bundle' && this.runtime !== undefined && packageName !== ''
        && (this.runtime.channel ?? 'profile') === channel) {
        runtime = await this.runtime.mount(entry)
        if (runtime.mounted) log('info', `hot-mounted ${packageName} through Cordis (${channel} channel)`)
        else log('warn', `live mount skipped: ${runtime.reason}`)
      }

      setEntry(ledger, entry)
      saveLedger(this.home, ledger)
      this.clearDisabled(profile, id)
        if (channel !== 'workspace') {
          for (const row of this.patchRowsFor(entry)) setRowDisabled(dir, row.id, false)
        }
      if (!runtime.mounted) this.touchRestart()
      this.noteClientFace(entry, log)
      log('info', `installed ${id} in profile ${profile} (${records.length} steps recorded, ${channel} channel)`)
      return {
        profile,
        id,
        adapter: resolved.kind,
        channel,
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
    if (!isEntryEffective(this.home, entry)) {
      // The host profile manifest no longer carries this dependency (removed
      // with `dsh plugin remove` or by hand): nothing to uninstall, drop the
      // stale ledger record so restore converges.
      removeEntry(ledger, entry.profile, entry.id)
      saveLedger(this.home, ledger)
      log('info', `removed stale ledger record for ${entry.id} (the profile no longer has it installed)`)
      return { profile: entry.profile, id: entry.id, hotUnmounted: false, steps: [], logs, dryRun: false }
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
      const defersUnmount = this.runtime?.composesProfile === true
    if (entry.adapter === 'dsh-bundle' && this.runtime !== undefined && entry.packageName !== '' && !defersUnmount) {
      runtime = await this.runtime.unmount(entry)
      if (runtime.mounted) log('info', `hot-unmounted ${entry.packageName} through Cordis`)
      else log('warn', `live unmount skipped: ${runtime.reason}`)
    }
    const patchRows = this.patchRowsFor(entry)

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
      if (defersUnmount) {
        runtime = await this.runtime!.unmount(entry)
        if (runtime.mounted) log('info', `hot-unmounted ${entry.packageName} through profile recomposition`)
        else log('warn', `live unmount skipped: ${runtime.reason}`)
      }
    removeEntry(ledger, entry.profile, entry.id)
    saveLedger(this.home, ledger)
      if ((entry.channel ?? 'profile') !== 'workspace') {
        for (const row of patchRows) setRowDisabled(dir, row.id, false)
      }
      removeDisabledEntry(this.home, entry.profile, entry.id)
    rmSync(workDir, { recursive: true, force: true })
    if (!runtime.mounted) this.touchRestart()
    this.noteClientFace(entry, log)
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
   * prune unresolvable bundle rows (dependency gone AND package unresolvable),
   * remove their dangling node_modules links, and drop stale ledger records.
   * Safe to run while the host is live; also invoked automatically at the
   * start of every workspace switch.
   */
  async doctor(): Promise<{ profiles: ReturnType<typeof healProfiles>; droppedLedger: string[]; reconciled: string[] }> {
    const profiles = healProfiles(this.home)
    const ledger = loadLedger(this.home)
    const droppedLedger: string[] = []
    for (const entry of listEntries(ledger)) {
      if (!isEntryEffective(this.home, entry)) {
        removeEntry(ledger, entry.profile, entry.id)
        droppedLedger.push(`${entry.profile}/${entry.id}`)
      }
    }
    if (droppedLedger.length > 0) saveLedger(this.home, ledger)
    // Reconcile each profile's pnpm tree so stale links left by previous
    // link:/interrupted installs cannot poison later adds (pnpm import EPERM).
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
   * Switch the active workspace root and reconcile the installed set against
   * that workspace's requirements file. Modes present in the ledger but not
   * declared by the target file are reconciled to empty, so switching closes
   * plugins the target does not contain.
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
      const actions = planWorkspaceSwitch(spec, ledger)
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
    /** Fast-path check: entries created by the single-dependency bundle adapter. */
    private isFastBundleEntry(entry: LedgerEntry): boolean {
      if (entry.adapter !== 'dsh-bundle' || entry.packageName === '') return false
      return !entry.steps.some(step => step.kind.startsWith('pluginEnv.') || step.kind.startsWith('file.') || step.kind === 'pnpm')
    }

    /** One dsh/pnpm command removes every fast-path bundle dependency in a profile. */
    private async uninstallFastBundleBatch(entries: LedgerEntry[]): Promise<UninstallResult[]> {
      const results: UninstallResult[] = []
      const byProfile = new Map<string, LedgerEntry[]>()
      for (const entry of entries) {
        const bucket = byProfile.get(entry.profile) ?? []
        bucket.push(entry)
        byProfile.set(entry.profile, bucket)
      }

      for (const [profile, bucket] of byProfile) {
        const dir = bucket[0]?.profileDir ?? profileDir(this.home, profile)
          const patchRowsByEntry = new Map(bucket.map(entry => [entry.id, this.patchRowsFor(entry)] as const))
        const packageNames = bucket.map(entry => entry.packageName)
        const ctx: AdapterContext = {
          home: this.home,
          profileDir: dir,
          workDir: dir,
          source: 'batch-uninstall',
          ref: '',
          log: (level, message) => results.at(-1)?.logs.push({ level, message }),
        }
          const allowBuildBefore = readAllowBuilds(dir)
          const restoreAllowBuilds = bucket.some(entry => entry.steps.some(step => step.kind === 'profile.allowBuild.add'))
        const tool = await this.executor.runProfileDependencies('remove', packageNames, ctx)
        pruneBundles(dir, packageNames)
        for (const packageName of packageNames) {
          if (removeDanglingLink(dir, packageName)) {
            results.at(-1)?.logs.push({ level: 'warn', message: `removed dangling node_modules link for ${packageName}` })
          }
        }
          if (restoreAllowBuilds) writeAllowBuilds(dir, allowBuildBefore)

        for (const entry of bucket) {
          const logs: OperationLog[] = []
          const log = (level: OperationLog['level'], message: string): void => { logs.push({ level, message }) }
          let runtime: RuntimeMountResult = { mounted: false, reason: 'no in-process runtime' }
          if (this.runtime !== undefined) {
            runtime = await this.runtime.unmount(entry)
            if (runtime.mounted) log('info', `hot-unmounted ${entry.packageName} through Cordis`)
            else log('warn', `live unmount skipped: ${runtime.reason}`)
          }
          const ledger = loadLedger(this.home)
          removeEntry(ledger, entry.profile, entry.id)
          saveLedger(this.home, ledger)
            for (const row of patchRowsByEntry.get(entry.id) ?? []) setRowDisabled(dir, row.id, false)
          for (const row of this.patchRowsFor(entry)) setRowDisabled(dir, row.id, false)
          removeDisabledEntry(this.home, entry.profile, entry.id)
          if (entry.workDir !== undefined && entry.workDir !== '') rmSync(entry.workDir, { recursive: true, force: true })
          if (!runtime.mounted) this.touchRestart()
          this.noteClientFace(entry, log)
          log('info', `uninstalled ${entry.id} from profile ${entry.profile} (batch ${tool})`)
          results.push({ profile, id: entry.id, hotUnmounted: runtime.mounted, steps: entry.steps, logs, dryRun: false })
        }
      }
      return results
    }

    private async installFastBundleBatch(requests: InstallRequest[]): Promise<InstallResult[]> {
      const results: InstallResult[] = []
      const prepared: PreparedBundleInstall[] = []
      const ledger = loadEffectiveLedger(this.home)

      for (const request of requests) {
        const logs: OperationLog[] = []
        const log = (level: OperationLog['level'], message: string): void => { logs.push({ level, message }) }
        const profile = request.profile
        const id = request.id ?? idFromSource(request.source)
        const dir = profileDir(this.home, profile)
        ensureProfile(dir, profile)
        if (getEntry(ledger, profile, id) !== undefined) {
          throw new Error(`plugin ${JSON.stringify(id)} is already installed in profile ${JSON.stringify(profile)}`)
        }
        const sourceKind = detectSourceKind(request.source)
        const workDir = this.workDir(profile, id)
        const ctx: AdapterContext = {
          home: this.home,
          profileDir: dir,
          workDir,
          workspaceDir: this.pluginWorkspaceDir(profile, id),
          pluginEnvDir: pluginEnvDir(this.pluginWorkspaceDir(profile, id)),
          source: request.source,
          ref: request.ref ?? '',
          log,
        }
        // Workspace-channel requests install per-entry into their own .venv
        // (no pnpm batch merge exists for them), so delegate to the single
        // install path — it already handles channel end to end. Same for
        // non-bundle adapters.
        if ((request.channel ?? 'profile') === 'workspace') {
          const result = await this.installInner(request)
          results.push(result)
          logs.push(...result.logs)
          continue
        }
        const materialized = sourceKind === 'npm' ? undefined : await materializeSource(workDir, request.source, request.ref ?? '', this.git, packageStoreRoot(this.home))
        const resolved = this.resolveAdapter(request.adapter, request.adapterDir ?? '', request.source, materialized?.dir ?? '')
        if (resolved.kind !== 'dsh-bundle') {
          const result = await this.installInner(request)
          results.push(result)
          logs.push(...result.logs)
          continue
        }
        if (materialized !== undefined && materialized.dir !== '') {
          const problems = validateBundleSource(materialized.dir)
          if (problems.length > 0) {
            throw new Error(`bundle source rejected before any profile edit: ${problems.join('; ')}`)
          }
        }
        prepared.push({
          request,
          id,
          profile,
          dir,
          sourceKind,
          materializedDir: materialized?.dir ?? '',
          resolvedCommit: materialized?.resolvedCommit ?? '',
          packageName: resolved.packageName ?? (sourceKind === 'npm' ? npmNameOf(request.source) : ''),
          profileSpec: this.profileSpecFor(request.source, sourceKind),
          workDir,
          ctx,
          logs,
          log,
        })
      }

      const byProfile = new Map<string, PreparedBundleInstall[]>()
      for (const item of prepared) {
        const bucket = byProfile.get(item.profile) ?? []
        bucket.push(item)
        byProfile.set(item.profile, bucket)
      }

      for (const [profile, bucket] of byProfile) {
        const dir = bucket[0]!.dir
        const specs = bucket.map(item => item.profileSpec)
        const allowBuilds = bucket.filter(item => item.request.allowBuild === true && (isGitSpec(item.request.source) || item.sourceKind === 'npm'))
        const allowBuildBefore = allowBuilds.length > 0 ? readAllowBuilds(dir) : []
        if (allowBuilds.length > 0) {
          const next = [...new Set([...allowBuildBefore, ...allowBuilds.map(item => item.packageName).filter(name => name !== '')])]
          writeAllowBuilds(dir, next)
        }
        const depsBefore = readManifest(dir).dependencies ?? {}
        const tool = await this.executor.runProfileDependencies('add', specs, {
          home: this.home,
          profileDir: dir,
          workDir: dir,
          source: 'batch-install',
          ref: '',
          log: bucket[0]!.log,
        })
        const reconciled = reconcileBundles(dir)
        const reconciledAdded = new Set(reconciled.added)

        const depsAfter = readManifest(dir).dependencies ?? {}
        let fallbackIndex = 0
        for (const item of bucket) {
          let packageName = item.packageName
          if (packageName === '' || depsAfter[packageName] === undefined) {
            packageName = addedDependency(depsBefore, depsAfter) ?? packageName
          }
          item.packageName = packageName
          const steps: StepRecord[] = []
          if (allowBuilds.includes(item)) {
            steps.push({
              kind: 'profile.allowBuild.add',
              label: `allowBuilds += ${packageName}`,
              params: { package: packageName, before: allowBuildBefore },
              inverse: { uses: 'profile.allowBuild.set', packages: allowBuildBefore, dir },
            })
          }
          steps.push({
            kind: 'profile.dependency.add',
            label: `${tool} add ${item.profileSpec} (${packageName})`,
            params: {
              spec: item.profileSpec,
              packageName,
              ...(depsAfter[packageName] === undefined ? {} : { resolvedSpec: depsAfter[packageName] }),
            },
            inverse: { uses: 'profile.dependency.remove', packageName },
          })
          steps.push({
            kind: 'profile.bundles.reconcile',
            label: 'bundles reconciled (batch)',
            params: { added: reconciledAdded.has(packageName) ? [packageName] : [] },
            inverse: reconciledAdded.has(packageName)
              ? { uses: 'profile.bundles.remove', package: packageName }
              : { uses: 'noop' },
          })

          const entry: LedgerEntry = {
            id: item.id,
            profile,
            profileDir: dir,
            source: item.request.source,
            sourceKind: item.sourceKind,
            ref: item.request.ref ?? '',
            adapter: 'dsh-bundle',
            adapterDir: '',
            packageName,
            materializedDir: item.materializedDir,
            resolvedCommit: item.resolvedCommit,
            workDir: item.workDir,
            workspaceDir: item.ctx.workspaceDir ?? this.pluginWorkspaceDir(profile, item.id),
            pluginEnvDir: item.ctx.pluginEnvDir ?? pluginEnvDir(this.pluginWorkspaceDir(profile, item.id)),
            steps,
            installedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            spec: {
              source: item.request.source,
              adapter: item.request.adapter,
              adapterDir: item.request.specAdapterDir ?? item.request.adapterDir ?? '',
              ref: item.request.ref ?? '',
              allowBuild: item.request.allowBuild ?? false,
            },
            allowBuild: item.request.allowBuild ?? false,
          }
          let patchRows: { id: string }[]
          try {
            patchRows = this.patchRowsFor(entry)
          } catch (error) {
            // The dependency was already added by the batch step; remove it and
            // the reconciled bundle row so the ledger never records a broken install.
            await this.executor.runProfileDependencies('remove', [packageName], { ...item.ctx, log: item.log })
            pruneBundles(dir, [packageName])
            throw error
          }
            const ledger = loadLedger(this.home)
          setEntry(ledger, entry)
          saveLedger(this.home, ledger)
          this.clearDisabled(profile, item.id)
          for (const row of patchRows) setRowDisabled(dir, row.id, false)

          let runtime: RuntimeMountResult = { mounted: false, reason: 'no in-process runtime (CLI/tests)' }
          if (this.runtime !== undefined && packageName !== '') {
            runtime = await this.runtime.mount(entry)
            if (runtime.mounted) item.log('info', `hot-mounted ${packageName} through Cordis`)
            else item.log('warn', `live mount skipped: ${runtime.reason}`)
          }
          if (!runtime.mounted) this.touchRestart()
          this.noteClientFace(entry, item.log)
          item.log('info', `installed ${item.id} in profile ${profile} (${steps.length} steps recorded, batch ${tool})`)
          results.push({
            profile,
            id: item.id,
            adapter: 'dsh-bundle',
            packageName,
            channel: 'profile',
            pluginEnvDir: item.ctx.pluginEnvDir ?? '',
            workspaceDir: item.ctx.workspaceDir ?? '',
            hotMounted: runtime.mounted,
            steps,
            logs: item.logs,
            dryRun: false,
          })
        }
      }
      return results
    }
    private async reconcilePlanBatched(
      spec: RequirementsSpec,
      actions: PlanAction[],
      logs: OperationLog[],
      log: (level: OperationLog['level'], message: string) => void,
      label: string,
    ): Promise<{ installed: InstallResult[]; uninstalled: UninstallResult[]; updated: InstallResult[] }> {
      const installed: InstallResult[] = []
      const uninstalled: UninstallResult[] = []
      const updated: InstallResult[] = []
      const uninstallEntries: LedgerEntry[] = []
      const installRequests: { action: PlanAction; request: InstallRequest }[] = []

      for (const action of actions) {
        log('info', `${action.action}: ${action.profile}/${action.id} — ${action.reason}`)
        if (action.action === 'keep') continue
        if (action.action === 'uninstall' || action.action === 'update') {
          const current = action.current ?? getEntry(loadEffectiveLedger(this.home), action.profile, action.id)
          if (current !== undefined) uninstallEntries.push(current)
        }
        if (action.action === 'install' || action.action === 'update') {
          const entry = action.entry as SpecEntry
          const current = action.current ?? getEntry(loadEffectiveLedger(this.home), action.profile, action.id)
          installRequests.push({
            action,
            request: {
              id: entry.id,
              profile: action.profile,
              source: entry.source,
              adapter: entry.adapter,
              // An update must not flip the installed channel: the ledger entry
              // owns the channel, the spec does not (yet).
              ...(current?.channel === 'workspace' ? { channel: 'workspace' as const } : {}),
              adapterDir: entry.adapter === 'custom' && entry.adapterDir !== ''
                ? resolveAdapterDir(spec, entry.adapterDir)
                : '',
              specAdapterDir: entry.adapterDir,
              ref: entry.ref,
              allowBuild: entry.allowBuild,
            },
          })
        }
      }

      try {
        const fastUninstall = uninstallEntries.filter(entry => this.isFastBundleEntry(entry))
        const slowUninstall = uninstallEntries.filter(entry => !this.isFastBundleEntry(entry))
        for (const entry of slowUninstall) {
          const result = await this.uninstallInner({ profile: entry.profile, id: entry.id })
          uninstalled.push(result)
          logs.push(...result.logs)
        }
        for (const result of await this.uninstallFastBundleBatch(fastUninstall)) {
          uninstalled.push(result)
          logs.push(...result.logs)
        }

        const batchRequests = installRequests.map(item => item.request)
        const installResults = await this.installFastBundleBatch(batchRequests)
          const resultsByKey = new Map<string, InstallResult>()
            for (const result of installResults) resultsByKey.set(`${result.profile}\u0000${result.id}`, result)
          for (const item of installRequests) {
            const result = resultsByKey.get(`${item.action.profile}\u0000${item.action.id}`)
            if (result === undefined) continue
            installed.push(result)
            if (item.action.action === 'update') updated.push(result)
            logs.push(...result.logs)
          }
      } catch (error) {
        // Report the entries this run managed to install before the failure,
        // so a partial batch is recognizable instead of looking like a no-op.
        const done = listEntries(loadEffectiveLedger(this.home))
          .filter(entry => installRequests.some(item => item.action.profile === entry.profile && item.action.id === entry.id))
          .map(entry => `${entry.profile}/${entry.id}`)
        const progress = done.length > 0 ? ` (installed before the failure: ${done.join(', ')})` : ''
        throw new Error(`${label} batch reconcile failed${progress}: ${messageOf(error)}`)
      }
      return { installed, uninstalled, updated }
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
      if (!dryRun) return this.reconcilePlanBatched(spec, actions, logs, log, label)

    for (const action of actions) {
      log('info', `${action.action}: ${action.profile}/${action.id} — ${action.reason}`)
      if (action.action === 'keep' || dryRun) continue
      try {
        if (action.action === 'uninstall' || action.action === 'update') {
          const result = await this.uninstallInner({ profile: action.profile, id: action.id })
          uninstalled.push(result)
          logs.push(...result.logs)
        }
        if (action.action === 'install' || action.action === 'update') {
          const entry = action.entry as SpecEntry
          const adapterDir = entry.adapter === 'custom' && entry.adapterDir !== ''
            ? resolveAdapterDir(spec, entry.adapterDir)
            : ''
          const result = await this.installInner({
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
        throw new Error(`${label} failed at ${action.action} ${action.profile}/${action.id}: ${messageOf(error)}`)
      }
    }
    return { installed, uninstalled, updated }
  }

  private resolveWorkspaceInput(path: string): string {
    const value = path.trim()
    if (value === '') return defaultWorkspaceRoot(this.home)
    if (isAbsolute(value) || /^[A-Za-z]:[\/]/.test(value) || /^[A-Za-z]:$/.test(value)) return resolve(value)
    // `dpm switch --path .` and relative Web inputs must mean the caller's
    // cwd, not `<home>/<relative>` (which is what workspaceRoot() assumes
    // for historical config values).
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

  /** Persistent preferences: local requirements storage, remote URL, auto sync. */
  getConfig(): PackageManagerConfig {
    return loadConfig(this.home)
  }

  /** Validate and persist manager preferences. */
  setConfig(config: PackageManagerConfig): PackageManagerConfig {
    const previous = this.getConfig()
    const saved = saveConfig(this.home, config)
    if (saved.workspaceRoot.trim() !== '' && saved.workspaceRoot.trim() !== previous.workspaceRoot.trim()) {
      recordWorkspaceHistory(this.home, this.workspaceRoot())
    }
    return saved
  }

  /** Recently used workspace roots, newest first. */
  workspaceHistory(): string[] {
    return loadWorkspaceHistory(this.home)
  }

  /** Record one workspace root in the local runtime history. */
  recordWorkspaceHistory(path: string): string[] {
    return recordWorkspaceHistory(this.home, path)
  }

  /** Remove one workspace root from the local runtime history. */
  forgetWorkspaceHistory(path: string): string[] {
    return forgetWorkspaceHistory(this.home, path)
  }

  /** Clear the local workspace-root history. */
  clearWorkspaceHistory(): string[] {
    return clearWorkspaceHistory(this.home)
  }

  /** Delete a disabled-entry memory record (no ledger entry exists to uninstall). */
  forgetDisabled(request: ToggleRequest): DisabledEntry | undefined {
    return removeDisabledEntry(this.home, request.profile, request.id)
  }

  /** Clone/pull the configured requirements repo, then restore its default deps.yaml. */
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

  /** Switch a plugin off: hot-disable live bundle rows, otherwise remember and uninstall. */
  async disable(request: ToggleRequest): Promise<UninstallResult> {
    return this.enqueue(() => this.disableInner(request))
  }

  private async disableInner(request: ToggleRequest): Promise<UninstallResult> {
    const { profile, id } = request
    const entry = getEntry(loadEffectiveLedger(this.home), profile, id)
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
    if (entry.adapter === 'dsh-bundle' && (entry.channel ?? 'profile') === 'workspace' && this.runtime !== undefined) {
      const runtime = await this.runtime.setDisabled(entry, true)
      if (!runtime.mounted) throw new Error(`live disable failed: ${runtime.reason}`)
      const workspaceLedger = loadLedger(this.home)
      const stored = getEntry(workspaceLedger, profile, id)
      if (stored !== undefined) {
        stored.disabled = true
        saveLedger(this.home, workspaceLedger)
      }
      return {
        profile,
        id,
        hotUnmounted: true,
        steps: entry.steps,
        logs: [{ level: 'info', message: `disabled ${entry.id} through the workspace include (${runtime.reason})` }],
        dryRun: false,
      }
    }
    const patchRows = this.patchRowsFor(entry)
    if (entry.adapter === 'dsh-bundle' && this.runtime?.composesProfile === true && patchRows.length > 0) {
      upsertDisabledEntry(this.home, disabled)
      const dir = entry.profileDir ?? profileDir(this.home, profile)
      const applied: string[] = []
      try {
        for (const row of patchRows) {
          setRowDisabled(dir, row.id, true)
          applied.push(row.id)
        }
        const runtime = await this.runtime.setDisabled(entry, true)
        if (!runtime.mounted) throw new Error(`live disable failed: ${runtime.reason}`)
        return {
          profile,
          id,
          hotUnmounted: true,
          steps: entry.steps,
          logs: [{ level: 'info', message: `disabled ${patchRows.length} bundle patch row(s) through profile recomposition` }],
          dryRun: false,
        }
      } catch (error) {
        for (const rowId of applied.reverse()) setRowDisabled(dir, rowId, false)
        await this.runtime.setDisabled(entry, false).catch(() => {})
        if (!alreadyDisabled) removeDisabledEntry(this.home, profile, id)
        throw error
      }
    }

    if (entry.adapter === 'dsh-bundle' && this.runtime !== undefined && this.runtime.composesProfile !== true && patchRows.length > 0) {
      upsertDisabledEntry(this.home, disabled)
      const applied: string[] = []
      try {
        const runtime = await this.runtime.setDisabled(entry, true)
        if (!runtime.mounted) throw new Error(`live disable failed: ${runtime.reason}`)
        for (const row of patchRows) {
          setRowDisabled(entry.profileDir ?? profileDir(this.home, profile), row.id, true)
          applied.push(row.id)
        }
        return {
          profile,
          id,
          hotUnmounted: true,
          steps: entry.steps,
          logs: [{ level: 'info', message: `disabled ${patchRows.length} live bundle patch row(s) through Cordis` }],
          dryRun: false,
        }
      } catch (error) {
          await this.runtime.setDisabled(entry, false).catch(() => {})
        for (const rowId of applied.reverse()) setRowDisabled(entry.profileDir ?? profileDir(this.home, profile), rowId, false)
        if (!alreadyDisabled) removeDisabledEntry(this.home, profile, id)
        throw error
      }
    }

    upsertDisabledEntry(this.home, disabled)
    try {
      const result = await this.uninstallInner({ profile, id })
      // Uninstall clears disable memory records as hygiene; the no-runtime
      // disable flow must keep its record so enable can replay the install.
      upsertDisabledEntry(this.home, disabled)
      return result
    } catch (error) {
      if (!alreadyDisabled) removeDisabledEntry(this.home, profile, id)
      throw error
    }
  }

  /** Switch a disabled plugin back on by replaying its remembered request. */
  async enable(request: ToggleRequest): Promise<InstallResult> {
    return this.enqueue(() => this.enableInner(request))
  }

  private async enableInner(request: ToggleRequest): Promise<InstallResult> {
    const installedRaw = getEntry(loadEffectiveLedger(this.home), request.profile, request.id)
    if (installedRaw?.channel === 'workspace' && installedRaw.disabled === true && this.runtime !== undefined) {
      const runtime = await this.runtime.setDisabled(installedRaw, false)
      if (!runtime.mounted) throw new Error(`live enable failed: ${runtime.reason}`)
      const workspaceLedger = loadLedger(this.home)
      const stored = getEntry(workspaceLedger, request.profile, request.id)
      if (stored !== undefined) {
        stored.disabled = false
        saveLedger(this.home, workspaceLedger)
      }
      removeDisabledEntry(this.home, request.profile, request.id)
      const logs: OperationLog[] = [{ level: 'info', message: `enabled ${request.id} through the workspace include (${runtime.reason})` }]
      this.noteClientFace(installedRaw, (level, message) => logs.push({ level, message }))
      return {
        profile: request.profile,
        id: request.id,
        adapter: installedRaw.adapter,
        packageName: installedRaw.packageName,
        channel: 'workspace',
        pluginEnvDir: installedRaw.pluginEnvDir ?? '',
        workspaceDir: installedRaw.workspaceDir ?? this.pluginWorkspaceDir(request.profile, request.id),
        hotMounted: true,
        steps: installedRaw.steps,
        logs,
        dryRun: false,
      }
    }
    const disabled = loadDisabled(this.home).find(item => item.profile === request.profile && item.id === request.id)
    if (disabled === undefined) throw new Error(`plugin ${JSON.stringify(request.id)} is not disabled in profile ${JSON.stringify(request.profile)}`)
    const installed = getEntry(loadEffectiveLedger(this.home), disabled.profile, disabled.id)
      if (disabled.adapter === 'dsh-bundle' && installed !== undefined && this.runtime?.composesProfile === true) {
        const rows = this.patchRowsFor(installed)
        if (rows.length > 0) {
          const dir = installed.profileDir ?? profileDir(this.home, disabled.profile)
          for (const row of rows) setRowDisabled(dir, row.id, false)
          try {
            const runtime = await this.runtime.setDisabled(installed, false)
            if (!runtime.mounted) throw new Error(`live enable failed: ${runtime.reason}`)
            removeDisabledEntry(this.home, disabled.profile, disabled.id)
          } catch (error) {
            for (const row of rows) setRowDisabled(dir, row.id, true)
            await this.runtime.setDisabled(installed, true).catch(() => {})
            throw error
          }
          const logs: OperationLog[] = [{ level: 'info', message: `enabled ${rows.length} bundle patch row(s) through profile recomposition` }]
          this.noteClientFace(installed, (level, message) => logs.push({ level, message }))
          return {
            profile: disabled.profile,
            id: disabled.id,
            adapter: installed.adapter,
            packageName: installed.packageName,
            channel: 'profile',
            pluginEnvDir: installed.pluginEnvDir ?? '',
            workspaceDir: installed.workspaceDir ?? this.pluginWorkspaceDir(disabled.profile, disabled.id),
            hotMounted: true,
            steps: installed.steps,
            logs,
            dryRun: false,
          }
        }
      }

    if (disabled.adapter === 'dsh-bundle' && installed !== undefined && this.runtime !== undefined && this.runtime.composesProfile !== true) {
      const rows = this.patchRowsFor(installed)
      if (rows.length > 0) {
        const runtime = await this.runtime.setDisabled(installed, false)
        if (!runtime.mounted) throw new Error(`live enable failed: ${runtime.reason}`)
        const dir = installed.profileDir ?? profileDir(this.home, disabled.profile)
        for (const row of rows) setRowDisabled(dir, row.id, false)
        removeDisabledEntry(this.home, disabled.profile, disabled.id)
        const logs: OperationLog[] = [{ level: 'info', message: `enabled ${rows.length} live bundle patch row(s) through Cordis` }]
        this.noteClientFace(installed, (level, message) => logs.push({ level, message }))
        return {
          profile: disabled.profile,
          id: disabled.id,
          adapter: installed.adapter,
          packageName: installed.packageName,
          channel: 'profile',
          pluginEnvDir: installed.pluginEnvDir ?? '',
          workspaceDir: installed.workspaceDir ?? this.pluginWorkspaceDir(disabled.profile, disabled.id),
          hotMounted: true,
          steps: installed.steps,
          logs,
          dryRun: false,
        }
      }
    }

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

  /** Analyze a source and scaffold a requirements entry + adapter for it. */
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
  /** Stable-id patch rows contributed by an installed dsh-bundle. */
  private patchRowsFor(entry: LedgerEntry): { id: string }[] {
    const packageDir = resolveBundlePackageDir(entry)
    if (packageDir === undefined) return []
    const patch = loadBundlePatch(packageDir)
    if (patch === undefined) return []
    return patch.rows.filter((row): row is { id: string } => typeof row['id'] === 'string' && row['id'] !== '')
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

  /** Remove the web-refresh hint (the Web UI calls this once the user acknowledged it). */
  clearWebRefreshMarker(): void {
    rmSync(this.webRefreshMarker(), { force: true })
  }

  private touchWebRefresh(): void {
    mkdirSync(pmRoot(this.home), { recursive: true })
    writeFileSync(this.webRefreshMarker(), new Date().toISOString() + '\n')
  }

  /**
   * After a hot mount/unmount, record the client-face consequence: the host's
   * client-modules graph updates live from the loader, but open web tabs must
   * reload to fetch the new module table. Missing client artifacts (unbuilt
   * source packages) are reported instead of failing the install.
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
      // The host registry drops rows whose dsh.client.platform is not 'web'.
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
