/**
 * Wire types shared by the package-manager core, adapters, and the Web API.
 * Everything crossing a JSON boundary is a plain serializable value.
 * @module @dsh-ext/dsh-package-manager/types
 */

/** Where a plugin source came from. */
export type SourceKind = 'git' | 'file' | 'npm'

/** One installed plugin record, keyed per profile + id inside the ledger. */
export interface LedgerEntry {
  /** Stable plugin id, unique inside one profile. */
  id: string
  /** Profile (mode) this entry is installed into. */
  profile: string
  /** Absolute profile directory the dependency was linked into. */
  profileDir?: string
  /** The spec the install was requested with (verbatim, user supplied). */
  source: string
  sourceKind: SourceKind
  /** Ref/commit for git sources, empty otherwise. */
  ref: string
  /** Adapter that produced the install. */
  adapter: 'dsh-bundle' | 'custom'
  /** Absolute adapter directory for custom adapters, empty otherwise. */
  adapterDir: string
  /** Real npm package name recorded by profile.dependency.add (if any). */
  packageName: string
  /** Absolute materialized source directory (clone or local copy), empty when the source is a bare npm name. */
  materializedDir: string
  /** Absolute scratch directory that owns this install's backups (clone, rollback storage). */
  workDir?: string
  /** Absolute per-plugin workspace (the AI session cwd; custom adapters may use `.venv` inside it). */
  workspaceDir?: string
  /** Optional custom-adapter dependency layer inside workspaceDir (the plugin ".venv"). */
  pluginEnvDir?: string
  /** Resolved git commit, empty for file/npm sources. */
  resolvedCommit: string
  /** Installed steps with their inverse actions, oldest first. Uninstall replays inverses LIFO. */
  steps: StepRecord[]
  /** Whether the original install request allowed pnpm build scripts. */
  allowBuild?: boolean
  /** Rows are turned off: the managed profile patch block carries trailing `{ id, disabled: true }` rows. */
  disabled?: boolean
  /** Change-detection fingerprint of the spec that produced this install. */
  spec: SpecFingerprint
  installedAt: string
  updatedAt: string
}

/** Persisted ledger: one nested map profile -> id -> entry. */
export interface Ledger {
  version: 1
  profiles: Record<string, Record<string, LedgerEntry>>
}

/** One executed step and the inverse that undoes it. */
export interface StepRecord {
  kind: string
  label: string
  /** Parameters of the executed step, for display and uninstall planning. */
  params: Record<string, unknown>
  /** Parameters of the inverse step. */
  inverse: StepSpec
}

/** Declarative step: the forward action is implied by `uses` + fields; `inverse` is the explicit undo. */
export interface StepSpec {
  uses: string
  [key: string]: unknown
}

/** One plugin declared by a requirements file. */
export interface SpecEntry {
  id: string
  source: string
  /** Adapter to use; `auto` probes the source (dsh-bundle when declared, otherwise custom). */
  adapter: 'auto' | 'dsh-bundle' | 'custom'
  /** Adapter directory relative to the requirements file; required for custom adapters. */
  adapterDir: string
  /** Git ref or branch to pin; empty means the remote default branch. */
  ref: string
  /** Allow pnpm build scripts for this source (never auto-approved). */
  allowBuild: boolean
}

/** A requirements file: dependency spec + per-mode plugin lists. */
export interface RequirementsSpec {
  version: 1
  /** Optional git repository root for `sync`; `.` means the file's own directory. */
  repo: string
  /** mode name (profile) -> ordered plugin list. */
  modes: Record<string, SpecEntry[]>
  /** Absolute directory of the parsed file, for resolving adapterDir. */
  baseDir: string
}

/** One reconciliation action computed from spec vs ledger. */
export interface PlanAction {
  action: 'install' | 'uninstall' | 'update' | 'keep' | 'disable' | 'enable'
  profile: string
  id: string
  reason: string
  entry?: SpecEntry
  current?: LedgerEntry
}

/** Fingerprint of a spec entry used for change detection. */
export interface SpecFingerprint {
  source: string
  adapter: string
  adapterDir: string
  ref: string
  allowBuild: boolean
}

/** A line of operation progress, surfaced to CLI and the Web UI. */
export interface OperationLog {
  level: 'info' | 'warn' | 'error'
  message: string
}

/** Persistent package-manager preferences for the requirements repo. */
export interface PackageManagerConfig {
  /** Local directory holding the requirements repo (empty = not configured). */
  storagePath: string
  /** Git remote used to clone/pull the requirements repo (empty = local only). */
  remoteUrl: string
  /** Pull + restore the configured repo automatically when the service mounts. */
  autoSync: boolean
  /**
   * Root for per-plugin AI/custom-adapter workspaces. dsh-bundle installs
   * do not use this directory; empty means
   * `<home>/package-manager/plugin-workspaces`.
   */
  workspaceRoot: string
}

/** A plugin that was turned off: uninstalled but remembered so it can be switched back on. */
export interface DisabledEntry {
  profile: string
  id: string
  source: string
  adapter: 'dsh-bundle' | 'custom'
  adapterDir: string
  ref: string
  allowBuild: boolean
}

export interface ToggleRequest {
  profile: string
  id: string
}

export interface WorkspaceHistoryRequest {
  path: string
}

export interface WorkspaceSwitchRequest {
  /** Workspace root to switch to; empty means the default root. */
  path: string
  dryRun?: boolean
}

/** Read-only state view the Web UI renders. */
export interface ManagerState {
  home: string
  /** Resolved root of per-plugin workspaces (config.workspaceRoot or the default). */
  workspaceRoot: string
  /** Default workspace root used when config.workspaceRoot is empty. */
  workspaceDefault: string
  /** Recently used workspace roots persisted under `<home>/package-manager/runtime`. */
  workspaceHistory: string[]
  /** True while a workspace switch reconciliation is executing. */
  reconciling: boolean
  /** Error from the last workspace switch, empty when the last switch succeeded. */
  switchError: string
  restartNeeded: boolean
  /**
   * True when a bundle with a client face (`dsh.client`) was installed or
   * removed: the host's client-module graph already updated live, but open
   * web tabs must reload to pick the new module table up.
   */
  webRefreshNeeded: boolean
  profiles: ProfileState[]
  entries: LedgerEntry[]
  disabled: DisabledEntry[]
  config: PackageManagerConfig
}

export interface ProfileState {
  name: string
  dir: string
  exists: boolean
  bundles: string[]
  dependencies: string[]
}

/** Parameters for one install request. */
export interface InstallRequest {
  profile: string
  /** Stable id; defaults to a source-derived name when omitted. */
  id?: string
  source: string
  adapter: 'auto' | 'dsh-bundle' | 'custom'
  /** Required when adapter is custom; resolved against the requirements file when restoring. */
  adapterDir?: string
  /**
   * Original requirements-relative adapterDir used for change detection when
   * restore resolved `adapterDir` to an absolute path.
   */
  specAdapterDir?: string
  ref?: string
  allowBuild?: boolean
  dryRun?: boolean
}

export interface UninstallRequest {
  profile: string
  id: string
  dryRun?: boolean
}

export interface RestoreRequest {
  /** Absolute path to requirements.yaml. */
  file: string
  /** Modes to reconcile; empty means every mode listed in the file. */
  modes?: string[]
  dryRun?: boolean
}

export interface SyncRequest {
  /** Local git repository holding the requirements file. */
  repo: string
  /** Requirements file inside the repo, default requirements/deps.yaml. */
  file?: string
  modes?: string[]
  dryRun?: boolean
}

/** Result of scheduling a backend restart. */
export interface RestartResult {
  restarting: boolean
  /** The relaunch command the restarter will run. */
  command: string
  /** Log file the relaunched process appends to. */
  log: string
  /** Restarter process id. */
  pid: number
  /** Port the restarter waits to free before relaunching. */
  port: number
}

export interface AdapterInitRequest {
  source: string
  id: string
  /** Output requirements root (absolute). */
  outDir: string
  /** Mode (profile) to register in deps.yaml; defaults to web. */
  profile?: string
  ref?: string
}

export interface InstallResult {
  profile: string
  id: string
  adapter: string
  packageName: string
  /** Optional custom-adapter dependency layer (`.venv`) for this install. */
  pluginEnvDir: string
  /** Absolute plugin workspace owning the dependency layer. */
  workspaceDir: string
  /** True when the managed cordis.patch.yml block was written; the host watcher applies it live (no restart needed). */
  hotMounted: boolean
  steps: StepRecord[]
  logs: OperationLog[]
  dryRun: boolean
}

export interface RestoreResult {
  file: string
  actions: PlanAction[]
  installed: InstallResult[]
  uninstalled: UninstallResult[]
  updated: InstallResult[]
  logs: OperationLog[]
  dryRun: boolean
}

export interface UninstallResult {
  profile: string
  id: string
  /** True when the managed cordis.patch.yml block was removed; the host watcher unloads the rows live. */
  hotUnmounted: boolean
  steps: StepRecord[]
  logs: OperationLog[]
  dryRun: boolean
}

export interface AdapterInitResult {
  id: string
  adapter: string
  reason: string
  outDir: string
  depsUpdated: boolean
  logs: OperationLog[]
}

/** Adapter probe verdict. */
export interface ProbeResult {
  adapter: 'dsh-bundle' | 'custom'
  reason: string
  packageName?: string
}

/** Context handed to adapters and step execution. */
export interface AdapterContext {
  home: string
  profileDir: string
  /** Per-install scratch directory (clones, downloads, backups). */
  workDir: string
  /** Per-plugin workspace (the AI session cwd; custom adapters may use `.venv`). */
  workspaceDir?: string
  /** Optional custom-adapter dependency layer inside workspaceDir (the plugin ".venv"). */
  pluginEnvDir?: string
  source: string
  ref: string
  log: (level: OperationLog['level'], message: string) => void
}

/** Minimal request from the simplified settings tab: one link, dispatch to AI. */
export interface AiInstallRequest {
  /** Source spec: github:owner/repo, git URL, npm name, or local path. */
  source: string
  /** Target profile; defaults to web (or the first available profile). */
  profile?: string
  /** Optional explicit session id, mostly for tests. */
  sessionId?: string
}

/** Result returned by /pm-api/ai-install. The session is already live and attached. */
export interface AiInstallResult {
  profile: string
  id: string
  source: string
  workspaceId: string
  workspacePath: string
  sessionId: string
  /** First user message sent to the new agent. */
  prompt: string
}

/** Spawn result shared by every runner. */
export interface SpawnResult {
  exitCode: number
  stdout: string
  stderr: string
}
