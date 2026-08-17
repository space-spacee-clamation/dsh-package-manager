import { Context, Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";
//#region src/types.d.ts
/**
 * Wire types shared by the package-manager core, adapters, and the Web API.
 * Everything crossing a JSON boundary is a plain serializable value.
 * @module @dsh-ext/dsh-package-manager/types
 */
/** Where a plugin source came from. */
type SourceKind = 'git' | 'file' | 'npm';
/** One installed plugin record, keyed per profile + id inside the ledger. */
interface LedgerEntry {
  /** Stable plugin id, unique inside one profile. */
  id: string;
  /** Profile (mode) this entry is installed into. */
  profile: string;
  /** Absolute profile directory the dependency was linked into. */
  profileDir?: string;
  /** The spec the install was requested with (verbatim, user supplied). */
  source: string;
  sourceKind: SourceKind;
  /** Ref/commit for git sources, empty otherwise. */
  ref: string;
  /** Adapter that produced the install. */
  adapter: 'dsh-bundle' | 'custom';
  /** Absolute adapter directory for custom adapters, empty otherwise. */
  adapterDir: string;
  /** Real npm package name recorded by profile.dependency.add (if any). */
  packageName: string;
  /** Absolute materialized source directory (clone or local copy), empty when the source is a bare npm name. */
  materializedDir: string;
  /** Absolute scratch directory that owns this install's backups (clone, rollback storage). */
  workDir?: string;
  /** Absolute per-plugin workspace (the AI session cwd; custom adapters may use `.venv` inside it). */
  workspaceDir?: string;
  /** Optional custom-adapter dependency layer inside workspaceDir (the plugin ".venv"). */
  pluginEnvDir?: string;
  /** Resolved git commit, empty for file/npm sources. */
  resolvedCommit: string;
  /** Installed steps with their inverse actions, oldest first. Uninstall replays inverses LIFO. */
  steps: StepRecord[];
  /** Whether the original install request allowed pnpm build scripts. */
  allowBuild?: boolean;
  /** Rows are turned off: the managed profile patch block carries trailing `{ id, disabled: true }` rows. */
  disabled?: boolean;
  /** Change-detection fingerprint of the spec that produced this install. */
  spec: SpecFingerprint;
  installedAt: string;
  updatedAt: string;
}
/** Persisted ledger: one nested map profile -> id -> entry. */
interface Ledger {
  version: 1;
  profiles: Record<string, Record<string, LedgerEntry>>;
}
/** One executed step and the inverse that undoes it. */
interface StepRecord {
  kind: string;
  label: string;
  /** Parameters of the executed step, for display and uninstall planning. */
  params: Record<string, unknown>;
  /** Parameters of the inverse step. */
  inverse: StepSpec;
}
/** Declarative step: the forward action is implied by `uses` + fields; `inverse` is the explicit undo. */
interface StepSpec {
  uses: string;
  [key: string]: unknown;
}
/** One plugin declared by a requirements file. */
interface SpecEntry {
  id: string;
  source: string;
  /** Adapter to use; `auto` probes the source (dsh-bundle when declared, otherwise custom). */
  adapter: 'auto' | 'dsh-bundle' | 'custom';
  /** Adapter directory relative to the requirements file; required for custom adapters. */
  adapterDir: string;
  /** Git ref or branch to pin; empty means the remote default branch. */
  ref: string;
  /** Allow pnpm build scripts for this source (never auto-approved). */
  allowBuild: boolean;
}
/** A requirements file: dependency spec + per-mode plugin lists. */
interface RequirementsSpec {
  version: 1;
  /** Optional git repository root for `sync`; `.` means the file's own directory. */
  repo: string;
  /** mode name (profile) -> ordered plugin list. */
  modes: Record<string, SpecEntry[]>;
  /** Absolute directory of the parsed file, for resolving adapterDir. */
  baseDir: string;
}
/** One reconciliation action computed from spec vs ledger. */
interface PlanAction {
  action: 'install' | 'uninstall' | 'update' | 'keep' | 'disable' | 'enable';
  profile: string;
  id: string;
  reason: string;
  entry?: SpecEntry;
  current?: LedgerEntry;
}
/** Fingerprint of a spec entry used for change detection. */
interface SpecFingerprint {
  source: string;
  adapter: string;
  adapterDir: string;
  ref: string;
  allowBuild: boolean;
}
/** A line of operation progress, surfaced to CLI and the Web UI. */
interface OperationLog {
  level: 'info' | 'warn' | 'error';
  message: string;
}
/** Persistent package-manager preferences for the requirements repo. */
interface PackageManagerConfig {
  /** Local directory holding the requirements repo (empty = not configured). */
  storagePath: string;
  /** Git remote used to clone/pull the requirements repo (empty = local only). */
  remoteUrl: string;
  /** Pull + restore the configured repo automatically when the service mounts. */
  autoSync: boolean;
  /**
   * Root for per-plugin AI/custom-adapter workspaces. dsh-bundle installs
   * do not use this directory; empty means
   * `<home>/package-manager/plugin-workspaces`.
   */
  workspaceRoot: string;
}
/** A plugin that was turned off: uninstalled but remembered so it can be switched back on. */
interface DisabledEntry {
  profile: string;
  id: string;
  source: string;
  adapter: 'dsh-bundle' | 'custom';
  adapterDir: string;
  ref: string;
  allowBuild: boolean;
}
interface ToggleRequest {
  profile: string;
  id: string;
}
interface UpdateCheckRequest {
  profile: string;
  id: string;
}
interface UpdateCheckResult {
  profile: string;
  id: string;
  /** Git source only. */
  status: 'up-to-date' | 'updated' | 'not-git';
  /** Previously installed commit, when a git source. */
  previousCommit: string;
  /** Latest remote commit, when a git source. */
  latestCommit: string;
  /** True when a newer commit was installed in the same operation. */
  updated: boolean;
  logs: OperationLog[];
}
interface WorkspaceHistoryRequest {
  path: string;
}
interface WorkspaceSwitchRequest {
  /** Workspace root to switch to; empty means the default root. */
  path: string;
  dryRun?: boolean;
}
/** Read-only state view the Web UI renders. */
/** One plugin fiber discovered live in this DSH process. */
interface LocalPluginInfo {
  /** Plugin display name. */
  name: string;
  /** Cordis fiber id, null once disposed. */
  uid: number | null;
  /** FiberState numeric value. */
  state: number;
  /** True when the fiber is currently ACTIVE. */
  active: boolean;
  /** True when this row was cached from a previous traversal and is not currently mounted. */
  cached: boolean;
  /** True when this row was explicitly released by the package manager. */
  released: boolean;
}
interface LocalPluginToggleRequest {
  name: string;
}
interface ManagerState {
  home: string;
  /** Resolved root of per-plugin workspaces (config.workspaceRoot or the default). */
  workspaceRoot: string;
  /** Default workspace root used when config.workspaceRoot is empty. */
  workspaceDefault: string;
  /** Recently used workspace roots persisted under `<home>/package-manager/runtime`. */
  workspaceHistory: string[];
  /** True while a workspace switch reconciliation is executing. */
  reconciling: boolean;
  /** Error from the last workspace switch, empty when the last switch succeeded. */
  switchError: string;
  /**
   * True when a bundle with a client face (`dsh.client`) was installed or
   * removed: the host's client-module graph already updated live, but open
   * web tabs must reload to pick the new module table up.
   */
  webRefreshNeeded: boolean;
  profiles: ProfileState[];
  entries: LedgerEntry[];
  /** Live non-system plugin fibers observed by the Cordis service; empty in headless core/CLI. */
  localPlugins: LocalPluginInfo[];
  disabled: DisabledEntry[];
  config: PackageManagerConfig;
}
interface ProfileState {
  name: string;
  dir: string;
  exists: boolean;
  bundles: string[];
  dependencies: string[];
}
/** Parameters for one install request. */
interface InstallRequest {
  profile: string;
  /** Stable id; defaults to a source-derived name when omitted. */
  id?: string;
  source: string;
  adapter: 'auto' | 'dsh-bundle' | 'custom';
  /** Required when adapter is custom; resolved against the requirements file when restoring. */
  adapterDir?: string;
  /**
   * Original requirements-relative adapterDir used for change detection when
   * restore resolved `adapterDir` to an absolute path.
   */
  specAdapterDir?: string;
  ref?: string;
  allowBuild?: boolean;
  dryRun?: boolean;
}
interface UninstallRequest {
  profile: string;
  id: string;
  dryRun?: boolean;
}
interface RestoreRequest {
  /** Absolute path to requirements.yaml. */
  file: string;
  /** Modes to reconcile; empty means every mode listed in the file. */
  modes?: string[];
  dryRun?: boolean;
}
interface SyncRequest {
  /** Local git repository holding the requirements file. */
  repo: string;
  /** Requirements file inside the repo, default requirements/deps.yaml. */
  file?: string;
  modes?: string[];
  dryRun?: boolean;
}
interface AdapterInitRequest {
  source: string;
  id: string;
  /** Output requirements root (absolute). */
  outDir: string;
  /** Mode (profile) to register in deps.yaml; defaults to web. */
  profile?: string;
  ref?: string;
}
interface InstallResult {
  profile: string;
  id: string;
  adapter: string;
  packageName: string;
  /** Optional custom-adapter dependency layer (`.venv`) for this install. */
  pluginEnvDir: string;
  /** Absolute plugin workspace owning the dependency layer. */
  workspaceDir: string;
  /** True when the managed cordis.patch.yml block was written; the host watcher applies it live (no restart needed). */
  hotMounted: boolean;
  steps: StepRecord[];
  logs: OperationLog[];
  dryRun: boolean;
}
interface RestoreResult {
  file: string;
  actions: PlanAction[];
  installed: InstallResult[];
  uninstalled: UninstallResult[];
  updated: InstallResult[];
  logs: OperationLog[];
  dryRun: boolean;
}
interface UninstallResult {
  profile: string;
  id: string;
  /** True when the managed cordis.patch.yml block was removed; the host watcher unloads the rows live. */
  hotUnmounted: boolean;
  steps: StepRecord[];
  logs: OperationLog[];
  dryRun: boolean;
}
interface AdapterInitResult {
  id: string;
  adapter: string;
  reason: string;
  outDir: string;
  depsUpdated: boolean;
  logs: OperationLog[];
}
/** Adapter probe verdict. */
interface ProbeResult {
  adapter: 'dsh-bundle' | 'custom';
  reason: string;
  packageName?: string;
}
/** Context handed to adapters and step execution. */
interface AdapterContext {
  home: string;
  profileDir: string;
  /** Per-install scratch directory (clones, downloads, backups). */
  workDir: string;
  /** Per-plugin workspace (the AI session cwd; custom adapters may use `.venv`). */
  workspaceDir?: string;
  /** Optional custom-adapter dependency layer inside workspaceDir (the plugin ".venv"). */
  pluginEnvDir?: string;
  source: string;
  ref: string;
  log: (level: OperationLog['level'], message: string) => void;
}
/** Minimal request from the simplified settings tab: one link, dispatch to AI. */
interface AiInstallRequest {
  /** Source spec: github:owner/repo, git URL, npm name, or local path. */
  source: string;
  /** Target profile; defaults to web (or the first available profile). */
  profile?: string;
  /** Optional explicit session id, mostly for tests. */
  sessionId?: string;
}
/** Result returned by /pm-api/ai-install. The session is already live and attached. */
interface AiInstallResult {
  profile: string;
  id: string;
  source: string;
  workspaceId: string;
  workspacePath: string;
  sessionId: string;
  /** First user message sent to the new agent. */
  prompt: string;
}
/** Spawn result shared by every runner. */
interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
//#endregion
//#region src/hostAsync.d.ts
interface PackageManagerHost {
  readonly name: string;
  pnpm(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult>;
  git(args: string[], cwd: string): Promise<SpawnResult>;
  /** The harness's own profile plugin manager (`dsh plugin`). */
  dsh(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult>;
  shell(command: string, cwd: string, env: Record<string, string>): Promise<SpawnResult>;
}
/** Current-machine adapter. This is the CLI/tests default and the fallback. */
declare class LocalHost implements PackageManagerHost {
  readonly name = "local";
  pnpm(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult>;
  git(args: string[], cwd: string): Promise<SpawnResult>;
  dsh(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult>;
  shell(command: string, cwd: string, env: Record<string, string>): Promise<SpawnResult>;
}
/**
 * Harness execution-world adapter. Resolves executables and spawns through
 * `ctx.subprocess`, falling back to the local host whenever that service is
 * not mounted or a command cannot be resolved in the harness world.
 */
declare class HarnessHost implements PackageManagerHost {
  private readonly ctx;
  private readonly subprocess?;
  private readonly timeouts;
  readonly name: string;
  private readonly fallback;
  constructor(ctx: Context, subprocess?: SubprocessRuntime | undefined, timeouts?: {
    pnpm?: number;
    git?: number;
    dsh?: number;
    shell?: number;
  });
  pnpm(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult>;
  git(args: string[], cwd: string): Promise<SpawnResult>;
  dsh(args: string[], cwd: string, env: Record<string, string>): Promise<SpawnResult>;
  shell(command: string, cwd: string, env: Record<string, string>): Promise<SpawnResult>;
  private timeoutMs;
  private run;
  private runFallback;
}
declare function createHost(ctx?: Context): PackageManagerHost;
//#endregion
//#region src/profile.d.ts
/** One pruned bundle row, reported by {@link healProfiles}. */
interface HealReport {
  profile: string;
  pruned: string[];
  removedLinks: string[];
}
/**
 * Repair a home's profiles so the next `dsh` boot cannot die on bundle
 * resolution: a bundle row whose dependency is absent AND whose package does
 * not resolve from the profile (the `$DSH_HOME/profiles/node_modules` fallback
 * farm keeps in-box bundles resolvable) is pruned, and dangling node_modules
 * links for those names are removed. Template bundle rows are never pruned.
 */
declare function healProfiles(home: string, log?: (level: 'info' | 'warn', message: string) => void): HealReport[];
//#endregion
//#region src/source.d.ts
type GitRunner = (args: string[], cwd: string) => Promise<SpawnResult>;
//#endregion
//#region src/steps.d.ts
/** pnpm invocation seam: tests substitute a fake, production delegates to the host adapter. */
type PnpmRunner = (args: string[], cwd: string, env: Record<string, string>) => Promise<SpawnResult>;
type CommandRunner = (command: string, cwd: string, env: Record<string, string>) => Promise<SpawnResult>;
/** `dsh plugin` invocation seam: the harness's existing profile add/remove tool. */
type DshRunner = (args: string[], cwd: string, env: Record<string, string>) => Promise<SpawnResult>;
//#endregion
//#region src/manager.d.ts
interface PackageManagerOptions {
  home?: string;
  pnpm?: PnpmRunner;
  command?: CommandRunner;
  /** Existing `dsh plugin` add/remove tool; defaults to the process-host adapter. */
  dsh?: DshRunner;
  git?: GitRunner;
  /** Process-host adapter for pnpm/git/dsh/shell; defaults to local or harness execution. */
  host?: PackageManagerHost;
}
declare class PackageManager {
  readonly home: string;
  private readonly executor;
  private readonly git;
  private reconciling;
  /** Serializes profile/ledger mutations; the host runs pnpm without a lock, so install/uninstall/restore must never interleave. */
  private chain;
  private switchError;
  private enqueue;
  constructor(options?: PackageManagerOptions);
  /** Resolved root for per-plugin workspaces (AI session cwd; not a dependency layer). */
  workspaceRoot(): string;
  workspaceDefault(): string;
  pluginWorkspaceDir(profile: string, id: string): string;
  /** Read-only view for the Web UI and CLI. */
  state(): ManagerState;
  clearWebRefreshMarker(): void;
  install(request: InstallRequest): Promise<InstallResult>;
  private installInner;
  uninstall(request: UninstallRequest): Promise<UninstallResult>;
  private uninstallInner;
  restore(request: RestoreRequest): Promise<RestoreResult>;
  private restoreInner;
  /**
   * Repair home state so the next boot cannot die on profile composition:
   * prune unresolvable bundle rows, drop stale ledger records together with
   * their managed hot-reload blocks, and reconcile profile pnpm trees.
   */
  doctor(): Promise<{
    profiles: ReturnType<typeof healProfiles>;
    droppedLedger: string[];
    reconciled: string[];
  }>;
  /**
   * Switch the active requirements root and reconcile the installed set.
   * Modes present in the ledger but absent from the target file are reconciled
   * to an empty desired set; switchable entries are disabled in place, not
   * uninstalled.
   */
  switchWorkspace(path: string, dryRun?: boolean): Promise<RestoreResult>;
  private switchWorkspaceInner;
  private isDisableable;
  private reconcilePlan;
  private resolveWorkspaceInput;
  private workspaceRequirementsFile;
  sync(request: SyncRequest): Promise<RestoreResult>;
  private syncInner;
  getConfig(): PackageManagerConfig;
  setConfig(config: PackageManagerConfig): PackageManagerConfig;
  workspaceHistory(): string[];
  recordWorkspaceHistory(path: string): string[];
  forgetWorkspaceHistory(path: string): string[];
  clearWorkspaceHistory(): string[];
  forgetDisabled(request: ToggleRequest): DisabledEntry | undefined;
  syncConfigured(): Promise<RestoreResult>;
  private syncConfiguredInner;
  /** Check a git-installed plugin for a newer remote commit and install it. */
  checkUpdate(request: UpdateCheckRequest): Promise<UpdateCheckResult>;
  private checkUpdateInner;
  disable(request: ToggleRequest): Promise<UninstallResult>;
  private disableInner;
  enable(request: ToggleRequest): Promise<InstallResult>;
  private enableInner;
  adapterInit(request: AdapterInitRequest): Promise<AdapterInitResult>;
  private resolveAdapter;
  private writeDepsEntry;
  private clearDisabled;
  private adapterVars;
  private workDir;
  /** Anchor local directory sources so `dsh plugin add` never resolves them against the profile dir. */
  private profileSpecFor;
  private webRefreshMarker;
  private touchWebRefresh;
  /**
   * The host's client-modules graph updates live from the loader diff; open
   * web tabs only need a reload. Missing client artifacts are reported instead
   * of failing the install.
   */
  private noteClientFace;
}
/** Create a manager bound to one harness home (CLI / tests seam). */
declare function createPackageManager(options?: PackageManagerOptions): PackageManager;
declare function idFromSource(source: string): string;
//#endregion
//#region src/selfMigration.d.ts
/**
 * One-time self migration: move dsh-package-manager itself from the host-owned
 * `dsh.profile.bundles` layer into its own managed block in the profile's
 * `cordis.patch.yml`. After this file edit the next profile boot mounts this
 * package from the user patch layer, so future source changes can be applied
 * by the official watchUserPatches path.
 */
interface SelfMigrationResult {
  profile: string;
  patchPath: string;
  removedFromBundles: boolean;
  rowIds: string[];
}
declare function migratePackageManagerSelf(home: string, packageManagerDir: string, profile?: string): SelfMigrationResult;
//#endregion
//#region src/index.d.ts
declare const name = "package-manager";
/** Deployment configuration validated by the Loader. */
interface Config {
  /** Explicit harness home; empty means $DSH_HOME / ~/.dsh. */
  home: string;
  /** HTTP prefix of the Web API; the browser half calls the same prefix. */
  apiPrefix: string;
}
declare const Config: z<Config>;
declare module '@deepseek-ai/cordis' {
  interface Context {
    packageManager: PackageManagerService;
  }
}
/** Cordis service wrapping the package manager core. */
declare class PackageManagerService extends Service {
  readonly manager: PackageManager;
  readonly apiPrefix: string;
  readonly home: string;
  private readonly localPluginRegistry;
  constructor(ctx: Context, config: Config);
  state(): ManagerState;
  /** Live non-system plugins discovered from Cordis fibers. */
  localPlugins(): LocalPluginInfo[];
  /** Re-walk Cordis fibers and refresh the cached local-plugin view. */
  refreshLocalPlugins(): LocalPluginInfo[];
  /** Release a non-manager local plugin. */
  releaseLocalPlugin(request: LocalPluginToggleRequest): Promise<LocalPluginInfo>;
  /** Restore a previously released local plugin. */
  restoreLocalPlugin(request: LocalPluginToggleRequest): Promise<LocalPluginInfo>;
  doctor(): Promise<{
    profiles: unknown[];
    droppedLedger: string[];
    reconciled: string[];
  }>;
  install(request: InstallRequest): Promise<InstallResult>;
  uninstall(request: UninstallRequest): Promise<UninstallResult>;
  restore(request: RestoreRequest): Promise<RestoreResult>;
  sync(request: SyncRequest): Promise<RestoreResult>;
  syncConfigured(): Promise<RestoreResult>;
  adapterInit(request: AdapterInitRequest): Promise<AdapterInitResult>;
  checkUpdate(request: UpdateCheckRequest): Promise<UpdateCheckResult>;
  disable(request: ToggleRequest): Promise<UninstallResult>;
  enable(request: ToggleRequest): Promise<InstallResult>;
  forgetDisabled(request: ToggleRequest): DisabledEntry | undefined;
  getConfig(): PackageManagerConfig;
  setConfig(config: PackageManagerConfig): PackageManagerConfig;
  clearWebRefreshMarker(): void;
  workspaceRoot(): string;
  workspaceDefault(): string;
  pluginWorkspaceDir(profile: string, id: string): string;
  workspaceHistory(): string[];
  recordWorkspaceHistory(path: string): string[];
  forgetWorkspaceHistory(path: string): string[];
  clearWorkspaceHistory(): string[];
  /** Switch the active requirements root and reconcile against its requirements file. */
  switchWorkspace(path: string, dryRun?: boolean): Promise<RestoreResult>;
  /** Create an AI session in one plugin workspace and dispatch installation. */
  dispatchAiInstall(request: AiInstallRequest): Promise<AiInstallResult>;
}
/** Mount the service. */
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { type AdapterContext, type AdapterInitRequest, type AdapterInitResult, type AiInstallRequest, type AiInstallResult, Config, type DisabledEntry, HarnessHost, type InstallRequest, type InstallResult, type Ledger, type LedgerEntry, LocalHost, type LocalPluginInfo, type LocalPluginToggleRequest, type ManagerState, type OperationLog, PackageManager, type PackageManagerConfig, type PackageManagerHost, type PackageManagerOptions, PackageManagerService, type PlanAction, type ProbeResult, type ProfileState, type RequirementsSpec, type RestoreRequest, type RestoreResult, type SelfMigrationResult, type SourceKind, type SpawnResult, type SpecEntry, type SpecFingerprint, type StepRecord, type StepSpec, type SyncRequest, type ToggleRequest, type UninstallRequest, type UninstallResult, type UpdateCheckRequest, type UpdateCheckResult, type WorkspaceHistoryRequest, type WorkspaceSwitchRequest, apply, createHost, createPackageManager, idFromSource, migratePackageManagerSelf, name };