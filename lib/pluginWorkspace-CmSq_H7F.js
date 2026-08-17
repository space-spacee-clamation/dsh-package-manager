import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
//#region src/paths.ts
/**
* Path resolution for the package manager. Everything lives under the single
* harness home (`$DSH_HOME` or `~/.dsh`), mirroring the harness's own layout:
* profiles stay where `dsh plugin` manages them, while package-manager-owned
* state lives under `<home>/package-manager`.
* @module @dsh-ext/dsh-package-manager/paths
*/
const PROFILES_DIR = "profiles";
const PM_DIR = "package-manager";
const RUNTIME_DIR = "runtime";
const PACKAGE_STORE_DIR = "packages";
const PLUGIN_WORKSPACES_DIR = "plugin-workspaces";
const WORKSPACE_HISTORY_FILENAME = "workspace-history.json";
const LEDGER_FILENAME = "ledger.json";
/** Resolve the harness home, matching dsh-home-paths precedence. */
function resolveHome(env = process.env) {
	const fromEnv = env.DSH_HOME;
	return resolve(fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), ".dsh"));
}
/** Package-manager state root under the harness home. */
function pmRoot(home) {
	return join(home, PM_DIR);
}
/** Ledger file path. */
function ledgerPath(home) {
	return join(pmRoot(home), LEDGER_FILENAME);
}
/** Package-manager runtime state root: history plus per-install scratch. */
function runtimeRoot(home) {
	return join(pmRoot(home), RUNTIME_DIR);
}
/** Per-install scratch root under runtime (rollback backups, work copies). */
function workRoot(home) {
	return join(runtimeRoot(home), "work");
}
/** Centralized package source store under runtime. */
function packageStoreRoot(home) {
	return join(runtimeRoot(home), PACKAGE_STORE_DIR);
}
/** Recently used workspace roots, stored under runtime. */
function workspaceHistoryPath(home) {
	return join(runtimeRoot(home), WORKSPACE_HISTORY_FILENAME);
}
/** Default root for per-plugin workspaces when the user configures none. */
function defaultWorkspaceRoot(home) {
	return join(pmRoot(home), PLUGIN_WORKSPACES_DIR);
}
/** Profile directory under the harness home. */
function profileDir(home, name) {
	assertProfileName(name);
	return join(home, PROFILES_DIR, name);
}
/** Validate a profile name the same way the harness does. */
function assertProfileName(name) {
	if (name === "" || name.includes("/") || name.includes("\\") || name === "." || name === ".." || name === "node_modules") throw new Error(`invalid profile name ${JSON.stringify(name)}`);
}
/** True for an absolute filesystem path (Windows or POSIX). */
function isAbsolutePath(value) {
	return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^[A-Za-z]:$/.test(value);
}
//#endregion
//#region src/pluginWorkspace.ts
/**
* Per-plugin workspace layout: a directory the AI session owns as its cwd.
* dsh-bundle installs do NOT use this directory (they are profile
* dependencies + a cordis.patch.yml managed block); custom adapters may use
* `${DSH_PLUGIN_ENV}` here for their own isolated files. The durable
* workspace manifest is the bridge between the
* filesystem path and the pm_install/pm_scaffold AI tools: tools only act on
* workspaces created by the settings tab, never on arbitrary session cwds.
* @module @dsh-ext/dsh-package-manager/pluginWorkspace
*/
const PLUGIN_ENV_DIRNAME = ".venv";
const WORKSPACE_MANIFEST = "package-manager.json";
/** Lossless path spelling of the id; the manifest always preserves the original id. */
function safePluginId(id) {
	const safe = encodeURIComponent(id);
	return safe.length > 0 ? safe : "plugin";
}
/** `<workspaceRoot>/<profile>/<safe-id>` — the AI session cwd. */
function pluginWorkspaceDir(root, profile, id) {
	assertProfileName(profile);
	return join(root, profile, safePluginId(id));
}
/** `<workspace>/<profile>/<safe-id>/.venv` — optional custom-adapter dependency layer. */
function pluginEnvDir(workspaceDir) {
	return join(workspaceDir, PLUGIN_ENV_DIRNAME);
}
function workspaceManifestPath(workspaceDir) {
	return join(workspaceDir, WORKSPACE_MANIFEST);
}
/** Create the workspace and write the durable link between path and install request. */
function ensurePluginWorkspace(root, profile, id, source) {
	const dir = pluginWorkspaceDir(root, profile, id);
	mkdirSync(dir, { recursive: true });
	const existing = readWorkspaceManifest(dir);
	if (existing === void 0 || existing.source !== source || existing.profile !== profile || existing.id !== id) writeWorkspaceManifest(dir, {
		version: 1,
		profile,
		id,
		source,
		createdAt: existing?.createdAt ?? (/* @__PURE__ */ new Date()).toISOString()
	});
	return dir;
}
function writeWorkspaceManifest(dir, manifest) {
	writeFileSync(workspaceManifestPath(dir), JSON.stringify(manifest, void 0, 2) + "\n");
}
/** Read and validate the workspace manifest; undefined when absent. */
function readWorkspaceManifest(dir) {
	const path = workspaceManifestPath(dir);
	if (!existsSync(path)) return void 0;
	const parsed = JSON.parse(readFileSync(path, "utf8"));
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`plugin workspace manifest ${path} must hold a JSON object`);
	const raw = parsed;
	const { version, profile, id, source } = raw;
	if (version !== 1) throw new Error(`plugin workspace manifest ${path} has an unsupported version`);
	if (typeof profile !== "string" || profile === "") throw new Error(`plugin workspace manifest ${path}: profile must be a non-empty string`);
	if (typeof id !== "string" || id === "") throw new Error(`plugin workspace manifest ${path}: id must be a non-empty string`);
	if (typeof source !== "string" || source === "") throw new Error(`plugin workspace manifest ${path}: source must be a non-empty string`);
	return {
		version: 1,
		profile,
		id,
		source,
		createdAt: typeof raw.createdAt === "string" ? raw.createdAt : ""
	};
}
//#endregion
export { defaultWorkspaceRoot as a, packageStoreRoot as c, resolveHome as d, runtimeRoot as f, readWorkspaceManifest as i, pmRoot as l, workspaceHistoryPath as m, pluginEnvDir as n, isAbsolutePath as o, workRoot as p, pluginWorkspaceDir as r, ledgerPath as s, ensurePluginWorkspace as t, profileDir as u };
