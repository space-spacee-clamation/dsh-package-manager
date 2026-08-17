import { a as defaultWorkspaceRoot, c as packageStoreRoot, d as resolveHome, f as workRoot, l as pmRoot, n as pluginEnvDir, o as isAbsolutePath, p as workspaceHistoryPath, r as pluginWorkspaceDir, s as ledgerPath, t as ensurePluginWorkspace, u as profileDir } from "./pluginWorkspace-B3GqfoAA.js";
import { createRequire } from "node:module";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import YAML, { isSeq } from "yaml";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
//#region src/bundlePatch.ts
/**
* Bundle patch parsing for the dsh-bundle hot-plug fast path.
*
* A DSH bundle is a *distribution format*: its `cordis.patch.yml` lists the
* loader entries the profile composition mounts. The package manager writes
* those patch rows into the profile's own `cordis.patch.yml` managed block;
* the host's `watchUserPatches` performs the loader diff. This module only
* parses/normalizes the patch file (`src/profilePatch.ts` writes the block).
* @module @dsh-ext/dsh-package-manager/bundlePatch
*/
/** The loader expression tag used by DSH patch files (`!!js`). */
const jsExprTag$1 = {
	tag: "tag:yaml.org,2002:js",
	resolve(value) {
		return { __jsExpr: value };
	}
};
/** Parse one loader patch list using the same `!!js` dialect as DSH includes. */
function parseBundlePatch(text, path) {
	let parsed;
	try {
		parsed = YAML.parse(text, { customTags: [jsExprTag$1] });
	} catch (error) {
		throw new Error(`bundle patch ${path} is not valid YAML: ${messageOf$5(error)}`);
	}
	if (!Array.isArray(parsed)) throw new Error(`bundle patch ${path} must be a top-level YAML array of loader patch entries`);
	const actions = [];
	const rows = [];
	const rawList = [];
	for (const [index, raw] of parsed.entries()) {
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`bundle patch ${path}[${index}] must be a mapping`);
		const item = raw;
		const insert = item["insert"];
		if (insert !== void 0) {
			if (!Array.isArray(insert)) throw new Error(`bundle patch ${path}[${index}].insert must be a list`);
			const children = insert.map((child, childIndex) => {
				if (child === null || typeof child !== "object" || Array.isArray(child)) throw new Error(`bundle patch ${path}[${index}].insert[${childIndex}] must be a mapping`);
				return child;
			});
			actions.push({
				insert: true,
				rows: children
			});
			rows.push(...children);
			rawList.push(item);
			continue;
		}
		const id = item["id"];
		if (typeof id !== "string" || id === "") throw new Error(`bundle patch ${path}[${index}]: non-insert patches require a string id`);
		actions.push({
			insert: false,
			id,
			fields: item
		});
		rawList.push(item);
	}
	return {
		path,
		actions,
		rows,
		raw: rawList
	};
}
/** Read a bundle package's patch file from its package manifest declaration. */
function loadBundlePatch(packageDir) {
	const manifestPath = join(packageDir, "package.json");
	if (!existsSync(manifestPath)) return void 0;
	const declared = JSON.parse(readFileSync(manifestPath, "utf8")).dsh?.bundle?.patch;
	if (typeof declared !== "string" || declared === "") return void 0;
	const path = join(packageDir, declared);
	if (!existsSync(path)) throw new Error(`bundle patch file not found: ${path}`);
	return parseBundlePatch(readFileSync(path, "utf8"), path);
}
/** Stable fallback id for an inserted row that did not declare one. */
function stablePatchRowId(profile, pluginId, index) {
	return `pm-${safeIdPart(profile)}-${safeIdPart(pluginId)}-${index}`;
}
function safeIdPart(value) {
	const safe = value.replaceAll(/[^A-Za-z0-9._-]/g, "-");
	return safe.length > 0 ? safe : "plugin";
}
function messageOf$5(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/adapters/builtinBundle.ts
/**
* Built-in adapter for standard DSH bundle plugins (packages declaring
* `dsh.bundle.patch`).
*
* The fast path installs the source as one ordinary profile dependency (one
* pnpm run). It does NOT add the package to `dsh.profile.bundles`; instead the
* manager writes the bundle patch rows into the profile's `cordis.patch.yml`
* managed block, which the host's own `watchUserPatches` hot-applies. Removing
* any pre-existing bundle row makes the managed user-layer block the single
* owner, so a restart can never double-compose the same rows.
* @module @dsh-ext/dsh-package-manager/adapters/builtinBundle
*/
const ADAPTER_KIND = "dsh-bundle";
/** Probe a materialized package root for the standard bundle declaration. */
function probeBundleDir(dir) {
	const manifestPath = join(dir, "package.json");
	if (!existsSync(manifestPath)) return {
		adapter: "custom",
		reason: "no package.json at the source root"
	};
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	if (manifest.dsh?.bundle?.patch === void 0) return {
		adapter: "custom",
		reason: `package ${manifest.name ?? "(unnamed)"} declares no dsh.bundle.patch — needs a custom adapter`
	};
	return {
		adapter: ADAPTER_KIND,
		reason: "declares dsh.bundle.patch",
		...manifest.name === void 0 ? {} : { packageName: manifest.name }
	};
}
/** Git-hosted specs whose install runs package build scripts through pnpm. */
function isGitSpec(source) {
	return /^github:|^git\+|^git:|^https?:\/\/(github\.com|gitlab\.|bitbucket\.org)/.test(source) || /\.git(?:#.*)?$/.test(source);
}
/**
* Reject materialized bundle sources that cannot install into a standalone
* profile BEFORE any profile edit happens. Harness monorepo sources use
* `workspace:` dependencies that only resolve inside the monorepo, and a
* malformed or missing patch file would otherwise fail after `pnpm add`
* already mutated the profile.
*/
function validateBundleSource(dir) {
	const manifestPath = join(dir, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const problems = [];
	if (manifest.type !== void 0 && manifest.type !== "module") problems.push(`package ${JSON.stringify(manifest.name ?? "(unnamed)")} declares type ${JSON.stringify(manifest.type)}; bundle patch rows are hot-mounted as ESM (expect type: module)`);
	for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) if (spec.startsWith("workspace:")) {
		problems.push(`dependency ${JSON.stringify(name)} uses ${JSON.stringify(spec)}; workspace: protocol resolves only inside the harness monorepo — install a registry-published or self-contained build of this bundle instead`);
		break;
	}
	const declared = manifest.dsh?.bundle?.patch;
	if (typeof declared === "string" && declared !== "") {
		const patchPath = join(dir, declared);
		if (!existsSync(patchPath)) problems.push(`declared bundle patch file does not exist: ${patchPath}`);
		else try {
			loadBundlePatch(dir);
		} catch (error) {
			problems.push(messageOf$4(error));
		}
	}
	const entryTarget = entryTargetOf(manifest);
	if (entryTarget !== void 0 && !existsSync(join(dir, entryTarget))) problems.push(`declared entrypoint does not exist: ${join(dir, entryTarget)} — build the package (its lib/ output) before installing`);
	return problems;
}
function entryTargetOf(manifest) {
	const root = typeof manifest.exports === "object" && manifest.exports !== null ? manifest.exports["."] : void 0;
	return (typeof root === "string" ? root : root?.default ?? root?.import) ?? manifest.main;
}
function messageOf$4(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* Read the client-face declaration of a materialized bundle. The host's
* client-modules registry serves `./client` (default `lib/client.js`) under
* `/plugins/<id>/client.js` and requires `platform: 'web'`; an unbuilt source
* package lacks that artifact.
*/
function clientFaceOf(dir) {
	const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	const client = manifest.dsh?.client;
	if (client === void 0) return {
		declared: false,
		platformOk: false
	};
	const target = typeof manifest.exports === "object" && manifest.exports !== null ? manifest.exports["./client"] : void 0;
	const rel = typeof target === "string" ? target : target?.default ?? target?.import;
	return {
		declared: true,
		platformOk: client.platform === "web",
		artifactPath: join(dir, rel ?? "lib/client.js")
	};
}
/**
* Install plan for a dsh-bundle plugin: allow-build (when requested), one
* profile dependency add through `dsh plugin`/pnpm, then removal of any
* pre-existing `dsh.profile.bundles` row so the managed `cordis.patch.yml`
* block is the sole owner of the patch rows.
*/
function builtinInstallSteps(options) {
	const specs = [];
	if (options.allowBuild && (isGitSpec(options.source) || options.sourceKind === "npm") && options.packageName !== "") specs.push({
		uses: "profile.allowBuild.add",
		package: options.packageName
	});
	specs.push({
		uses: "profile.dependency.add",
		spec: options.profileSpec,
		...options.packageName === "" ? {} : { packageName: options.packageName }
	});
	if (options.removeBundleRow && options.packageName !== "") specs.push({
		uses: "profile.bundles.removeMany",
		packages: [options.packageName]
	});
	return specs;
}
//#endregion
//#region src/process.ts
/**
* Shared asynchronous process execution. Package-manager operations are I/O
* bound and run inside a long-lived DSH process; `spawnSync` would block the
* event loop (and therefore the Web UI and every other Cordis fiber) for the
* whole pnpm/git run, so all host adapters use this async helper instead.
* @module @dsh-ext/dsh-package-manager/process
*/
const DEFAULT_MAX_BYTES = 4194304;
const KILL_GRACE_MS = 1e3;
/**
* Quote one argument for a Windows `cmd.exe` command line. Bare tokens pass
* through unchanged; anything with spaces or shell metacharacters is
* double-quoted. Joining args into the command string avoids Node's DEP0190
* (args array + shell: true).
*/
function quoteShellArg(arg) {
	if (/^[^\s"&|<>^%!()]+$/.test(arg)) return arg;
	return `"${arg.replaceAll("\"", "\\\"")}"`;
}
/**
* Run one process asynchronously and collect bounded stdout/stderr.
* @throws when the command cannot be started or exceeds its deadline.
*/
function runProcess(command, args, cwd, env, options = {}) {
	return new Promise((resolve, reject) => {
		const shell = options.shell ?? process.platform === "win32";
		const argv = [...args];
		const commandText = shell && argv.length > 0 ? [command, ...argv].map(quoteShellArg).join(" ") : command;
		const child = spawn(commandText, shell ? [] : argv, {
			cwd,
			env: {
				...process.env,
				...env
			},
			shell,
			windowsHide: true,
			stdio: [
				"ignore",
				"pipe",
				"pipe"
			]
		});
		const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk) => {
			if (stdout.length < maxBytes) stdout += chunk.slice(0, maxBytes - stdout.length);
		});
		child.stderr?.on("data", (chunk) => {
			if (stderr.length < maxBytes) stderr += chunk.slice(0, maxBytes - stderr.length);
		});
		const timer = options.timeoutMs === void 0 ? void 0 : setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
		}, options.timeoutMs);
		timer?.unref();
		const settle = (callback) => {
			if (settled) return;
			settled = true;
			if (timer !== void 0) clearTimeout(timer);
			callback();
		};
		child.on("error", (error) => {
			settle(() => {
				if (error.code === "ENOENT") reject(/* @__PURE__ */ new Error(`${command} not found on PATH`));
				else reject(/* @__PURE__ */ new Error(`${command} failed to start: ${String(error.message ?? error)}`));
			});
		});
		child.on("close", (code, signal) => {
			settle(() => {
				if (timedOut) {
					reject(/* @__PURE__ */ new Error(`${command} timed out after ${options.timeoutMs ?? "the configured deadline"}ms`));
					return;
				}
				resolve({
					exitCode: code ?? 1,
					stdout,
					stderr: signal !== null && stderr === "" ? `terminated by ${signal}` : stderr
				});
			});
		});
	});
}
//#endregion
//#region src/profile.ts
/**
* Profile manifest and pnpm-workspace editing. A profile is the harness's own
* directory under <home>/profiles/<name>; the manager writes exactly the files
* `dsh plugin` owns (package.json, cordis.patch.yml, pnpm-workspace.yaml) and
* never invents additional formats.
* @module @dsh-ext/dsh-package-manager/profile
*/
/** Bundles a brand-new profile ships with, mirroring the harness templates. */
const PROFILE_TEMPLATES = {
	web: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"],
	headless: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"]
};
const DEFAULT_PROFILE_BUNDLES = ["@deepseek-ai/dsh-base"];
const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries.\n[]\n`;
const PROFILE_PNPM_WORKSPACE = `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n`;
function profileManifestPath(dir) {
	return join(dir, "package.json");
}
function profilePatchPath(dir) {
	return join(dir, "cordis.patch.yml");
}
function profileWorkspacePath(dir) {
	return join(dir, "pnpm-workspace.yaml");
}
/** Read a profile manifest, throwing a named error on malformed data. */
function readManifest(dir) {
	const path = profileManifestPath(dir);
	let raw;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return {};
	}
	const parsed = JSON.parse(raw);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`profile manifest ${path} must hold a JSON object`);
	return parsed;
}
/** Write a profile manifest as 2-space JSON plus a trailing newline. */
function writeManifest(dir, manifest) {
	writeFileSync(profileManifestPath(dir), JSON.stringify(manifest, void 0, 2) + "\n");
}
/** Read the pnpm workspace settings, or undefined when the file is absent. */
function readWorkspace(dir) {
	const path = profileWorkspacePath(dir);
	if (!existsSync(path)) return void 0;
	const parsed = YAML.parse(readFileSync(path, "utf8"));
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`pnpm workspace ${path} must hold a YAML mapping`);
	return parsed;
}
/** Write pnpm workspace settings as YAML. */
function writeWorkspace(dir, workspace) {
	writeFileSync(profileWorkspacePath(dir), YAML.stringify(workspace));
}
/** Initialize a profile directory; existing files are never touched. */
function ensureProfile(dir, name) {
	mkdirSync(dir, { recursive: true });
	const manifestPath = profileManifestPath(dir);
	if (!existsSync(manifestPath)) writeManifest(dir, {
		name: `dsh-profile-${basename(dir)}`,
		private: true,
		dependencies: {},
		dsh: { profile: { bundles: [...PROFILE_TEMPLATES[name] ?? DEFAULT_PROFILE_BUNDLES] } }
	});
	const patchPath = profilePatchPath(dir);
	if (!existsSync(patchPath)) writeFileSync(patchPath, PROFILE_PATCH_TEMPLATE);
	const workspacePath = profileWorkspacePath(dir);
	if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE);
}
/**
* Resolve a dependency's package root inside a profile's node_modules without
* requiring the package to export ./package.json — the same directory probe
* the harness uses for profile bundles.
* @param dir - profile directory (resolution anchor).
* @param packageName - dependency name (scoped names keep their slash).
* @returns the package root, or undefined when unresolvable.
*/
function resolvePackageDir(dir, packageName) {
	const paths = createRequire(join(dir, "package.json")).resolve.paths(packageName) ?? [];
	for (const searchPath of paths) {
		const candidate = join(searchPath, packageName);
		if (existsSync(join(candidate, "package.json"))) return candidate;
	}
}
/**
* Reconcile `dsh.profile.bundles` against installed dependencies — the add
* half of `dsh plugin`'s policy: a dependency resolving to a package declaring
* `dsh.bundle` joins the layer stack. Removal is deliberately NOT performed
* here: it belongs to recorded inverse steps, so uninstalls stay transactional
* and a hand-maintained bundle row can never be silently dropped.
* @param dir - profile directory.
* @returns the added bundle names.
*/
function reconcileBundles(dir) {
	const manifest = readManifest(dir);
	const dependencies = Object.keys(manifest.dependencies ?? {});
	const bundles = [...manifest.dsh?.profile?.bundles ?? []];
	const added = [];
	for (const packageName of dependencies) {
		if (bundles.includes(packageName)) continue;
		const packageDir = resolvePackageDir(dir, packageName);
		if (packageDir === void 0) continue;
		if (readManifest(packageDir).dsh?.bundle?.patch !== void 0) {
			bundles.push(packageName);
			added.push(packageName);
		}
	}
	const changed = added.length > 0;
	if (changed) {
		manifest.dsh = {
			...manifest.dsh,
			profile: {
				...manifest.dsh?.profile,
				bundles
			}
		};
		writeManifest(dir, manifest);
	}
	return {
		added,
		removed: [],
		changed
	};
}
/**
* Current allowBuilds as package/selector names. pnpm accepts both the
* classic array form and the newer `pkg@version: true` mapping; normalize
* either one to an array here.
*/
function readAllowBuilds(dir) {
	const value = readWorkspace(dir)?.allowBuilds;
	if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
	if (value !== null && typeof value === "object") return Object.keys(value);
	return [];
}
/**
* Replace the allowBuilds set and persist. An object-form source keeps the
* object form (keys map to true); otherwise the classic array form is kept.
*/
function writeAllowBuilds(dir, packages) {
	const workspace = readWorkspace(dir) ?? {
		packages: ["."],
		nodeLinker: "hoisted",
		autoInstallPeers: false
	};
	const next = [...new Set(packages)];
	const current = workspace.allowBuilds;
	if (current !== null && typeof current === "object" && !Array.isArray(current)) {
		const map = {};
		for (const packageName of next) map[packageName] = true;
		workspace.allowBuilds = map;
	} else workspace.allowBuilds = next;
	writeWorkspace(dir, workspace);
}
/**
* Remove a profile node_modules entry for one package when it is a dangling
* link (for example a `link:` dependency whose .venv target was deleted).
* pnpm normally removes these with the dependency, but an interrupted or
* manifest-only removal can strand one; a dangling bundle link poisons the
* next boot's bundle resolution.
*/
function removeDanglingLink(profileDir, packageName) {
	const path = join(profileDir, "node_modules", packageName);
	let stat;
	try {
		stat = lstatSync(path);
	} catch {
		return false;
	}
	if (!stat.isSymbolicLink()) return false;
	if (existsSync(path)) return false;
	rmSync(path, {
		recursive: true,
		force: true
	});
	return true;
}
/**
* Repair a home's profiles so the next `dsh` boot cannot die on bundle
* resolution: a bundle row whose dependency is absent AND whose package does
* not resolve from the profile (the `$DSH_HOME/profiles/node_modules` fallback
* farm keeps in-box bundles resolvable) is pruned, and dangling node_modules
* links for those names are removed. Template bundle rows are never pruned.
*/
function healProfiles(home, log = () => {}) {
	const reports = [];
	for (const name of listProfiles(home)) {
		const dir = profileDir(home, name);
		const manifest = readManifest(dir);
		const dependencies = manifest.dependencies ?? {};
		const bundles = [...manifest.dsh?.profile?.bundles ?? []];
		const template = new Set(PROFILE_TEMPLATES[name] ?? DEFAULT_PROFILE_BUNDLES);
		const pruned = [];
		const removedLinks = [];
		const next = bundles.filter((packageName) => {
			if (template.has(packageName) || dependencies[packageName] !== void 0) return true;
			if (resolvePackageDir(dir, packageName) !== void 0) return true;
			pruned.push(packageName);
			if (removeDanglingLink(dir, packageName)) removedLinks.push(packageName);
			return false;
		});
		if (pruned.length > 0) {
			manifest.dsh = {
				...manifest.dsh,
				profile: {
					...manifest.dsh?.profile,
					bundles: next
				}
			};
			writeManifest(dir, manifest);
			for (const packageName of pruned) log("warn", `pruned unresolvable bundle row ${packageName} from profile ${name} (dependency is gone and the package does not resolve)`);
		}
		reports.push({
			profile: name,
			pruned,
			removedLinks
		});
	}
	return reports;
}
/** All profiles present under a home (directories with a package.json). */
function listProfiles(home) {
	const root = join(home, "profiles");
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true }).filter((dirent) => dirent.isDirectory() && existsSync(join(root, dirent.name, "package.json"))).map((dirent) => dirent.name);
}
//#endregion
//#region src/steps.ts
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
function defaultPnpmRunner() {
	return async (args, cwd, env) => spawnResult("pnpm", args, cwd, env);
}
function defaultCommandRunner() {
	return async (command, cwd, env) => {
		const result = spawnSync(command, {
			cwd,
			env: {
				...process.env,
				...env
			},
			encoding: "utf8",
			shell: process.platform === "win32" ? true : command.includes(" "),
			windowsHide: true
		});
		const status = result.status ?? 1;
		const error = result.error;
		if (error !== void 0) throw new Error(`command failed to start: ${String(error.message ?? error)}`);
		return {
			exitCode: status,
			stdout: String(result.stdout ?? ""),
			stderr: String(result.stderr ?? "")
		};
	};
}
function spawnResult(command, args, cwd, env) {
	const shell = process.platform === "win32";
	const argv = [...args];
	const commandText = shell && argv.length > 0 ? [command, ...argv].map(quoteShellArg).join(" ") : command;
	const result = spawnSync(commandText, shell ? [] : argv, {
		cwd,
		env: {
			...process.env,
			...env
		},
		encoding: "utf8",
		shell,
		windowsHide: true
	});
	const status = result.status ?? 1;
	const error = result.error;
	if (error !== void 0) {
		if (error.code === "ENOENT") throw new Error(`${command} not found on PATH`);
		throw new Error(`${command} failed to start: ${String(error.message ?? error)}`);
	}
	return {
		exitCode: status,
		stdout: String(result.stdout ?? ""),
		stderr: String(result.stderr ?? "")
	};
}
/** All step kinds the declarative adapter DSL accepts. */
const STEP_KINDS = /* @__PURE__ */ new Set([
	"noop",
	"profile.dependency.add",
	"profile.dependency.remove",
	"profile.bundles.add",
	"profile.bundles.remove",
	"profile.bundles.removeMany",
	"profile.bundles.reconcile",
	"profile.bundles.set",
	"profile.allowBuild.add",
	"profile.allowBuild.set",
	"pluginEnv.create",
	"pluginEnv.remove",
	"pluginEnv.restore",
	"pluginEnv.allowBuild.add",
	"pnpm",
	"file.copy",
	"file.write",
	"file.remove",
	"file.restore",
	"command",
	"check"
]);
const STRING_FIELDS = {
	"profile.dependency.add": ["spec"],
	"profile.dependency.remove": ["packageName"],
	"profile.bundles.add": ["package"],
	"profile.bundles.remove": ["package"],
	"profile.allowBuild.add": ["package"],
	"pluginEnv.create": ["path"],
	"pluginEnv.remove": ["path"],
	"pluginEnv.restore": ["backup", "to"],
	"pluginEnv.allowBuild.add": ["dir", "package"],
	"file.copy": ["from", "to"],
	"file.write": ["path", "content"],
	"file.remove": ["path"],
	"file.restore": ["backup", "to"],
	"command": ["run", "unrun"],
	"check": ["run"]
};
/** Validate one declarative step before it ever touches the filesystem. */
function validateStepSpec(spec, where) {
	if (typeof spec.uses !== "string" || !STEP_KINDS.has(spec.uses)) throw new Error(`${where}: unsupported step kind ${JSON.stringify(spec.uses)}`);
	if (spec.uses === "profile.allowBuild.set" || spec.uses === "profile.bundles.set" || spec.uses === "profile.bundles.removeMany") {
		const packages = spec.uses === "profile.allowBuild.set" ? spec.packages : spec.uses === "profile.bundles.set" ? spec.bundles : spec.packages;
		if (!Array.isArray(packages) || packages.some((packageName) => typeof packageName !== "string")) throw new Error(`${where}: ${spec.uses} needs a string array (${spec.uses === "profile.allowBuild.set" ? "packages" : "bundles"})`);
		return;
	}
	if (spec.uses === "pnpm") {
		if (!Array.isArray(spec.args) || spec.args.some((arg) => typeof arg !== "string")) throw new Error(`${where}: pnpm needs a string array field "args"`);
		if (typeof spec.cwd !== "string" || spec.cwd === "") throw new Error(`${where}: pnpm needs string field "cwd"`);
		if (spec.unargs !== void 0 && (!Array.isArray(spec.unargs) || spec.unargs.some((arg) => typeof arg !== "string"))) throw new Error(`${where}: pnpm.unargs must be a string array`);
		return;
	}
	for (const field of STRING_FIELDS[spec.uses] ?? []) if (typeof spec[field] !== "string") throw new Error(`${where}: ${spec.uses} needs string field ${JSON.stringify(field)}`);
	if (spec.uses === "file.copy" && spec.exclude !== void 0 && (!Array.isArray(spec.exclude) || spec.exclude.some((item) => typeof item !== "string"))) throw new Error(`${where}: file.copy.exclude must be a string array`);
	if (spec.uses === "command" || spec.uses === "check") {
		const env = spec.env;
		if (env !== void 0 && (env === null || typeof env !== "object" || Array.isArray(env))) throw new Error(`${where}: ${spec.uses}.env must be a mapping of string values`);
	}
}
/**
* Execute a list of steps inside one install. Steps run in order; each
* executed step becomes a {@link StepRecord} carrying its inverse. Callers
* persist the records in the ledger and call {@link rollback} when any step
* throws — including after a partial install — to restore the previous state.
*/
var StepExecutor = class {
	pnpm;
	command;
	dsh;
	constructor(pnpm = defaultPnpmRunner(), command = defaultCommandRunner(), dsh) {
		this.pnpm = pnpm;
		this.command = command;
		this.dsh = dsh;
	}
	async run(specs, ctx, backupRoot) {
		const records = [];
		mkdirSync(backupRoot, { recursive: true });
		for (let index = 0; index < specs.length; index++) {
			const spec = specs[index];
			if (spec === void 0) continue;
			const record = await this.execute(spec, ctx, join(backupRoot, String(index)));
			records.push(record);
		}
		return records;
	}
	/** Replay recorded inverses LIFO; every failure is reported, none stops the sweep. */
	async rollback(records, ctx, backupRoot) {
		const failures = [];
		for (let index = records.length - 1; index >= 0; index--) {
			const record = records[index];
			if (record === void 0) continue;
			try {
				await this.execute(record.inverse, ctx, join(backupRoot, String(index)));
				ctx.log("info", `rolled back: ${record.label}`);
			} catch (error) {
				failures.push(`${record.label}: ${messageOf$3(error)}`);
				ctx.log("error", `rollback failed: ${record.label}: ${messageOf$3(error)}`);
			}
		}
		if (failures.length > 0) throw new Error(`rollback incomplete: ${failures.join("; ")}`);
	}
	async execute(spec, ctx, backupDir) {
		const base = { kind: spec.uses };
		switch (spec.uses) {
			case "noop": return {
				...base,
				label: "no-op",
				params: {},
				inverse: { uses: "noop" }
			};
			case "profile.dependency.add": {
				const specText = String(spec.spec);
				const before = readManifest(ctx.profileDir).dependencies ?? {};
				const tool = await this.runProfileDependency(["add", specText], ctx);
				const after = readManifest(ctx.profileDir).dependencies ?? {};
				const added = addedDependency(before, after);
				const expected = typeof spec.packageName === "string" ? spec.packageName : "";
				let packageName = added;
				if (packageName === void 0 && expected !== "" && normalizedLinkSpec(after[expected]) === normalizedLinkSpec(specText)) packageName = expected;
				if (packageName === void 0) throw new Error(`${tool} add ${JSON.stringify(specText)} reported success but wrote no dependency`);
				const label = `${tool} add ${specText} (${packageName})`;
				const resolvedSpec = after[packageName];
				return {
					...base,
					label,
					params: {
						spec: specText,
						packageName,
						...resolvedSpec === void 0 ? {} : { resolvedSpec }
					},
					inverse: {
						uses: "profile.dependency.remove",
						packageName
					}
				};
			}
			case "profile.dependency.remove": {
				const packageName = String(spec.packageName);
				const previousSpec = (readManifest(ctx.profileDir).dependencies ?? {})[packageName];
				const tool = await this.runProfileDependency(["remove", packageName], ctx);
				if (removeDanglingLink(ctx.profileDir, packageName)) ctx.log("warn", `removed dangling node_modules link for ${packageName} (its link target no longer exists)`);
				const label = `${tool} remove ${packageName}`;
				return {
					...base,
					label,
					params: { packageName },
					inverse: previousSpec === void 0 ? { uses: "noop" } : {
						uses: "profile.dependency.add",
						spec: previousSpec,
						packageName
					}
				};
			}
			case "profile.bundles.add": {
				const packageName = String(spec.package);
				const manifest = readManifest(ctx.profileDir);
				const bundles = [...manifest.dsh?.profile?.bundles ?? []];
				if (!bundles.includes(packageName)) {
					bundles.push(packageName);
					manifest.dsh = {
						...manifest.dsh,
						profile: {
							...manifest.dsh?.profile,
							bundles
						}
					};
					writeManifest(ctx.profileDir, manifest);
				}
				return {
					...base,
					label: `bundles += ${packageName}`,
					params: { package: packageName },
					inverse: {
						uses: "profile.bundles.remove",
						package: packageName
					}
				};
			}
			case "profile.bundles.removeMany": {
				const packages = spec.packages.map((packageName) => String(packageName));
				const manifest = readManifest(ctx.profileDir);
				const before = [...manifest.dsh?.profile?.bundles ?? []];
				const removed = new Set(packages);
				manifest.dsh = {
					...manifest.dsh,
					profile: {
						...manifest.dsh?.profile,
						bundles: before.filter((name) => !removed.has(name))
					}
				};
				writeManifest(ctx.profileDir, manifest);
				return {
					...base,
					label: `bundles -= [${packages.join(", ")}]`,
					params: { packages },
					inverse: { uses: "noop" }
				};
			}
			case "profile.bundles.remove": {
				const packageName = String(spec.package);
				const manifest = readManifest(ctx.profileDir);
				const bundles = [...manifest.dsh?.profile?.bundles ?? []];
				const index = bundles.indexOf(packageName);
				if (index >= 0) {
					bundles.splice(index, 1);
					manifest.dsh = {
						...manifest.dsh,
						profile: {
							...manifest.dsh?.profile,
							bundles
						}
					};
					writeManifest(ctx.profileDir, manifest);
				}
				return {
					...base,
					label: `bundles -= ${packageName}`,
					params: { package: packageName },
					inverse: {
						uses: "profile.bundles.add",
						package: packageName
					}
				};
			}
			case "profile.bundles.reconcile": {
				const result = reconcileBundles(ctx.profileDir);
				const expected = typeof spec.packageName === "string" && spec.packageName !== "" ? spec.packageName : void 0;
				const ownAdded = expected !== void 0 && result.added.includes(expected);
				return {
					...base,
					label: result.changed ? `bundles reconciled (+${result.added.join(",")})` : "bundles reconciled (no change)",
					params: { added: result.added },
					inverse: ownAdded ? {
						uses: "profile.bundles.remove",
						package: expected
					} : result.added.length > 0 ? {
						uses: "profile.bundles.removeMany",
						packages: result.added
					} : { uses: "noop" }
				};
			}
			case "profile.bundles.set": {
				const bundles = spec.bundles.map((packageName) => String(packageName));
				const before = [...readManifest(ctx.profileDir).dsh?.profile?.bundles ?? []];
				const manifest = readManifest(ctx.profileDir);
				manifest.dsh = {
					...manifest.dsh,
					profile: {
						...manifest.dsh?.profile,
						bundles
					}
				};
				writeManifest(ctx.profileDir, manifest);
				return {
					...base,
					label: `bundles = [${bundles.join(", ")}]`,
					params: {
						bundles,
						before
					},
					inverse: {
						uses: "profile.bundles.set",
						bundles: before
					}
				};
			}
			case "profile.allowBuild.add": {
				const packageName = String(spec.package);
				const before = readAllowBuilds(ctx.profileDir);
				if (!before.includes(packageName)) writeAllowBuilds(ctx.profileDir, [...before, packageName]);
				return {
					...base,
					label: `allowBuilds += ${packageName}`,
					params: {
						package: packageName,
						before
					},
					inverse: {
						uses: "profile.allowBuild.set",
						packages: before
					}
				};
			}
			case "profile.allowBuild.set": {
				const packages = spec.packages.map((packageName) => String(packageName));
				const dir = typeof spec.dir === "string" && spec.dir !== "" ? spec.dir : ctx.profileDir;
				const before = readAllowBuilds(dir);
				writeAllowBuilds(dir, packages);
				return {
					...base,
					label: `allowBuilds = [${packages.join(", ")}]`,
					params: {
						packages,
						before,
						dir
					},
					inverse: {
						uses: "profile.allowBuild.set",
						packages: before,
						dir
					}
				};
			}
			case "pluginEnv.create": {
				const path = String(spec.path);
				mkdirSync(path, { recursive: true });
				return {
					...base,
					label: `create plugin env ${path}`,
					params: { path },
					inverse: {
						uses: "pluginEnv.remove",
						path
					}
				};
			}
			case "pluginEnv.remove": {
				const path = String(spec.path);
				if (!existsSync(path)) return {
					...base,
					label: `remove plugin env ${path} (absent)`,
					params: { path },
					inverse: { uses: "noop" }
				};
				const backup = backupTo(path, backupDir);
				return {
					...base,
					label: `remove plugin env ${path}`,
					params: {
						path,
						backup
					},
					inverse: {
						uses: "pluginEnv.restore",
						backup,
						to: path
					}
				};
			}
			case "pluginEnv.restore": {
				const backup = String(spec.backup);
				const to = String(spec.to);
				if (!existsSync(backup)) throw new Error(`pluginEnv.restore backup is missing: ${backup}`);
				restoreFrom(backup, to);
				return {
					...base,
					label: `restore plugin env ${to}`,
					params: {
						backup,
						to
					},
					inverse: {
						uses: "pluginEnv.remove",
						path: to
					}
				};
			}
			case "pluginEnv.allowBuild.add": {
				const dir = String(spec.dir);
				const packageName = String(spec.package);
				const before = readAllowBuilds(dir);
				if (!before.includes(packageName)) writeAllowBuilds(dir, [...before, packageName]);
				return {
					...base,
					label: `plugin env allowBuilds += ${packageName}`,
					params: {
						dir,
						package: packageName,
						before
					},
					inverse: {
						uses: "profile.allowBuild.set",
						packages: before,
						dir
					}
				};
			}
			case "pnpm": {
				const args = spec.args.map((arg) => String(arg));
				const cwd = String(spec.cwd);
				const unargs = spec.unargs?.map((arg) => String(arg)) ?? [];
				if (args.length > 0) await this.runPnpm(args, cwd, ctx);
				return {
					...base,
					label: `pnpm ${args.join(" ")} (${cwd})`,
					params: {
						args,
						cwd,
						unargs
					},
					inverse: unargs.length === 0 ? { uses: "noop" } : {
						uses: "pnpm",
						args: unargs,
						cwd
					}
				};
			}
			case "file.copy": {
				const from = String(spec.from);
				const to = String(spec.to);
				if (!existsSync(from)) throw new Error(`file.copy source does not exist: ${from}`);
				mkdirSync(dirname(to), { recursive: true });
				const existed = existsSync(to);
				const backup = join(backupDir, "target");
				if (existed) backupTo(to, backupDir);
				const directory = statSync(from).isDirectory();
				if (directory) {
					const exclude = /* @__PURE__ */ new Set([
						".git",
						"node_modules",
						...Array.isArray(spec.exclude) ? spec.exclude.map((item) => String(item)) : []
					]);
					cpSync(from, to, {
						recursive: true,
						force: true,
						filter: (candidate) => !exclude.has(basename(candidate))
					});
				} else cpSync(from, to);
				return {
					...base,
					label: `copy ${directory ? "tree" : "file"} ${from} -> ${to}`,
					params: {
						from,
						to,
						existed,
						directory
					},
					inverse: existed ? {
						uses: "file.restore",
						backup,
						to
					} : {
						uses: "file.remove",
						path: to
					}
				};
			}
			case "file.write": {
				const path = String(spec.path);
				const content = String(spec.content);
				mkdirSync(dirname(path), { recursive: true });
				const existed = existsSync(path);
				const backup = join(backupDir, "target");
				if (existed) backupTo(path, backupDir);
				writeFileSync(path, content);
				return {
					...base,
					label: `write ${path}`,
					params: {
						path,
						existed
					},
					inverse: existed ? {
						uses: "file.restore",
						backup,
						to: path
					} : {
						uses: "file.remove",
						path
					}
				};
			}
			case "file.remove": {
				const path = String(spec.path);
				if (!existsSync(path)) return {
					...base,
					label: `remove ${path} (absent)`,
					params: { path },
					inverse: { uses: "noop" }
				};
				const backup = backupTo(path, backupDir);
				return {
					...base,
					label: `remove ${path}`,
					params: { path },
					inverse: {
						uses: "file.restore",
						backup,
						to: path
					}
				};
			}
			case "file.restore": {
				const backup = String(spec.backup);
				const to = String(spec.to);
				if (!existsSync(backup)) throw new Error(`file.restore backup is missing: ${backup}`);
				restoreFrom(backup, to);
				return {
					...base,
					label: `restore ${to}`,
					params: {
						backup,
						to
					},
					inverse: { uses: "noop" }
				};
			}
			case "command": {
				const run = String(spec.run);
				const unrun = String(spec.unrun);
				const cwd = typeof spec.cwd === "string" ? spec.cwd : ctx.profileDir;
				const env = envOf(spec);
				await this.runCommand(run, cwd, env);
				return {
					...base,
					label: `command: ${run}`,
					params: {
						run,
						unrun,
						cwd,
						env
					},
					inverse: {
						uses: "command",
						run: unrun,
						unrun: run,
						cwd,
						env
					}
				};
			}
			case "check": {
				const run = String(spec.run);
				const cwd = typeof spec.cwd === "string" ? spec.cwd : ctx.profileDir;
				const env = envOf(spec);
				await this.runCommand(run, cwd, env);
				return {
					...base,
					label: `check: ${run}`,
					params: {
						run,
						cwd,
						env
					},
					inverse: { uses: "noop" }
				};
			}
			default: throw new Error(`unsupported step kind ${JSON.stringify(spec.uses)}`);
		}
	}
	/**
	* Apply one profile dependency edit with the harness's existing
	* `dsh plugin add/remove` tool whenever it is available. Standalone `dpm`
	* runs (no `dsh` on PATH) fall back to raw pnpm so the CLI and unit tests
	* keep working outside a DSH installation.
	* @returns the label of the tool that actually performed the edit.
	*/
	async runProfileDependency(args, ctx) {
		if (this.dsh === void 0) {
			await this.runPnpm(args, ctx.profileDir, ctx);
			return "pnpm";
		}
		const profile = basename(ctx.profileDir);
		try {
			const result = await this.dsh([
				"plugin",
				"--profile",
				profile,
				...args
			], ctx.profileDir, {
				PM_PROFILE: ctx.profileDir,
				PM_HOME: ctx.home,
				DSH_HOME: ctx.home
			});
			const dshLabel = `dsh plugin --profile ${profile} ${args.join(" ")}`;
			if (result.exitCode !== 0) {
				const diagnostics = tail(result.stderr || result.stdout);
				if (!isMissingDshResult(result, diagnostics)) throw new Error(`${dshLabel} failed (exit ${result.exitCode}): ${diagnostics}`);
				ctx.log("warn", `dsh plugin is unavailable (${diagnostics || `exit ${result.exitCode}`}); falling back to pnpm for this profile edit`);
				await this.runPnpm(args, ctx.profileDir, ctx);
				return "pnpm";
			}
			ctx.log("info", `${dshLabel} (${ctx.profileDir})`);
			return "dsh plugin";
		} catch (error) {
			if (!isDshMissingError(error)) throw error;
			ctx.log("warn", `dsh plugin is unavailable (${messageOf$3(error)}); falling back to pnpm for this profile edit`);
			await this.runPnpm(args, ctx.profileDir, ctx);
			return "pnpm";
		}
	}
	/** Batch profile dependency edit; one dsh/pnpm invocation for many packages. */
	async runProfileDependencies(action, specs, ctx) {
		if (specs.length === 0) return "noop";
		if (specs.length === 1) return this.runProfileDependency([action, specs[0]], ctx);
		const args = [action, ...specs];
		if (this.dsh === void 0) {
			await this.runPnpm(args, ctx.profileDir, ctx);
			return "pnpm";
		}
		const profile = basename(ctx.profileDir);
		try {
			const result = await this.dsh([
				"plugin",
				"--profile",
				profile,
				...args
			], ctx.profileDir, {
				PM_PROFILE: ctx.profileDir,
				PM_HOME: ctx.home,
				DSH_HOME: ctx.home
			});
			const dshLabel = `dsh plugin --profile ${profile} ${args.join(" ")}`;
			if (result.exitCode !== 0) {
				const diagnostics = tail(result.stderr || result.stdout);
				if (!isMissingDshResult(result, diagnostics)) throw new Error(`${dshLabel} failed (exit ${result.exitCode}): ${diagnostics}`);
				ctx.log("warn", `dsh plugin is unavailable (${diagnostics || `exit ${result.exitCode}`}); falling back to pnpm for this profile edit`);
				await this.runPnpm(args, ctx.profileDir, ctx);
				return "pnpm";
			}
			ctx.log("info", `${dshLabel} (${ctx.profileDir})`);
			return "dsh plugin";
		} catch (error) {
			if (!isDshMissingError(error)) throw error;
			ctx.log("warn", `dsh plugin is unavailable (${messageOf$3(error)}); falling back to pnpm for this profile edit`);
			await this.runPnpm(args, ctx.profileDir, ctx);
			return "pnpm";
		}
	}
	async runPnpm(args, cwd, ctx) {
		const result = await this.pnpm(args, cwd, {
			PM_PROFILE: ctx.profileDir,
			PM_HOME: ctx.home
		});
		if (result.exitCode !== 0) throw new Error(`pnpm ${args.join(" ")} failed (exit ${result.exitCode}): ${tail(result.stderr || result.stdout)}`);
		ctx.log("info", `pnpm ${args.join(" ")} (${cwd})`);
	}
	async runCommand(run, cwd, env) {
		const result = await this.command(run, cwd, env);
		if (result.exitCode !== 0) throw new Error(`command failed (exit ${result.exitCode}): ${run}\n${tail(result.stderr || result.stdout)}`);
	}
	/**
	* Reconcile a profile's pnpm tree with its manifest (`pnpm install`).
	* This removes orphaned store links left behind by previous `link:` or
	* interrupted installs; stale links otherwise poison later adds (pnpm
	* import EPERM when the link target is gone or points into scratch space).
	*/
	async reconcileProfile(ctx) {
		await this.runPnpm(["install"], ctx.profileDir, ctx);
	}
};
/** Compare pnpm-written dependency specs regardless of Windows path separators. */
function normalizedLinkSpec(value) {
	return (value ?? "").replaceAll("\\", "/");
}
/** Find the dependency key a pnpm add created or changed. */
function addedDependency(before, after) {
	for (const [key, value] of Object.entries(after)) if (before[key] !== value) return key;
}
/**
* Move `path` into `backupDir/target` across filesystem boundaries. `rename`
* is preferred; when source and backup live on different drives (EXDEV),
* copy + delete preserves the transaction.
*/
function backupTo(path, backupDir) {
	mkdirSync(backupDir, { recursive: true });
	const backup = join(backupDir, "target");
	try {
		renameSync(path, backup);
	} catch (error) {
		if (error.code !== "EXDEV") throw error;
		cpSync(path, backup, {
			recursive: true,
			force: true
		});
		rmSync(path, {
			recursive: true,
			force: true
		});
	}
	return backup;
}
/** Restore `backup` over `to`, again without assuming both share a drive. */
function restoreFrom(backup, to) {
	mkdirSync(dirname(to), { recursive: true });
	rmSync(to, {
		recursive: true,
		force: true
	});
	try {
		renameSync(backup, to);
	} catch (error) {
		if (error.code !== "EXDEV") throw error;
		cpSync(backup, to, {
			recursive: true,
			force: true
		});
		rmSync(backup, {
			recursive: true,
			force: true
		});
	}
}
function envOf(spec) {
	const raw = spec.env;
	if (raw === void 0) return {};
	const env = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value !== "string") throw new Error(`step env.${key} must be a string`);
		env[key] = value;
	}
	return env;
}
function tail(text) {
	return text.trim().split(/\r?\n/).slice(-12).join("\n");
}
function isMissingDshResult(result, diagnostics) {
	return result.exitCode === 127 || /not recognized as an internal or external command|不是内部或外部命令|command not found|no such file or directory/i.test(diagnostics);
}
function isDshMissingError(error) {
	return /dsh not found on PATH|ENOENT/i.test(messageOf$3(error));
}
function messageOf$3(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/adapters/custom.ts
/**
* Custom adapter: a declarative adapter.yaml beside the requirements file.
* An AI (or a human) authors it once per unusual plugin; from then on install
* and uninstall are plain data the package manager executes transactionally.
* The file's steps use the same vocabulary as the built-in steps, so every
* step still carries its explicit inverse.
* @module @dsh-ext/dsh-package-manager/adapters/custom
*/
const ADAPTER_FILENAME = "adapter.yaml";
const ADAPTER_VARIABLES = {
	DSH_HOME: "home",
	DSH_PROFILE: "profileDir",
	DSH_WORKDIR: "workDir",
	DSH_WORKSPACE: "workspaceDir",
	DSH_PLUGIN_ENV: "pluginEnvDir"
};
/** Load and validate one adapter.yaml. */
function loadCustomAdapter(dir, vars = {}) {
	const path = join(dir, ADAPTER_FILENAME);
	if (!existsSync(path)) throw new Error(`custom adapter directory has no ${ADAPTER_FILENAME}: ${dir}`);
	const parsed = YAML.parse(readFileSync(path, "utf8"));
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`custom adapter ${path} must hold a YAML mapping`);
	const raw = parsed;
	const id = raw.id;
	if (typeof id !== "string" || id === "") throw new Error(`custom adapter ${path}: id must be a non-empty string`);
	const adapter = { id };
	for (const section of [
		"install",
		"uninstall",
		"verify"
	]) {
		const value = raw[section];
		if (value === void 0) continue;
		if (!Array.isArray(value)) throw new Error(`custom adapter ${path}: ${section} must be a list`);
		adapter[section] = value.map((step, index) => {
			if (step === null || typeof step !== "object" || Array.isArray(step)) throw new Error(`custom adapter ${path}: ${section}[${index}] must be a mapping`);
			const spec = { ...step };
			validateStepSpec(spec, `${path}:${section}[${index}]`);
			return resolveStepPaths(spec, dir, vars);
		});
	}
	return adapter;
}
/** Install with a custom adapter: install steps, then verify, rolling back on failure. */
async function runCustomInstall(options, ctx) {
	const steps = options.adapter.install ?? [];
	if (steps.length === 0) throw new Error(`custom adapter ${options.adapter.id} declares no install steps`);
	const records = await options.executor.run(steps, ctx, options.backupRoot);
	try {
		if ((options.adapter.verify?.length ?? 0) > 0) await options.executor.run(options.adapter.verify, ctx, options.backupRoot);
		return records;
	} catch (error) {
		await options.executor.rollback(records, ctx, options.backupRoot);
		throw error;
	}
}
/**
* Expand adapter placeholders (`${DSH_HOME}`, `${DSH_PROFILE}`,
* `${DSH_WORKDIR}`, `${DSH_WORKSPACE}`, `${DSH_PLUGIN_ENV}`) in string fields
* and `env` values. Unknown `${NAME}` placeholders are left untouched so
* shell-owned variables keep working.
*/
function expandStepVariables(spec, vars) {
	const expand = (value) => value.replace(/\$\{([A-Z0-9_]+)\}/g, (token, name) => {
		const field = ADAPTER_VARIABLES[name];
		if (field === void 0) return token;
		const replacement = vars[field];
		if (replacement === void 0) throw new Error(`adapter placeholder ${token} is not available`);
		return replacement;
	});
	const resolved = { ...spec };
	for (const [key, value] of Object.entries(resolved)) if (typeof value === "string") resolved[key] = expand(value);
	const env = resolved.env;
	if (env !== null && typeof env === "object" && !Array.isArray(env)) {
		for (const [key, value] of Object.entries(env)) if (typeof value === "string") env[key] = expand(value);
	}
	return resolved;
}
/**
* Anchor relative filesystem references to the adapter directory, so an
* adapter can live in git and still address its bundled files portably.
* Placeholders are expanded first, so `${DSH_HOME}`-style absolute paths pass
* through untouched.
*/
function resolveStepPaths(spec, baseDir, vars = {}) {
	const resolved = expandStepVariables(spec, vars);
	for (const field of [
		"from",
		"to",
		"backup",
		"path"
	]) {
		const value = resolved[field];
		if (typeof value === "string" && !isAbsolute(value) && value !== "") resolved[field] = resolve(baseDir, value);
	}
	if (typeof resolved.cwd === "string" && !isAbsolute(resolved.cwd)) resolved.cwd = resolve(baseDir, resolved.cwd);
	return resolved;
}
/** The scaffold an AI or human fills in for a plugin the built-in adapter cannot cover. */
function scaffoldCustomAdapter(dir, id, reason) {
	const adapter = {
		id,
		install: [{
			uses: "file.copy",
			from: `\${DSH_WORKDIR}/source/README.md`,
			to: `\${DSH_PLUGIN_ENV}/README.md`
		}, {
			uses: "command",
			run: `# TODO: installer command`,
			unrun: `# TODO: uninstaller command`
		}],
		verify: [{
			uses: "check",
			run: `# TODO: verify the plugin is installed (exit 0 = ok)`
		}],
		uninstall: []
	};
	const path = join(dir, ADAPTER_FILENAME);
	writeFileSync(path, `# Custom adapter for "${id}".\n# Generated scaffold — fill in the steps; every step keeps its inverse.\n#\n# probe verdict: ${reason}\n# See docs/adapter-spec.md for the step vocabulary.\n\n${YAML.stringify(adapter)}\n`);
	return adapter;
}
//#endregion
//#region src/ledger.ts
/**
* Durable ledger of installed plugins. The ledger is the runtime's memory of
* "what this machine actually did": every entry stores the ordered steps that
* installed it, each carrying its inverse, so uninstall is a LIFO replay of
* inverses rather than a second, independently-authored removal procedure.
* @module @dsh-ext/dsh-package-manager/ledger
*/
function emptyLedger() {
	return {
		version: 1,
		profiles: {}
	};
}
function loadLedger(home) {
	const path = ledgerPath(home);
	let raw;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return emptyLedger();
	}
	const parsed = JSON.parse(raw);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`package-manager ledger ${path} must hold a JSON object`);
	const ledger = parsed;
	if (ledger.version !== 1 || ledger.profiles === null || typeof ledger.profiles !== "object" || Array.isArray(ledger.profiles)) throw new Error(`package-manager ledger ${path} has an unsupported shape (expected version 1)`);
	return ledger;
}
/** Atomic save: write a sibling temp file, then rename over the ledger. */
function saveLedger(home, ledger) {
	const path = ledgerPath(home);
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, JSON.stringify(ledger, void 0, 2) + "\n");
	renameSync(temp, path);
}
function getEntry(ledger, profile, id) {
	return ledger.profiles[profile]?.[id];
}
function setEntry(ledger, entry) {
	const bucket = ledger.profiles[entry.profile] ?? (ledger.profiles[entry.profile] = {});
	bucket[entry.id] = entry;
}
function removeEntry(ledger, profile, id) {
	const bucket = ledger.profiles[profile];
	if (bucket === void 0) return void 0;
	const entry = bucket[id];
	if (entry === void 0) return void 0;
	delete bucket[id];
	return entry;
}
function listEntries(ledger) {
	return Object.values(ledger.profiles).flatMap((entries) => Object.values(entries));
}
/**
* Installed-truth check for one entry. The profile manifest dependency list
* is the host's authoritative plugin state, so an entry whose recorded profile
* dependency vanished (for example the user removed it with the host CLI) is
* no longer installed.
*
* dsh-bundle entries check their packageName. Custom-adapter entries check
* the packageNames recorded by their `profile.dependency.add` steps; a custom
* entry that recorded no profile dependency (for example one that only copies
* files into the home) stays effective — its truth lives outside the profile.
*/
function isEntryEffective(home, entry) {
	let manifest;
	try {
		manifest = readManifest(entry.profileDir ?? profileDir(home, entry.profile));
	} catch {
		return true;
	}
	const dependencies = manifest.dependencies ?? {};
	const dependencyNames = entry.adapter === "dsh-bundle" && entry.packageName !== "" ? [entry.packageName] : entry.steps.filter((step) => step.kind === "profile.dependency.add").map((step) => step.params["packageName"]).filter((name) => typeof name === "string" && name !== "");
	if (dependencyNames.length === 0) return true;
	return dependencyNames.some((name) => dependencies[name] !== void 0);
}
/**
* Read view of the ledger reconciled against profile manifests: stale
* dsh-bundle entries are filtered out so restore/state never report plugins
* the host no longer has installed. The disk ledger is not modified.
*/
function loadEffectiveLedger(home) {
	const ledger = loadLedger(home);
	const effective = {
		version: 1,
		profiles: {}
	};
	for (const [profile, bucket] of Object.entries(ledger.profiles)) {
		const entries = Object.values(bucket).filter((entry) => entry !== void 0 && isEntryEffective(home, entry));
		if (entries.length === 0) continue;
		effective.profiles[profile] = Object.fromEntries(entries.map((entry) => [entry.id, entry]));
	}
	return effective;
}
//#endregion
//#region src/hostAsync.ts
function shellDiagnostic(host, mode) {
	return `[pm-shell: host=${host} mode=${mode} platform=${process.platform} ComSpec=${process.env.ComSpec ?? "-"} TMP=${tmpdir()}] `;
}
const COLLECT_BYTES = 4194304;
const GRACE_MS = 6e4;
const DEFAULT_PNPM_TIMEOUT_MS = 6e5;
const DEFAULT_GIT_TIMEOUT_MS = 12e4;
const DEFAULT_DSH_TIMEOUT_MS = 3e5;
const DEFAULT_SHELL_TIMEOUT_MS = 3e5;
/** Git must fail instead of waiting for credential prompts nobody can answer. */
const GIT_SAFE_ENV = {
	GIT_TERMINAL_PROMPT: "0",
	GCM_INTERACTIVE: "never"
};
/** Current-machine adapter. This is the CLI/tests default and the fallback. */
var LocalHost = class {
	name = "local";
	async pnpm(args, cwd, env) {
		return localSpawn("pnpm", args, cwd, env, DEFAULT_PNPM_TIMEOUT_MS);
	}
	async git(args, cwd) {
		return localSpawn("git", args, cwd, GIT_SAFE_ENV, DEFAULT_GIT_TIMEOUT_MS);
	}
	async dsh(args, cwd, env) {
		if (!commandAvailable("dsh")) throw new Error("dsh not found on PATH");
		return localSpawn("dsh", args, cwd, env, DEFAULT_DSH_TIMEOUT_MS);
	}
	async shell(command, cwd, env) {
		const result = await runProcess(command, [], cwd, env, {
			timeoutMs: DEFAULT_SHELL_TIMEOUT_MS,
			shell: process.platform === "win32" || command.includes(" ")
		});
		return result.exitCode === 0 ? result : {
			...result,
			stderr: shellDiagnostic(this.name, "runProcess shell:" + String(process.platform === "win32" || command.includes(" "))) + result.stderr
		};
	}
};
/**
* Harness execution-world adapter. Resolves executables and spawns through
* `ctx.subprocess`, falling back to the local host whenever that service is
* not mounted or a command cannot be resolved in the harness world.
*/
var HarnessHost = class {
	ctx;
	subprocess;
	timeouts;
	name;
	fallback = new LocalHost();
	constructor(ctx, subprocess, timeouts = {}) {
		this.ctx = ctx;
		this.subprocess = subprocess;
		this.timeouts = timeouts;
		this.name = subprocess === void 0 ? "local (subprocess unavailable)" : "harness subprocess";
	}
	async pnpm(args, cwd, env) {
		return this.run(["pnpm", ...args], cwd, env, "pnpm");
	}
	async git(args, cwd) {
		return this.run(["git", ...args], cwd, GIT_SAFE_ENV, "git");
	}
	async dsh(args, cwd, env) {
		return this.run(["dsh", ...args], cwd, env, "dsh");
	}
	async shell(command, cwd, env) {
		if (process.platform === "win32") {
			const bat = join(tmpdir(), `dsh-pm-${process.pid}-${Math.random().toString(36).slice(2)}.cmd`);
			writeFileSync(bat, `@echo off\r\n${command}\r\n`);
			try {
				return await this.run([
					process.env.ComSpec ?? "cmd.exe",
					"/d",
					"/s",
					"/c",
					bat
				], cwd, env, "shell");
			} finally {
				try {
					unlinkSync(bat);
				} catch {}
			}
		}
		const result = await this.run([
			"/bin/sh",
			"-c",
			command
		], cwd, env, "shell");
		return result.exitCode === 0 ? result : {
			...result,
			stderr: shellDiagnostic(this.name, "sh -c") + result.stderr
		};
	}
	timeoutMs(capability) {
		if (capability === "pnpm") return this.timeouts.pnpm ?? 6e5;
		if (capability === "git") return this.timeouts.git ?? 12e4;
		if (capability === "dsh") return this.timeouts.dsh ?? 3e5;
		return this.timeouts.shell ?? 3e5;
	}
	async run(argv, cwd, env, capability) {
		if (this.subprocess === void 0) return this.runFallback(capability, argv, cwd, env);
		const timeoutMs = this.timeoutMs(capability);
		try {
			const executable = await withDeadline(this.subprocess.resolveExecutable(argv[0] ?? "", env), timeoutMs, `${capability} executable resolution`);
			return await withProcessDeadline(this.subprocess.spawn({
				argv: [executable, ...argv.slice(1)],
				cwd,
				env,
				graceMs: GRACE_MS,
				stdio: {
					stdin: "ignore",
					stdout: { maxBytes: COLLECT_BYTES },
					stderr: { maxBytes: COLLECT_BYTES }
				}
			}), timeoutMs, `${capability} ${argv.slice(1).join(" ")}`);
		} catch (error) {
			if (isTimeoutError(error)) throw error;
			return this.runFallback(capability, argv, cwd, env);
		}
	}
	runFallback(capability, argv, cwd, env) {
		if (capability === "pnpm") return this.fallback.pnpm(argv.slice(1), cwd, env);
		if (capability === "git") return this.fallback.git(argv.slice(1), cwd);
		if (capability === "dsh") return this.fallback.dsh(argv.slice(1), cwd, env);
		return this.fallback.shell(commandOf(argv), cwd, env);
	}
};
function createHost(ctx) {
	if (ctx === void 0) return new LocalHost();
	return new HarnessHost(ctx, ctx.get("subprocess"));
}
function commandAvailable(command) {
	if (process.platform === "win32") {
		const where = spawnSync("where", [command], {
			encoding: "utf8",
			windowsHide: true
		});
		if (where.status === 0) return where.stdout.toLowerCase().includes(command.toLowerCase());
		const direct = spawnSync(command, ["--version"], {
			encoding: "utf8",
			windowsHide: true
		});
		return direct.error === void 0 || direct.error.code !== "ENOENT";
	}
	const which = spawnSync("command", ["-v", command], { encoding: "utf8" });
	return which.status === 0 && which.stdout.trim() !== "";
}
function localSpawn(command, args, cwd, env, timeoutMs = 3e5) {
	return runProcess(command, args, cwd, env, { timeoutMs });
}
var TimeoutError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "TimeoutError";
	}
};
async function withDeadline(task, timeoutMs, label) {
	let timer;
	try {
		return await Promise.race([task, new Promise((_, reject) => {
			timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
		})]);
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
async function withProcessDeadline(handle, timeoutMs, label) {
	let timer;
	try {
		const timeout = new Promise((_, reject) => {
			timer = setTimeout(() => {
				handle.terminate();
				reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`));
			}, timeoutMs);
		});
		return {
			exitCode: (await Promise.race([handle.done, timeout])).exitCode ?? 1,
			stdout: handle.collected.stdout?.readFrom(0).text ?? "",
			stderr: handle.collected.stderr?.readFrom(0).text ?? ""
		};
	} finally {
		if (timer !== void 0) clearTimeout(timer);
	}
}
function isTimeoutError(error) {
	return error instanceof TimeoutError;
}
/**
* Recover the shell command from a harness-shell argv so the local fallback
* can run it. The win32 shape is `[ComSpec, '/d', '/s', '/c', batPath]` — the
* bat path sits at argv[4]; argv[3] is the literal `/c` flag and must NOT be
* joined into the command (cmd would then treat `/c` as the program name).
*/
function commandOf(argv) {
	if (process.platform === "win32") return argv[4] ?? "";
	return argv[2] ?? "";
}
//#endregion
//#region src/packageStore.ts
/**
* Centralized package store under `<home>/package-manager/runtime/packages`.
* Git sources are mirrored once per normalized URL; per-install work
* directories then clone from the local mirror, so installing the same plugin
* into several workspace roots does not clone it from the remote every time.
* File sources are snapshotted once per recursive content fingerprint.
* @module @dsh-ext/dsh-package-manager/packageStore
*/
/**
* GitHub's pack negotiation intermittently fails for repositories with very
* large binary objects. HTTP/1.1, a large post buffer, and disabled wire
* compression make fetch-pack complete reliably in local git installs.
*/
const GIT_FETCH_CONFIG = [
	"-c",
	"http.version=HTTP/1.1",
	"-c",
	"http.postBuffer=524288000",
	"-c",
	"core.compression=0"
];
function cloneArgs(prefix, bare, url, destination, targetRef) {
	const args = [
		...GIT_FETCH_CONFIG,
		prefix,
		"--quiet",
		"--depth",
		"1"
	];
	if (bare) args.push("--bare");
	if (targetRef !== "" && targetRef.toLowerCase() !== "main") args.push("--branch", targetRef);
	args.push(url, destination);
	return args;
}
function shallowCloneArgs(url, destination, targetRef) {
	return cloneArgs("clone", false, url, destination, targetRef);
}
function keyOf(value) {
	return createHash("sha1").update(value).digest("hex").slice(0, 24);
}
function gitMirrorPath(packageRoot, url) {
	return join(packageRoot, "git", `${keyOf(url)}.git`);
}
function fileSnapshotPath(packageRoot, key) {
	return join(packageRoot, "files", `${key}.snapshot`);
}
/** Stable recursive fingerprint: path, per-file mtime, and size. */
function fingerprintFileSource(sourcePath) {
	const hash = createHash("sha1");
	hash.update(sourcePath);
	const walk = (dir, prefix) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const childPath = join(dir, entry.name);
			const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isDirectory()) {
				hash.update(`D:${rel}\u0000`);
				walk(childPath, rel);
			} else if (entry.isFile() || entry.isSymbolicLink()) {
				const stat = statSync(childPath);
				hash.update(`F:${rel}\u0000${stat.mtimeMs}\u0000${stat.size}\u0000`);
			}
		}
	};
	walk(sourcePath, "");
	return hash.digest("hex").slice(0, 24);
}
function gitError(label, result) {
	return /* @__PURE__ */ new Error(`${label} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
}
function removeQuietly(path) {
	try {
		rmSync(path, {
			recursive: true,
			force: true
		});
	} catch {}
}
const mirrorLocks = /* @__PURE__ */ new Map();
/** Publish one mirror at a time; concurrent installs share the same clone. */
async function ensureGitMirror(mirror, url, targetRef, git) {
	const pending = mirrorLocks.get(mirror);
	if (pending !== void 0) {
		await pending;
		return;
	}
	if (existsSync(mirror)) return;
	const task = (async () => {
		if (existsSync(mirror)) return;
		try {
			const clone = await git(cloneArgs("clone", true, url, mirror, targetRef), dirname(mirror));
			if (clone.exitCode !== 0) throw gitError("git mirror clone", clone);
		} catch (error) {
			removeQuietly(mirror);
			throw error;
		}
	})();
	mirrorLocks.set(mirror, task);
	try {
		await task;
	} finally {
		if (mirrorLocks.get(mirror) === task) mirrorLocks.delete(mirror);
	}
}
/**
* Clone one git source into `destination` through the local mirror cache.
* If the mirror is missing, create it from the remote. If a local clone fails
* (for example the mirror is stale and lacks a newly published branch), update
* the mirror once and retry. Full-SHA requests are handled by the caller with
* a direct clone because arbitrary SHAs are usually not fetched by a mirror.
*/
async function cloneGitFromStore(packageRoot, url, targetRef, git, destination) {
	mkdirSync(dirname(destination), { recursive: true });
	const mirror = gitMirrorPath(packageRoot, url);
	mkdirSync(dirname(mirror), { recursive: true });
	try {
		await ensureGitMirror(mirror, url, targetRef, git);
	} catch (mirrorError) {
		return cloneDirect(url, targetRef, git, destination, mirrorError instanceof Error ? mirrorError : new Error(String(mirrorError)));
	}
	const cloneArgs = ["clone", "--quiet"];
	if (targetRef !== "") cloneArgs.push("--branch", targetRef);
	cloneArgs.push(mirror, destination);
	removeQuietly(destination);
	if ((await git(cloneArgs, dirname(destination))).exitCode === 0) return {
		dir: destination,
		resolvedCommit: await resolveCommit(destination, git)
	};
	const update = await refreshGitMirror(mirror, targetRef, git);
	if (update.exitCode !== 0) {
		removeQuietly(mirror);
		return cloneDirect(url, targetRef, git, destination, gitError("git mirror update", update));
	}
	removeQuietly(destination);
	const retry = await git(cloneArgs, dirname(destination));
	if (retry.exitCode === 0) return {
		dir: destination,
		resolvedCommit: await resolveCommit(destination, git)
	};
	removeQuietly(mirror);
	return cloneDirect(url, targetRef, git, destination, gitError("git clone from package store", retry));
}
/** One shallow, branch-scoped remote fetch for a stale/corrupt mirror. */
async function refreshGitMirror(mirror, targetRef, git) {
	const args = [
		...GIT_FETCH_CONFIG,
		"fetch",
		"--depth",
		"1",
		"--prune",
		"origin"
	];
	if (targetRef !== "") args.push(targetRef);
	return git(args, mirror);
}
/**
* Force-sync one git mirror from the remote. Update checks call this before
* installing so a successful check never clones a stale mirror back.
*/
async function syncGitMirror(packageRoot, url, targetRef, git) {
	const mirror = gitMirrorPath(packageRoot, url);
	mkdirSync(dirname(mirror), { recursive: true });
	if (!existsSync(mirror)) {
		await ensureGitMirror(mirror, url, targetRef, git);
		return;
	}
	const result = await refreshGitMirror(mirror, targetRef, git);
	if (result.exitCode !== 0) throw gitError("git mirror update", result);
}
async function cloneDirect(url, targetRef, git, destination, mirrorError) {
	removeQuietly(destination);
	const clone = await git(shallowCloneArgs(url, destination, targetRef), dirname(destination));
	if (clone.exitCode !== 0) throw new Error(`${mirrorError.message}; direct clone fallback failed: ${gitError("git clone", clone).message}`);
	return {
		dir: destination,
		resolvedCommit: await resolveCommit(destination, git)
	};
}
async function resolveCommit(destination, git) {
	const rev = await git(["rev-parse", "HEAD"], destination);
	if (rev.exitCode !== 0) throw gitError("git rev-parse", rev);
	return rev.stdout.trim();
}
/**
* Return a stable central snapshot for a file source. Snapshots are content
* addressed by resolved path + recursive file mtimes and sizes; when the
* source changes, a new snapshot is created and old snapshots remain available for
* already-installed ledgers to keep working.
*/
function snapshotFileSource(packageRoot, sourcePath) {
	const snapshot = fileSnapshotPath(packageRoot, fingerprintFileSource(sourcePath));
	if (existsSync(snapshot)) return snapshot;
	mkdirSync(dirname(snapshot), { recursive: true });
	const temp = `${snapshot}.${process.pid}.${Date.now()}.tmp`;
	rmSync(temp, {
		recursive: true,
		force: true
	});
	cpSync(sourcePath, temp, {
		recursive: true,
		force: true
	});
	try {
		renameSync(temp, snapshot);
	} catch (error) {
		rmSync(temp, {
			recursive: true,
			force: true
		});
		if (!existsSync(snapshot)) throw error;
	}
	return snapshot;
}
//#endregion
//#region src/config.ts
/**
* Package-manager preferences and disabled-plugin memory. These are small,
* user-visible JSON files under `<home>/package-manager`: `config.json` keeps
* the configured requirements repo (local storage path + remote URL + auto
* sync), and `disabled.json` remembers plugins that were switched off so the
* settings UI can switch them back on.
* @module @dsh-ext/dsh-package-manager/config
*/
const CONFIG_FILENAME = "config.json";
const DISABLED_FILENAME = "disabled.json";
const DEFAULT_PACKAGE_CONFIG = {
	storagePath: "",
	remoteUrl: "",
	autoSync: false,
	workspaceRoot: ""
};
function configPath(home) {
	return join(pmRoot(home), CONFIG_FILENAME);
}
function disabledPath(home) {
	return join(pmRoot(home), DISABLED_FILENAME);
}
/** Normalize and validate a config object; throws on malformed values. */
function normalizeConfig(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("package-manager config must be a JSON object");
	const raw = value;
	const storagePath = raw.storagePath;
	const remoteUrl = raw.remoteUrl;
	const autoSync = raw.autoSync;
	const workspaceRoot = raw.workspaceRoot;
	if (typeof storagePath !== "string") throw new Error("package-manager config: storagePath must be a string");
	if (typeof remoteUrl !== "string") throw new Error("package-manager config: remoteUrl must be a string");
	if (typeof autoSync !== "boolean") throw new Error("package-manager config: autoSync must be a boolean");
	if (workspaceRoot !== void 0 && typeof workspaceRoot !== "string") throw new Error("package-manager config: workspaceRoot must be a string");
	return {
		storagePath,
		remoteUrl,
		autoSync,
		workspaceRoot: workspaceRoot ?? ""
	};
}
/** Read the manager config, returning defaults when no file exists yet. */
function loadConfig(home) {
	let raw;
	try {
		raw = readFileSync(configPath(home), "utf8");
	} catch {
		return { ...DEFAULT_PACKAGE_CONFIG };
	}
	const config = normalizeConfig(JSON.parse(raw));
	return {
		...DEFAULT_PACKAGE_CONFIG,
		...config
	};
}
/** Atomically persist the manager config. */
function saveConfig(home, value) {
	const config = normalizeConfig(value);
	const path = configPath(home);
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, JSON.stringify(config, void 0, 2) + "\n");
	renameSync(temp, path);
	return config;
}
/** Parse one disabled entry with strict field checks. */
function parseDisabledEntry(value, where) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`package-manager disabled store: ${where} must be a JSON object`);
	const { profile, id, source, adapter, adapterDir, ref, allowBuild } = value;
	if (typeof profile !== "string" || profile === "") throw new Error(`package-manager disabled store: ${where}.profile must be a non-empty string`);
	if (typeof id !== "string" || id === "") throw new Error(`package-manager disabled store: ${where}.id must be a non-empty string`);
	if (typeof source !== "string" || source === "") throw new Error(`package-manager disabled store: ${where}.source must be a non-empty string`);
	if (adapter !== "dsh-bundle" && adapter !== "custom") throw new Error(`package-manager disabled store: ${where}.adapter must be dsh-bundle or custom`);
	if (typeof adapterDir !== "string") throw new Error(`package-manager disabled store: ${where}.adapterDir must be a string`);
	if (typeof ref !== "string") throw new Error(`package-manager disabled store: ${where}.ref must be a string`);
	if (typeof allowBuild !== "boolean") throw new Error(`package-manager disabled store: ${where}.allowBuild must be a boolean`);
	return {
		profile,
		id,
		source,
		adapter,
		adapterDir,
		ref,
		allowBuild
	};
}
/** Read disabled entries, returning an empty list when no file exists yet. */
function loadDisabled(home) {
	let raw;
	try {
		raw = readFileSync(disabledPath(home), "utf8");
	} catch {
		return [];
	}
	const parsed = JSON.parse(raw);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`package-manager disabled store ${disabledPath(home)} must hold a JSON object`);
	const store = parsed;
	if (store.version !== 1 || store.entries === void 0 || !Array.isArray(store.entries)) throw new Error(`package-manager disabled store ${disabledPath(home)} has an unsupported shape (expected version 1)`);
	return store.entries.map((entry, index) => parseDisabledEntry(entry, `entries[${index}]`));
}
/** Atomically persist the disabled list. */
function saveDisabled(home, entries) {
	const path = disabledPath(home);
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, JSON.stringify({
		version: 1,
		entries
	}, void 0, 2) + "\n");
	renameSync(temp, path);
}
/** Add or replace the disabled record for one profile/id. */
function upsertDisabledEntry(home, entry) {
	const entries = loadDisabled(home);
	const index = entries.findIndex((item) => item.profile === entry.profile && item.id === entry.id);
	if (index >= 0) entries[index] = entry;
	else entries.push(entry);
	saveDisabled(home, entries);
}
/** Remove and return the disabled record for one profile/id, if any. */
function removeDisabledEntry(home, profile, id) {
	const entries = loadDisabled(home);
	const index = entries.findIndex((item) => item.profile === profile && item.id === id);
	if (index < 0) return void 0;
	const [entry] = entries.splice(index, 1);
	saveDisabled(home, entries);
	return entry;
}
//#endregion
//#region src/source.ts
/** Parse a `github:owner/repo#ref` shorthand into an https URL and ref. */
function parseGithubSpec(source) {
	const match = /^github:([^#]+?)(?:#(.+))?$/.exec(source);
	if (match === null) return void 0;
	const [, repo] = match;
	if (repo === void 0 || !repo.includes("/")) return void 0;
	return {
		url: `https://github.com/${repo}.git`,
		ref: match[2] ?? ""
	};
}
function detectSourceKind(source) {
	if (parseGithubSpec(source) !== void 0) return "git";
	if (/^git\+|^git:|^ssh:\/\//.test(source)) return "git";
	if (/^https?:\/\//.test(source)) return /(^|\/)(github\.com|gitlab\.com|gitlab\.[^/]+|bitbucket\.org)\/|\.git(?:#.*)?$/.test(source) ? "git" : "npm";
	if (isAbsolutePath(source) || source.startsWith(".") || source.startsWith("file:") || source.startsWith("link:")) return "file";
	return "npm";
}
function isFullSha(value) {
	return /^[0-9a-f]{7,40}$/i.test(value);
}
/**
* Materialize a git/file source into `workDir/source`. Git clones go through
* the centralized package store; file sources are copied from a centralized
* snapshot so probing sees one stable snapshot while the pnpm dependency
* still points at the user-supplied original path (matching `dsh plugin`
* semantics).
* @param workDir - per-install scratch directory.
* @param source - verbatim source spec.
* @param ref - requested branch/tag/commit (empty = remote default).
* @param git - git runner seam.
* @param packageRoot - centralized package store root.
*/
async function materializeSource(workDir, source, ref, git, packageRoot) {
	const kind = detectSourceKind(source);
	if (kind === "npm") return {
		kind,
		dir: "",
		resolvedCommit: ""
	};
	mkdirSync(workDir, { recursive: true });
	mkdirSync(packageRoot, { recursive: true });
	const dir = join(workDir, "source");
	if (kind === "git") {
		const github = parseGithubSpec(source);
		const url = github?.url ?? source.replace(/^git\+/, "");
		const targetRef = github !== void 0 && github.ref !== "" ? github.ref : ref;
		if (isFullSha(targetRef)) {
			const clone = await git([
				"clone",
				"--quiet",
				url,
				dir
			], workDir);
			if (clone.exitCode !== 0) throw new Error(`git clone failed (exit ${clone.exitCode}): ${clone.stderr || clone.stdout}`);
			const rev = await git(["rev-parse", "HEAD"], dir);
			if (rev.exitCode !== 0) throw new Error(`git rev-parse failed (exit ${rev.exitCode}): ${rev.stderr || rev.stdout}`);
			return {
				kind,
				dir,
				resolvedCommit: rev.stdout.trim()
			};
		}
		return {
			kind,
			dir,
			resolvedCommit: (await cloneGitFromStore(packageRoot, url, targetRef, git, dir)).resolvedCommit
		};
	}
	const resolved = resolve(source.replace(/^file:/, ""));
	if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new Error(`file source is not a directory: ${resolved}`);
	const snapshot = snapshotFileSource(packageRoot, resolved);
	cpSync(snapshot, dir, {
		recursive: true,
		force: true
	});
	return {
		kind,
		dir,
		resolvedCommit: ""
	};
}
//#endregion
//#region src/runtimeStore.ts
/**
* Package-manager runtime store under `<home>/package-manager/runtime`.
* It holds the workspace-root history used by the settings UI and is the
* parent of the centralized package cache. This is local machine state, not
* package-manager source: it must never be committed to a plugin repository.
* @module @dsh-ext/dsh-package-manager/runtimeStore
*/
const HISTORY_VERSION = 1;
const MAX_HISTORY_ENTRIES = 20;
/**
* Read recently used workspace roots, newest first. This file is
* non-critical UI state, so malformed or unreadable files degrade to an
* empty list instead of breaking the package-manager service.
*/
function loadWorkspaceHistory(home) {
	let raw;
	try {
		raw = readFileSync(workspaceHistoryPath(home), "utf8");
	} catch {
		return [];
	}
	try {
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
		const store = parsed;
		if (store.version !== HISTORY_VERSION || store.entries === void 0 || !Array.isArray(store.entries)) return [];
		return store.entries.flatMap((entry) => {
			if (typeof entry !== "string") return [];
			const path = entry.trim();
			return path === "" ? [] : [path];
		});
	} catch {
		return [];
	}
}
/** Atomically persist the workspace history file. */
function saveWorkspaceHistory(home, entries) {
	const path = workspaceHistoryPath(home);
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temp, JSON.stringify({
		version: HISTORY_VERSION,
		entries
	}, void 0, 2) + "\n");
	renameSync(temp, path);
}
/** Move `path` to the front of the history list and persist the result. */
function recordWorkspaceHistory(home, path) {
	const value = path.trim();
	if (value === "") return loadWorkspaceHistory(home);
	const entries = [value, ...loadWorkspaceHistory(home).filter((item) => item !== value)].slice(0, MAX_HISTORY_ENTRIES);
	saveWorkspaceHistory(home, entries);
	return entries;
}
/** Remove all workspace paths from history. */
function clearWorkspaceHistory(home) {
	saveWorkspaceHistory(home, []);
	return [];
}
/** Remove one workspace path from history and persist the result. */
function forgetWorkspaceHistory(home, path) {
	const entries = loadWorkspaceHistory(home).filter((item) => item !== path.trim());
	saveWorkspaceHistory(home, entries);
	return entries;
}
//#endregion
//#region src/spec.ts
/**
* Requirements files: the declarative specification a machine restores from.
* One file lists every mode (profile) and the plugins it should hold. The
* manager reconciles this desired state against the ledger with id-keyed
* diffs — mirroring the harness Loader's incremental configuration
* reconciliation — so restore converges instead of reinstalling.
* @module @dsh-ext/dsh-package-manager/spec
*/
const ADAPTERS = /* @__PURE__ */ new Set([
	"auto",
	"dsh-bundle",
	"custom"
]);
function parseRequirements(text, baseDir) {
	const parsed = YAML.parse(text);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("requirements: root must be a YAML mapping");
	const root = parsed;
	if (root.version !== 1) throw new Error("requirements: unsupported version (expected 1)");
	if (root.modes === null || typeof root.modes !== "object" || Array.isArray(root.modes)) throw new Error("requirements: modes must be a mapping of profile name -> plugin list");
	const modes = {};
	for (const [mode, value] of Object.entries(root.modes)) {
		if (mode === "") throw new Error("requirements: mode name must not be empty");
		if (!Array.isArray(value)) throw new Error(`requirements: modes.${mode} must be a list`);
		modes[mode] = value.map((raw, index) => parseEntry(raw, `modes.${mode}[${index}]`));
		const ids = /* @__PURE__ */ new Set();
		for (const entry of modes[mode]) {
			if (ids.has(entry.id)) throw new Error(`requirements: duplicate plugin id ${JSON.stringify(entry.id)} in mode ${JSON.stringify(mode)}`);
			ids.add(entry.id);
		}
	}
	return {
		version: 1,
		repo: typeof root.repo === "string" ? root.repo : ".",
		modes,
		baseDir: resolve(baseDir)
	};
}
function parseEntry(raw, where) {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`requirements: ${where} must be a mapping`);
	const value = raw;
	const id = value.id;
	const source = value.source;
	if (typeof id !== "string" || id === "") throw new Error(`requirements: ${where}.id must be a non-empty string`);
	if (typeof source !== "string" || source === "") throw new Error(`requirements: ${where}.source must be a non-empty string`);
	const adapter = value.adapter === void 0 ? "auto" : value.adapter;
	if (typeof adapter !== "string" || !ADAPTERS.has(adapter)) throw new Error(`requirements: ${where}.adapter must be auto, dsh-bundle, or custom`);
	const adapterDir = value.adapterDir;
	if (adapterDir !== void 0 && typeof adapterDir !== "string") throw new Error(`requirements: ${where}.adapterDir must be a string`);
	const ref = value.ref;
	if (ref !== void 0 && typeof ref !== "string") throw new Error(`requirements: ${where}.ref must be a string`);
	const allowBuild = value.allowBuild;
	if (allowBuild !== void 0 && typeof allowBuild !== "boolean") throw new Error(`requirements: ${where}.allowBuild must be a boolean`);
	return {
		id,
		source,
		adapter,
		adapterDir: adapterDir ?? "",
		ref: ref ?? "",
		allowBuild: allowBuild ?? false
	};
}
/** Change-detection fingerprint of a spec entry. */
function fingerprint(entry) {
	return {
		source: entry.source,
		adapter: entry.adapter,
		adapterDir: entry.adapterDir,
		ref: entry.ref,
		allowBuild: entry.allowBuild
	};
}
/** Resolve an adapter dir relative to the requirements file (absolute paths pass through). */
function resolveAdapterDir(spec, adapterDir) {
	return isAbsolute(adapterDir) ? adapterDir : join(spec.baseDir, adapterDir);
}
/**
* Compute the minimal id-keyed reconciliation plan between a requirements file
* and the ledger. Entries present in both with equal fingerprints are kept
* (their installs are not replayed); changed entries update (uninstall then
* install); ledger entries absent from the spec uninstall; spec entries absent
* from the ledger install.
* @param spec - parsed requirements file.
* @param ledger - current installed state.
* @param modeFilter - modes to reconcile; empty means all declared modes.
*/
function planRestore(spec, ledger, modeFilter = []) {
	return planModes(spec, ledger, modeFilter.length > 0 ? [...modeFilter] : Object.keys(spec.modes), true);
}
/**
* Reconciliation plan used when switching the active workspace root. Unlike
* restore, modes that exist in the ledger but are absent from the target
* requirements file are reconciled to an empty desired set, so switching
* workspaces closes plugins the target does not declare.
*/
function planWorkspaceSwitch(spec, ledger) {
	return planModes(spec, ledger, [.../* @__PURE__ */ new Set([...Object.keys(spec.modes), ...Object.keys(ledger.profiles)])], false);
}
function planModes(spec, ledger, modes, requireDeclared) {
	const actions = [];
	for (const mode of modes) {
		const desired = spec.modes[mode];
		if (desired === void 0 && requireDeclared) throw new Error(`requirements: mode ${JSON.stringify(mode)} is not declared`);
		const currentEntries = ledger.profiles[mode] ?? {};
		for (const entry of desired ?? []) {
			const current = currentEntries[entry.id];
			if (current === void 0) actions.push({
				action: "install",
				profile: mode,
				id: entry.id,
				reason: "declared in requirements, not installed",
				entry
			});
			else if (sameFingerprint(fingerprint(entry), current.spec)) actions.push(current.disabled === true ? {
				action: "enable",
				profile: mode,
				id: entry.id,
				reason: "installed state matches but the plugin is switched off",
				entry,
				current
			} : {
				action: "keep",
				profile: mode,
				id: entry.id,
				reason: "installed state matches",
				entry,
				current
			});
			else actions.push({
				action: "update",
				profile: mode,
				id: entry.id,
				reason: "source or adapter changed",
				entry,
				current
			});
		}
		for (const id of Object.keys(currentEntries)) if (!(desired ?? []).some((entry) => entry.id === id)) {
			const current = currentEntries[id];
			actions.push({
				action: "uninstall",
				profile: mode,
				id,
				reason: desired === void 0 ? "mode is not declared by the target workspace" : "not declared in requirements",
				...current === void 0 ? {} : { current }
			});
		}
	}
	return actions;
}
function sameFingerprint(left, right) {
	return left.source === right.source && left.adapter === right.adapter && left.adapterDir === right.adapterDir && left.ref === right.ref && left.allowBuild === right.allowBuild;
}
//#endregion
//#region src/profilePatch.ts
/**
* Official hot-reload seam: the package manager never talks to `ctx.loader`
* directly and never recomposes the root Include itself. It only edits the
* profile's own user patch layer (`cordis.patch.yml`), which the DSH
* launcher already watches through `watchUserPatches`:
*
*   bundle layers (boot snapshot) -> profile cordis.patch.yml -> home
*   cordis.patch.yml -> launcher overlays
*
* Every `dsh-bundle` install owns one clearly-marked block in that file. The
* block carries the bundle patch rows verbatim (normalized `!!js` expression
* nodes survive round-trip). Adding the block is the hot-mount, removing it
* is the hot-unmount, and re-writing it with trailing `{ id, disabled: true }`
* rows is disable/enable. `watchUserPatches` performs the loader diff, so no
* restart and no package-manager-side composition code are needed.
* @module @dsh-ext/dsh-package-manager/profilePatch
*/
/** The loader expression tag used by DSH patch files (`!!js`). */
const jsExprTag = {
	tag: "tag:yaml.org,2002:js",
	identify(value) {
		return value !== null && typeof value === "object" && "__jsExpr" in value;
	},
	resolve(value) {
		return { __jsExpr: value };
	},
	stringify(item) {
		const value = item.value;
		return value !== null && typeof value === "object" && "__jsExpr" in value && typeof value.__jsExpr === "string" ? value.__jsExpr : String(value);
	}
};
function markerStart(id) {
	return `# >>> dsh-package-manager: ${JSON.stringify(id)}`;
}
function markerEnd(id) {
	return `# <<< dsh-package-manager: ${JSON.stringify(id)}`;
}
function eolOf(text) {
	return text.includes("\r\n") ? "\r\n" : "\n";
}
function splitLines(text) {
	return text.split(/\r?\n/);
}
/**
* Remove a previously written managed block by its marker comments. User
* content is untouched; a start marker without its end marker is a corrupted
* managed file and fails loudly instead of silently eating the rest of it.
*/
function removeManagedPatch(dir, id) {
	const path = profilePatchPath(dir);
	if (!existsSync(path)) return false;
	const text = readFileSync(path, "utf8");
	const next = removeManagedBlock(text, id);
	if (next === text) return false;
	writeFileSync(path, next);
	return true;
}
/**
* Install/replace the managed block for one plugin.
*
* The existing file is parsed and re-serialized with the DSH `!!js` dialect,
* so user comments are preserved and only this plugin's previous block is
* replaced. The returned list is what the official watcher will diff into the
* loader tree on the next `cordis.patch.yml` change event.
*/
function writeManagedPatch(dir, id, entries, disabled, rowIds) {
	const path = profilePatchPath(dir);
	let text = existsSync(path) ? readFileSync(path, "utf8") : "[]\n";
	text = removeManagedBlock(text, id);
	if (text.trim() === "") text = "[]\n";
	let doc = YAML.parseDocument(text, { customTags: [jsExprTag] });
	if (doc.contents === null) {
		text = "[]\n";
		doc = YAML.parseDocument(text, { customTags: [jsExprTag] });
	}
	if (!isSeq(doc.contents)) throw new Error(`profile patch ${path} must be a top-level YAML array of loader patch entries`);
	const block = structuredClone(entries);
	if (disabled) for (const rowId of new Set(rowIds)) block.push({
		id: rowId,
		disabled: true
	});
	doc.contents.flow = false;
	const created = doc.createNode(block);
	if (!isSeq(created)) throw new Error(`internal: managed patch block for ${JSON.stringify(id)} did not serialize as a sequence`);
	const items = [...created.items];
	if (items.length > 0) {
		items[0].commentBefore = ` >>> dsh-package-manager: ${JSON.stringify(id)}`;
		items[items.length - 1].comment = ` <<< dsh-package-manager: ${JSON.stringify(id)}`;
		doc.contents.items.push(...items);
	}
	let next = doc.toString();
	if (next === "") next = "[]\n";
	if (!next.endsWith("\n")) next += eolOf(text);
	if (next === text) return {
		path,
		entries: [...block]
	};
	writeFileSync(path, next);
	return {
		path,
		entries: [...block]
	};
}
/**
* Build the normalized entries for an installed bundle package. Insert rows
* without a stable id receive the same deterministic fallback id every time,
* so disable patches can always target them.
*/
function managedPatchForPackage(packageDir, profile, id) {
	const patch = loadBundlePatch(packageDir);
	if (patch === void 0) return void 0;
	const entries = structuredClone(patch.raw);
	const rowIds = [];
	let fallbackIndex = 0;
	for (const entry of entries) {
		const insert = entry["insert"];
		if (!Array.isArray(insert)) continue;
		entry["insert"] = insert.map((row) => {
			if (row === null || typeof row !== "object" || Array.isArray(row)) throw new Error(`bundle patch ${patch.path}: insert rows must be mappings`);
			const record = row;
			const existing = record["id"];
			if (typeof existing === "string" && existing !== "") {
				rowIds.push(existing);
				return record;
			}
			const fallback = stablePatchRowId(profile, id, fallbackIndex++);
			rowIds.push(fallback);
			return {
				...record,
				id: fallback
			};
		});
	}
	return {
		entries,
		rowIds
	};
}
/** Resolve the installed bundle package directory for one ledger entry. */
function resolveBundlePackageDir(entry) {
	const packageName = entry.packageName;
	if (entry.profileDir !== void 0 && entry.profileDir !== "" && packageName !== "") {
		const dir = resolvePackageDir(entry.profileDir, packageName);
		if (dir !== void 0) return dir;
	}
	if (entry.materializedDir !== "") {
		if (existsSync(join(entry.materializedDir, "package.json"))) return entry.materializedDir;
	}
	if (entry.pluginEnvDir !== void 0 && entry.pluginEnvDir !== "") {
		if (existsSync(join(entry.pluginEnvDir, "package.json"))) return entry.pluginEnvDir;
		if (packageName !== "") {
			const dir = resolvePackageDir(entry.pluginEnvDir, packageName);
			if (dir !== void 0) return dir;
		}
	}
}
/** Stable patch-row ids of an installed dsh-bundle entry (fallback ids included). */
function patchRowIdsForEntry(entry) {
	if (entry.adapter !== "dsh-bundle" || entry.packageName === "") return [];
	const packageDir = resolveBundlePackageDir(entry);
	if (packageDir === void 0) return [];
	return managedPatchForPackage(packageDir, entry.profile, entry.id)?.rowIds ?? [];
}
function removeManagedBlock(text, id) {
	const start = markerStart(id);
	const end = markerEnd(id);
	const lines = splitLines(text);
	let startIndex = -1;
	let endIndex = -1;
	for (let index = 0; index < lines.length; index += 1) {
		const trimmed = lines[index]?.trim() ?? "";
		if (startIndex === -1) {
			if (trimmed === start) startIndex = index;
		} else if (trimmed === end) {
			endIndex = index;
			break;
		}
	}
	if (startIndex === -1) return text;
	if (endIndex === -1) throw new Error(`profile patch managed block for ${JSON.stringify(id)} has a start marker but no end marker`);
	lines.splice(startIndex, endIndex - startIndex + 1);
	const result = lines.join(eolOf(text));
	const doc = YAML.parseDocument(result, { customTags: [jsExprTag] });
	if (doc.contents === null || isSeq(doc.contents) && doc.contents.items.length === 0) {
		const eol = eolOf(text);
		return `${result.trim() === "" ? "" : `${result.trimEnd()}${eol}`}[]${eol}`;
	}
	return result;
}
//#endregion
//#region src/manager.ts
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
const WEB_REFRESH_MARKER = "web-refresh-needed";
const DEPS_FILENAME = "deps.yaml";
var PackageManager = class {
	home;
	executor;
	git;
	reconciling = false;
	/** Serializes profile/ledger mutations; the host runs pnpm without a lock, so install/uninstall/restore must never interleave. */
	chain = Promise.resolve();
	switchError = "";
	enqueue(run) {
		const task = this.chain.then(run, run);
		this.chain = task.catch(() => {});
		return task;
	}
	constructor(options = {}) {
		this.home = options.home ?? resolveHome();
		const host = options.host ?? createHost();
		this.executor = new StepExecutor(options.pnpm ?? ((args, cwd, env) => host.pnpm(args, cwd, env)), options.command ?? ((command, cwd, env) => host.shell(command, cwd, env)), options.dsh ?? ((args, cwd, env) => host.dsh(args, cwd, env)));
		this.git = options.git ?? ((args, cwd) => host.git(args, cwd));
	}
	/** Resolved root for per-plugin workspaces (AI session cwd; not a dependency layer). */
	workspaceRoot() {
		const configured = this.getConfig().workspaceRoot.trim();
		if (configured === "") return defaultWorkspaceRoot(this.home);
		return isAbsolute(configured) ? resolve(configured) : resolve(this.home, configured);
	}
	workspaceDefault() {
		return defaultWorkspaceRoot(this.home);
	}
	pluginWorkspaceDir(profile, id) {
		return pluginWorkspaceDir(this.workspaceRoot(), profile, id);
	}
	/** Read-only view for the Web UI and CLI. */
	state() {
		const profiles = listProfiles(this.home).map((name) => {
			const dir = profileDir(this.home, name);
			const manifest = readManifest(dir);
			return {
				name,
				dir,
				exists: true,
				bundles: [...manifest.dsh?.profile?.bundles ?? []],
				dependencies: Object.keys(manifest.dependencies ?? {})
			};
		});
		return {
			home: this.home,
			workspaceRoot: this.workspaceRoot(),
			workspaceDefault: defaultWorkspaceRoot(this.home),
			workspaceHistory: loadWorkspaceHistory(this.home),
			reconciling: this.reconciling,
			switchError: this.switchError,
			webRefreshNeeded: existsSync(this.webRefreshMarker()),
			profiles,
			entries: listEntries(loadEffectiveLedger(this.home)),
			localPlugins: [],
			disabled: loadDisabled(this.home),
			config: loadConfig(this.home)
		};
	}
	clearWebRefreshMarker() {
		rmSync(this.webRefreshMarker(), { force: true });
	}
	async install(request) {
		return this.enqueue(() => this.installInner(request));
	}
	async installInner(request) {
		const logs = [];
		const log = (level, message) => {
			logs.push({
				level,
				message
			});
		};
		const profile = request.profile;
		const id = request.id ?? idFromSource(request.source);
		const dir = profileDir(this.home, profile);
		ensureProfile(dir, profile);
		const source = request.source;
		const ref = request.ref ?? "";
		const allowBuild = request.allowBuild ?? false;
		const workspaceDir = this.pluginWorkspaceDir(profile, id);
		const envDir = pluginEnvDir(workspaceDir);
		if (request.dryRun === true) {
			log("info", `dry run: would install ${JSON.stringify(id)} into profile ${JSON.stringify(profile)} from ${JSON.stringify(source)}`);
			log("info", `dry run: adapter ${request.adapter}, allowBuild ${String(allowBuild)}`);
			return {
				profile,
				id,
				adapter: request.adapter,
				packageName: "",
				pluginEnvDir: envDir,
				workspaceDir,
				hotMounted: false,
				steps: [],
				logs,
				dryRun: true
			};
		}
		const ledger = loadLedger(this.home);
		if (getEntry(loadEffectiveLedger(this.home), profile, id) !== void 0) throw new Error(`plugin ${JSON.stringify(id)} is already installed in profile ${JSON.stringify(profile)} — uninstall it first, or change its spec via restore`);
		const kind = detectSourceKind(source);
		const workDir = this.workDir(profile, id);
		const ctx = {
			home: this.home,
			profileDir: dir,
			workDir,
			workspaceDir,
			pluginEnvDir: envDir,
			source,
			ref,
			log
		};
		let records = [];
		let patchWritten = false;
		let managedBlock;
		try {
			const materialized = kind === "npm" ? void 0 : await materializeSource(workDir, source, ref, this.git, packageStoreRoot(this.home));
			const resolved = this.resolveAdapter(request.adapter, request.adapterDir ?? "", source, materialized?.dir ?? "");
			let packageName = resolved.packageName ?? (kind === "npm" ? npmNameOf(source) : "");
			log("info", `adapter: ${resolved.kind}${resolved.reason === "" ? "" : ` (${resolved.reason})`}`);
			if (resolved.kind === "dsh-bundle") {
				const shippedBundles = PROFILE_TEMPLATES[profile] ?? DEFAULT_PROFILE_BUNDLES;
				if (packageName !== "" && shippedBundles.includes(packageName)) throw new Error(`bundle ${JSON.stringify(packageName)} is one of this profile's shipped base bundles and is owned by the host launcher, not the package manager`);
				if (materialized !== void 0 && materialized.dir !== "") {
					const problems = validateBundleSource(materialized.dir);
					if (problems.length > 0) throw new Error(`bundle source rejected before any profile edit: ${problems.join("; ")}`);
					managedBlock = managedPatchForPackage(materialized.dir, profile, id);
					if (managedBlock === void 0) throw new Error(`bundle ${JSON.stringify(packageName || source)} declares no dsh.bundle.patch`);
				}
				records = await this.executor.run(builtinInstallSteps({
					source,
					sourceKind: kind,
					ref,
					allowBuild,
					packageName,
					profileSpec: this.profileSpecFor(source, kind),
					removeBundleRow: true,
					executor: this.executor
				}), ctx, join(workDir, "backups"));
				const recordedPackage = records.find((record) => record.kind === "profile.dependency.add")?.params["packageName"];
				if (typeof recordedPackage === "string" && recordedPackage !== "") packageName = recordedPackage;
				const entry = {
					id,
					profile,
					profileDir: dir,
					source,
					sourceKind: kind,
					ref,
					adapter: "dsh-bundle",
					adapterDir: "",
					packageName,
					materializedDir: materialized?.dir ?? "",
					resolvedCommit: materialized?.resolvedCommit ?? "",
					workDir,
					workspaceDir,
					pluginEnvDir: envDir,
					steps: records,
					installedAt: (/* @__PURE__ */ new Date()).toISOString(),
					updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
					spec: {
						source,
						adapter: request.adapter,
						adapterDir: request.specAdapterDir ?? request.adapterDir ?? "",
						ref,
						allowBuild
					},
					allowBuild
				};
				if (managedBlock === void 0) {
					const packageDir = resolveBundlePackageDir(entry);
					if (packageDir === void 0) throw new Error(`cannot resolve installed bundle ${JSON.stringify(packageName)} from profile ${JSON.stringify(profile)}`);
					managedBlock = managedPatchForPackage(packageDir, profile, id);
				}
				if (managedBlock === void 0) throw new Error(`bundle ${JSON.stringify(packageName)} declares no dsh.bundle.patch`);
				writeManagedPatch(dir, id, managedBlock.entries, false, managedBlock.rowIds);
				patchWritten = true;
				log("info", `wrote hot-reload block for ${packageName} into ${join(dir, "cordis.patch.yml")}; the official watchUserPatches diff hot-mounts it`);
				setEntry(ledger, entry);
				saveLedger(this.home, ledger);
				this.clearDisabled(profile, id);
				this.noteClientFace(entry, log);
				log("info", `installed ${id} in profile ${profile} (${records.length} steps recorded)`);
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
					dryRun: false
				};
			}
			if (resolved.adapterDir === "") throw new Error(`plugin ${JSON.stringify(id)} needs a custom adapter but none was provided — run adapter-init to scaffold one`);
			records = await runCustomInstall({
				adapter: loadCustomAdapter(resolved.adapterDir, this.adapterVars(ctx)),
				executor: this.executor,
				backupRoot: join(workDir, "backups")
			}, ctx);
			setEntry(ledger, {
				id,
				profile,
				profileDir: dir,
				source,
				sourceKind: kind,
				ref,
				adapter: "custom",
				adapterDir: resolved.adapterDir,
				packageName,
				materializedDir: materialized?.dir ?? "",
				resolvedCommit: materialized?.resolvedCommit ?? "",
				workDir,
				workspaceDir,
				pluginEnvDir: envDir,
				steps: records,
				installedAt: (/* @__PURE__ */ new Date()).toISOString(),
				updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
				spec: {
					source,
					adapter: request.adapter,
					adapterDir: request.specAdapterDir ?? request.adapterDir ?? "",
					ref,
					allowBuild
				},
				allowBuild
			});
			saveLedger(this.home, ledger);
			this.clearDisabled(profile, id);
			log("info", `installed ${id} in profile ${profile} through custom adapter (${records.length} steps recorded)`);
			return {
				profile,
				id,
				adapter: "custom",
				packageName,
				pluginEnvDir: envDir,
				workspaceDir,
				hotMounted: false,
				steps: records,
				logs,
				dryRun: false
			};
		} catch (error) {
			const message = buildScriptHint(source, allowBuild, error);
			try {
				if (patchWritten) removeManagedPatch(dir, id);
				if (records.length > 0) await this.executor.rollback(records, ctx, join(workDir, "backups"));
			} catch (rollbackError) {
				throw new Error(`${messageOf$2(error)}\n${messageOf$2(rollbackError)}`);
			}
			throw new Error(message);
		}
	}
	async uninstall(request) {
		return this.enqueue(() => this.uninstallInner(request));
	}
	async uninstallInner(request) {
		const logs = [];
		const log = (level, message) => {
			logs.push({
				level,
				message
			});
		};
		const ledger = loadLedger(this.home);
		const entry = getEntry(ledger, request.profile, request.id);
		if (entry === void 0) throw new Error(`plugin ${JSON.stringify(request.id)} is not installed in profile ${JSON.stringify(request.profile)}`);
		if (request.dryRun === true) {
			log("info", `dry run: would uninstall ${entry.id} from profile ${entry.profile} (${entry.steps.length} inverse steps)`);
			return {
				profile: entry.profile,
				id: entry.id,
				hotUnmounted: false,
				steps: [],
				logs,
				dryRun: true
			};
		}
		const dir = entry.profileDir ?? profileDir(this.home, entry.profile);
		if (!isEntryEffective(this.home, entry)) {
			const cleaned = entry.adapter === "dsh-bundle" ? removeManagedPatch(dir, entry.id) : false;
			if (entry.pluginEnvDir !== void 0 && entry.pluginEnvDir !== "" && existsSync(entry.pluginEnvDir)) {
				rmSync(entry.pluginEnvDir, {
					recursive: true,
					force: true
				});
				log("info", `removed stale plugin dependency layer ${entry.pluginEnvDir}`);
			}
			removeEntry(ledger, entry.profile, entry.id);
			saveLedger(this.home, ledger);
			log("info", cleaned ? `removed stale ledger record and hot-reload block for ${entry.id}` : `removed stale ledger record for ${entry.id} (the profile no longer has it installed)`);
			return {
				profile: entry.profile,
				id: entry.id,
				hotUnmounted: cleaned,
				steps: [],
				logs,
				dryRun: false
			};
		}
		const workDir = entry.workDir !== void 0 && entry.workDir !== "" && existsSync(entry.workDir) ? entry.workDir : entry.materializedDir === "" ? this.workDir(entry.profile, entry.id) : dirname(entry.materializedDir);
		const ctx = {
			home: this.home,
			profileDir: dir,
			workDir,
			...entry.workspaceDir === void 0 ? {} : { workspaceDir: entry.workspaceDir },
			...entry.pluginEnvDir === void 0 ? {} : { pluginEnvDir: entry.pluginEnvDir },
			source: entry.source,
			ref: entry.ref,
			log
		};
		let hotUnmounted = false;
		if (entry.adapter === "dsh-bundle") {
			hotUnmounted = removeManagedPatch(dir, entry.id);
			if (hotUnmounted) log("info", `removed hot-reload block for ${entry.packageName}; the official watchUserPatches diff hot-unmounts it`);
			else log("warn", `no hot-reload block found for ${entry.packageName}; it is already unloaded from the patch layer`);
		}
		try {
			await this.executor.rollback(entry.steps, ctx, join(workDir, "backups"));
			if (entry.adapter === "custom" && entry.adapterDir !== "") {
				const extra = loadCustomAdapter(entry.adapterDir, this.adapterVars(ctx)).uninstall ?? [];
				if (extra.length > 0) {
					await this.executor.run(extra, ctx, join(workDir, "extra-backups"));
					log("info", `custom adapter uninstall steps: ${extra.length}`);
				}
			}
		} catch (error) {
			throw new Error(`uninstall failed (ledger entry kept for retry): ${messageOf$2(error)}`);
		}
		removeEntry(ledger, entry.profile, entry.id);
		saveLedger(this.home, ledger);
		removeDisabledEntry(this.home, entry.profile, entry.id);
		rmSync(workDir, {
			recursive: true,
			force: true
		});
		this.noteClientFace(entry, log);
		log("info", `uninstalled ${entry.id} from profile ${entry.profile}`);
		return {
			profile: entry.profile,
			id: entry.id,
			hotUnmounted,
			steps: entry.steps,
			logs,
			dryRun: false
		};
	}
	async restore(request) {
		return this.enqueue(() => this.restoreInner(request));
	}
	async restoreInner(request) {
		const logs = [];
		const log = (level, message) => {
			logs.push({
				level,
				message
			});
		};
		const file = resolve(request.file);
		const spec = parseRequirements(readFileSync(file, "utf8"), dirname(file));
		const actions = planRestore(spec, loadEffectiveLedger(this.home), request.modes ?? []);
		return {
			file,
			actions,
			...await this.reconcilePlan(spec, actions, request.dryRun === true, logs, log, "restore"),
			logs,
			dryRun: request.dryRun === true
		};
	}
	/**
	* Repair home state so the next boot cannot die on profile composition:
	* prune unresolvable bundle rows, drop stale ledger records together with
	* their managed hot-reload blocks, and reconcile profile pnpm trees.
	*/
	async doctor() {
		const profiles = healProfiles(this.home);
		const ledger = loadLedger(this.home);
		const droppedLedger = [];
		for (const entry of listEntries(ledger)) if (!isEntryEffective(this.home, entry)) {
			if (entry.adapter === "dsh-bundle") removeManagedPatch(entry.profileDir ?? profileDir(this.home, entry.profile), entry.id);
			if (entry.pluginEnvDir !== void 0 && entry.pluginEnvDir !== "" && existsSync(entry.pluginEnvDir)) rmSync(entry.pluginEnvDir, {
				recursive: true,
				force: true
			});
			removeEntry(ledger, entry.profile, entry.id);
			droppedLedger.push(`${entry.profile}/${entry.id}`);
		}
		if (droppedLedger.length > 0) saveLedger(this.home, ledger);
		const reconciled = [];
		for (const name of listProfiles(this.home)) {
			const dir = profileDir(this.home, name);
			if (!existsSync(join(dir, "pnpm-lock.yaml")) && !existsSync(join(dir, "node_modules"))) continue;
			try {
				await this.executor.reconcileProfile({
					home: this.home,
					profileDir: dir,
					workDir: dir,
					source: "doctor",
					ref: "",
					log: () => {}
				});
				reconciled.push(name);
			} catch (error) {
				reconciled.push(`${name} (reconcile failed: ${messageOf$2(error)})`);
			}
		}
		return {
			profiles,
			droppedLedger,
			reconciled
		};
	}
	/**
	* Switch the active requirements root and reconcile the installed set.
	* Modes present in the ledger but absent from the target file are reconciled
	* to an empty desired set; switchable entries are disabled in place, not
	* uninstalled.
	*/
	async switchWorkspace(path, dryRun = false) {
		return this.enqueue(() => this.switchWorkspaceInner(path, dryRun));
	}
	async switchWorkspaceInner(path, dryRun) {
		if (this.reconciling) throw new Error("a workspace switch is already running");
		this.reconciling = true;
		this.switchError = "";
		try {
			const logs = [];
			const log = (level, message) => {
				logs.push({
					level,
					message
				});
			};
			const healed = await this.doctor();
			for (const report of healed.profiles) for (const packageName of report.pruned) log("warn", `healed profile ${report.profile}: pruned unresolvable bundle row ${packageName}`);
			for (const id of healed.droppedLedger) log("warn", `healed ledger: dropped stale record ${id}`);
			const root = this.resolveWorkspaceInput(path);
			const file = this.workspaceRequirementsFile(root);
			if (file === "") {
				log("info", `${dryRun ? "dry run: " : ""}workspace switch to ${root} (no requirements/deps.yaml found — installed set left unchanged)`);
				if (!dryRun) this.setConfig({
					...this.getConfig(),
					workspaceRoot: root
				});
				return {
					file: "",
					actions: [],
					installed: [],
					uninstalled: [],
					updated: [],
					logs,
					dryRun
				};
			}
			const spec = parseRequirements(readFileSync(file, "utf8"), dirname(file));
			const actions = planWorkspaceSwitch(spec, loadEffectiveLedger(this.home)).map((action) => {
				if (action.action !== "uninstall" || action.current === void 0 || !this.isDisableable(action.current)) return action;
				return {
					...action,
					action: "disable",
					reason: "not declared by the target workspace — switched off"
				};
			});
			if (dryRun) {
				for (const action of actions) log("info", `${action.action}: ${action.profile}/${action.id} — ${action.reason}`);
				return {
					file,
					actions,
					installed: [],
					uninstalled: [],
					updated: [],
					logs,
					dryRun
				};
			}
			this.setConfig({
				...this.getConfig(),
				workspaceRoot: root
			});
			return {
				file,
				actions,
				...await this.reconcilePlan(spec, actions, false, logs, log, "workspace switch"),
				logs,
				dryRun
			};
		} catch (error) {
			this.switchError = messageOf$2(error);
			throw error;
		} finally {
			this.reconciling = false;
		}
	}
	isDisableable(entry) {
		return entry.adapter === "dsh-bundle" && patchRowIdsForEntry(entry).length > 0;
	}
	async reconcilePlan(spec, actions, dryRun, logs, log, label) {
		const installed = [];
		const uninstalled = [];
		const updated = [];
		for (const action of actions) {
			log("info", `${action.action}: ${action.profile}/${action.id} — ${action.reason}`);
			if (action.action === "keep" || dryRun) continue;
			try {
				if (action.action === "disable") {
					const result = await this.disableInner({
						profile: action.profile,
						id: action.id
					});
					uninstalled.push(result);
					logs.push(...result.logs);
				} else if (action.action === "enable") {
					const result = await this.enableInner({
						profile: action.profile,
						id: action.id
					});
					logs.push(...result.logs);
				} else if (action.action === "uninstall") {
					const result = await this.uninstallInner({
						profile: action.profile,
						id: action.id
					});
					uninstalled.push(result);
					logs.push(...result.logs);
				} else {
					const entry = action.entry;
					const result = await this.installInner({
						id: entry.id,
						profile: action.profile,
						source: entry.source,
						adapter: entry.adapter,
						adapterDir: entry.adapter === "custom" && entry.adapterDir !== "" ? resolveAdapterDir(spec, entry.adapterDir) : "",
						specAdapterDir: entry.adapterDir,
						ref: entry.ref,
						allowBuild: entry.allowBuild
					});
					installed.push(result);
					if (action.action === "update") updated.push(result);
					logs.push(...result.logs);
				}
			} catch (error) {
				throw new Error(`${label} failed at ${action.action} ${action.profile}/${action.id}: ${messageOf$2(error)}`);
			}
		}
		return {
			installed,
			uninstalled,
			updated
		};
	}
	resolveWorkspaceInput(path) {
		const value = path.trim();
		if (value === "") return defaultWorkspaceRoot(this.home);
		if (isAbsolute(value) || /^[A-Za-z]:[\/]/.test(value) || /^[A-Za-z]:$/.test(value)) return resolve(value);
		return resolve(process.cwd(), value);
	}
	workspaceRequirementsFile(root) {
		for (const candidate of [join(root, "requirements", DEPS_FILENAME), join(root, DEPS_FILENAME)]) if (existsSync(candidate)) return candidate;
		return "";
	}
	async sync(request) {
		return this.enqueue(() => this.syncInner(request));
	}
	async syncInner(request) {
		const repo = resolve(request.repo);
		if (!existsSync(join(repo, ".git"))) throw new Error(`sync repo is not a git checkout: ${repo}`);
		const pulled = await this.git(["pull", "--ff-only"], repo);
		if (pulled.exitCode !== 0) throw new Error(`git pull failed (exit ${pulled.exitCode}): ${pulled.stderr || pulled.stdout}`);
		const file = resolve(request.file ?? join(repo, "requirements", DEPS_FILENAME));
		return this.restoreInner({
			file,
			...request.modes === void 0 ? {} : { modes: request.modes },
			...request.dryRun === void 0 ? {} : { dryRun: request.dryRun }
		});
	}
	getConfig() {
		return loadConfig(this.home);
	}
	setConfig(config) {
		const previous = this.getConfig();
		const saved = saveConfig(this.home, config);
		if (saved.workspaceRoot.trim() !== "" && saved.workspaceRoot.trim() !== previous.workspaceRoot.trim()) recordWorkspaceHistory(this.home, this.workspaceRoot());
		return saved;
	}
	workspaceHistory() {
		return loadWorkspaceHistory(this.home);
	}
	recordWorkspaceHistory(path) {
		return recordWorkspaceHistory(this.home, path);
	}
	forgetWorkspaceHistory(path) {
		return forgetWorkspaceHistory(this.home, path);
	}
	clearWorkspaceHistory() {
		return clearWorkspaceHistory(this.home);
	}
	forgetDisabled(request) {
		return removeDisabledEntry(this.home, request.profile, request.id);
	}
	async syncConfigured() {
		return this.enqueue(() => this.syncConfiguredInner());
	}
	async syncConfiguredInner() {
		const config = this.getConfig();
		const storage = config.storagePath.trim();
		if (storage === "") throw new Error("package-manager storage path is not configured");
		const repo = resolve(storage);
		if (config.remoteUrl !== "") {
			if (!existsSync(join(repo, ".git"))) {
				if (existsSync(repo) && readdirSync(repo).length > 0) throw new Error(`package storage path is not empty and is not a git checkout: ${repo}`);
				const parent = dirname(repo);
				mkdirSync(parent, { recursive: true });
				mkdirSync(repo, { recursive: true });
				const clone = await this.git([
					"clone",
					"--quiet",
					config.remoteUrl,
					repo
				], parent);
				if (clone.exitCode !== 0) throw new Error(`git clone failed (exit ${clone.exitCode}): ${clone.stderr || clone.stdout}`);
			} else {
				const remote = await this.git([
					"remote",
					"get-url",
					"origin"
				], repo);
				if (remote.exitCode !== 0) {
					const add = await this.git([
						"remote",
						"add",
						"origin",
						config.remoteUrl
					], repo);
					if (add.exitCode !== 0) throw new Error(`git remote add failed (exit ${add.exitCode}): ${add.stderr || add.stdout}`);
				} else if (remote.stdout.trim() !== config.remoteUrl) {
					const set = await this.git([
						"remote",
						"set-url",
						"origin",
						config.remoteUrl
					], repo);
					if (set.exitCode !== 0) throw new Error(`git remote set-url failed (exit ${set.exitCode}): ${set.stderr || set.stdout}`);
				}
			}
		}
		if (!existsSync(join(repo, ".git"))) throw new Error(`package storage path is not a git checkout: ${repo}`);
		const pulled = await this.git(["pull", "--ff-only"], repo);
		if (pulled.exitCode !== 0) throw new Error(`git pull failed (exit ${pulled.exitCode}): ${pulled.stderr || pulled.stdout}`);
		const file = join(repo, "requirements", DEPS_FILENAME);
		if (!existsSync(file)) throw new Error(`requirements file not found: ${file}`);
		return this.restoreInner({ file });
	}
	/** Check a git-installed plugin for a newer remote commit and install it. */
	async checkUpdate(request) {
		return this.enqueue(() => this.checkUpdateInner(request));
	}
	async checkUpdateInner(request) {
		const { profile, id } = request;
		const logs = [];
		const log = (level, message) => {
			logs.push({
				level,
				message
			});
		};
		const entry = getEntry(loadLedger(this.home), profile, id);
		if (entry === void 0) throw new Error(`plugin ${JSON.stringify(id)} is not installed in profile ${JSON.stringify(profile)}`);
		if (entry.sourceKind !== "git") {
			log("info", `${id} is not a git source; update check skipped`);
			return {
				profile,
				id,
				status: "not-git",
				previousCommit: entry.resolvedCommit,
				latestCommit: "",
				updated: false,
				logs
			};
		}
		const github = parseGithubSpec(entry.source);
		const url = github?.url ?? entry.source.replace(/^git\+/, "");
		const targetRef = github !== void 0 && github.ref !== "" ? github.ref : entry.ref;
		if (/^[0-9a-f]{7,40}$/i.test(targetRef)) {
			log("info", `${id} is pinned to commit ${targetRef}; treated as up-to-date`);
			return {
				profile,
				id,
				status: "up-to-date",
				previousCommit: entry.resolvedCommit,
				latestCommit: entry.resolvedCommit,
				updated: false,
				logs
			};
		}
		const args = ["ls-remote", url];
		if (targetRef !== "") args.push(targetRef);
		else args.push("HEAD");
		const remote = await this.git(args, this.home);
		if (remote.exitCode !== 0) throw new Error(`git ls-remote failed (exit ${remote.exitCode}): ${remote.stderr || remote.stdout}`);
		const latestCommit = remote.stdout.trim().split(/\s+/)[0] ?? "";
		if (latestCommit === "") throw new Error(`git ls-remote returned no commit for ${url}`);
		log("info", `checked ${id}: installed ${entry.resolvedCommit} -> remote ${latestCommit}`);
		if (latestCommit === entry.resolvedCommit) return {
			profile,
			id,
			status: "up-to-date",
			previousCommit: entry.resolvedCommit,
			latestCommit,
			updated: false,
			logs
		};
		await syncGitMirror(packageStoreRoot(this.home), url, targetRef, this.git);
		const previousCommit = entry.resolvedCommit;
		const reinstall = {
			profile: entry.profile,
			id: entry.id,
			source: entry.source,
			adapter: entry.adapter,
			...entry.adapterDir === "" ? {} : { adapterDir: entry.adapterDir },
			...entry.ref === "" ? {} : { ref: entry.ref },
			allowBuild: entry.allowBuild ?? false
		};
		await this.uninstallInner({
			profile,
			id
		});
		try {
			const installed = await this.installInner(reinstall);
			logs.push(...installed.logs);
			log("info", `updated ${id} from ${previousCommit} to ${latestCommit}`);
			return {
				profile,
				id,
				status: "updated",
				previousCommit,
				latestCommit,
				updated: true,
				logs
			};
		} catch (error) {
			try {
				await this.installInner({
					...reinstall,
					ref: previousCommit
				});
			} catch (rollbackError) {
				throw new Error(`update failed (${messageOf$2(error)}); rollback to ${previousCommit} also failed: ${messageOf$2(rollbackError)}`);
			}
			throw new Error(`update failed and was rolled back to ${previousCommit}: ${messageOf$2(error)}`);
		}
	}
	async disable(request) {
		return this.enqueue(() => this.disableInner(request));
	}
	async disableInner(request) {
		const { profile, id } = request;
		const ledger = loadLedger(this.home);
		const entry = getEntry(ledger, profile, id);
		if (entry === void 0) throw new Error(`plugin ${JSON.stringify(id)} is not installed in profile ${JSON.stringify(profile)}`);
		const disabled = {
			profile,
			id,
			source: entry.source,
			adapter: entry.adapter,
			adapterDir: entry.adapterDir,
			ref: entry.ref,
			allowBuild: entry.allowBuild ?? entry.steps.some((step) => step.kind === "profile.allowBuild.add")
		};
		const alreadyDisabled = loadDisabled(this.home).some((item) => item.profile === profile && item.id === id);
		const rowIds = patchRowIdsForEntry(entry);
		if (entry.adapter === "dsh-bundle" && rowIds.length > 0) {
			const dir = entry.profileDir ?? profileDir(this.home, profile);
			const packageDir = resolveBundlePackageDir(entry);
			const managed = packageDir === void 0 ? void 0 : managedPatchForPackage(packageDir, profile, id);
			if (managed === void 0) throw new Error(`cannot disable ${JSON.stringify(id)}: its installed bundle patch is no longer resolvable`);
			writeManagedPatch(dir, id, managed.entries, true, rowIds);
			entry.disabled = true;
			saveLedger(this.home, ledger);
			return {
				profile,
				id,
				hotUnmounted: true,
				steps: entry.steps,
				logs: [{
					level: "info",
					message: `disabled ${rowIds.length} bundle patch row(s) — install kept, switched off through cordis.patch.yml`
				}],
				dryRun: false
			};
		}
		upsertDisabledEntry(this.home, disabled);
		try {
			const result = await this.uninstallInner({
				profile,
				id
			});
			upsertDisabledEntry(this.home, disabled);
			return result;
		} catch (error) {
			if (!alreadyDisabled) removeDisabledEntry(this.home, profile, id);
			throw error;
		}
	}
	async enable(request) {
		return this.enqueue(() => this.enableInner(request));
	}
	async enableInner(request) {
		const installedRaw = getEntry(loadEffectiveLedger(this.home), request.profile, request.id);
		if (installedRaw?.disabled === true && installedRaw.adapter === "dsh-bundle") {
			const rowIds = patchRowIdsForEntry(installedRaw);
			if (rowIds.length > 0) {
				const dir = installedRaw.profileDir ?? profileDir(this.home, request.profile);
				const packageDir = resolveBundlePackageDir(installedRaw);
				const managed = packageDir === void 0 ? void 0 : managedPatchForPackage(packageDir, request.profile, request.id);
				if (managed === void 0) throw new Error(`cannot enable ${JSON.stringify(request.id)}: its installed bundle patch is no longer resolvable`);
				writeManagedPatch(dir, request.id, managed.entries, false, rowIds);
				const ledger = loadLedger(this.home);
				const stored = getEntry(ledger, request.profile, request.id);
				if (stored !== void 0) {
					stored.disabled = false;
					saveLedger(this.home, ledger);
				}
				removeDisabledEntry(this.home, request.profile, request.id);
				const logs = [{
					level: "info",
					message: `enabled ${rowIds.length} bundle patch row(s) — switched back on through cordis.patch.yml`
				}];
				this.noteClientFace(installedRaw, (level, message) => logs.push({
					level,
					message
				}));
				return {
					profile: request.profile,
					id: request.id,
					adapter: installedRaw.adapter,
					packageName: installedRaw.packageName,
					pluginEnvDir: installedRaw.pluginEnvDir ?? "",
					workspaceDir: installedRaw.workspaceDir ?? this.pluginWorkspaceDir(request.profile, request.id),
					hotMounted: true,
					steps: installedRaw.steps,
					logs,
					dryRun: false
				};
			}
		}
		const disabled = loadDisabled(this.home).find((item) => item.profile === request.profile && item.id === request.id);
		if (disabled === void 0) throw new Error(`plugin ${JSON.stringify(request.id)} is not disabled in profile ${JSON.stringify(request.profile)}`);
		return this.installInner({
			profile: disabled.profile,
			id: disabled.id,
			source: disabled.source,
			adapter: disabled.adapter,
			...disabled.adapterDir === "" ? {} : { adapterDir: disabled.adapterDir },
			...disabled.ref === "" ? {} : { ref: disabled.ref },
			allowBuild: disabled.allowBuild
		});
	}
	async adapterInit(request) {
		const logs = [];
		const log = (level, message) => {
			logs.push({
				level,
				message
			});
		};
		const outDir = resolve(request.outDir);
		mkdirSync(outDir, { recursive: true });
		const materialized = await materializeSource(this.workDir("probe", request.id), request.source, request.ref ?? "", this.git, packageStoreRoot(this.home));
		if (materialized.kind === "npm") {
			log("info", `npm source ${request.source}: the dsh-bundle adapter will drive pnpm directly (no adapter file needed)`);
			this.writeDepsEntry(outDir, request, "dsh-bundle", "");
			return {
				id: request.id,
				adapter: "dsh-bundle",
				reason: "npm dependency resolved through pnpm",
				outDir,
				depsUpdated: true,
				logs
			};
		}
		const probe = probeBundleDir(materialized.dir);
		let adapter = probe.adapter;
		let adapterDir = "";
		if (probe.adapter === "dsh-bundle") log("info", `detected dsh-bundle plugin${probe.packageName === void 0 ? "" : ` ${probe.packageName}`}: no custom adapter needed`);
		else {
			adapterDir = join(outDir, "requirements", "adapters", request.id);
			mkdirSync(adapterDir, { recursive: true });
			scaffoldCustomAdapter(adapterDir, request.id, probe.reason);
			log("info", `scaffolded custom adapter at ${adapterDir} — fill in install/uninstall/verify steps, then re-run install`);
			adapter = "custom";
		}
		this.writeDepsEntry(outDir, request, adapter, adapterDir === "" ? "" : `adapters/${request.id}`);
		return {
			id: request.id,
			adapter,
			reason: probe.reason,
			outDir,
			depsUpdated: true,
			logs
		};
	}
	resolveAdapter(requested, adapterDir, source, materializedDir) {
		if (requested === "custom") {
			if (adapterDir === "" || !existsSync(adapterDir)) throw new Error(`custom adapter requested but adapterDir does not exist: ${adapterDir || "(empty)"}`);
			return {
				kind: "custom",
				reason: "requested",
				adapterDir
			};
		}
		if (requested === "dsh-bundle" && materializedDir !== "") {
			const probe = probeBundleDir(materializedDir);
			if (probe.adapter !== "dsh-bundle") throw new Error(`adapter dsh-bundle requested but ${JSON.stringify(source)} declares no dsh.bundle.patch — use adapter auto or a custom adapter`);
			return {
				kind: "dsh-bundle",
				reason: probe.reason,
				adapterDir: "",
				...probe.packageName === void 0 ? {} : { packageName: probe.packageName }
			};
		}
		if (requested === "dsh-bundle") return {
			kind: "dsh-bundle",
			reason: "requested",
			adapterDir: ""
		};
		if (materializedDir === "") return {
			kind: "dsh-bundle",
			reason: "npm dependency — bundle declaration resolved after install",
			adapterDir: ""
		};
		const probe = probeBundleDir(materializedDir);
		if (probe.adapter === "dsh-bundle") return {
			kind: "dsh-bundle",
			reason: probe.reason,
			adapterDir: "",
			...probe.packageName === void 0 ? {} : { packageName: probe.packageName }
		};
		return {
			kind: "custom",
			reason: probe.reason,
			adapterDir
		};
	}
	writeDepsEntry(outDir, request, adapter, relativeAdapterDir) {
		const depsPath = join(outDir, "requirements", DEPS_FILENAME);
		mkdirSync(dirname(depsPath), { recursive: true });
		let doc;
		if (existsSync(depsPath)) {
			const parsed = YAML.parse(readFileSync(depsPath, "utf8"));
			doc = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
		} else doc = {
			version: 1,
			repo: ".",
			modes: {}
		};
		const modes = doc.modes !== null && typeof doc.modes === "object" && !Array.isArray(doc.modes) ? doc.modes : {};
		const entries = modes[request.profile ?? "web"] !== void 0 && Array.isArray(modes[request.profile ?? "web"]) ? [...modes[request.profile ?? "web"]] : [];
		const index = entries.findIndex((entry) => entry !== null && typeof entry === "object" && entry.id === request.id);
		const entry = {
			id: request.id,
			source: request.source,
			adapter,
			allowBuild: false
		};
		if (request.ref !== void 0 && request.ref !== "") entry.ref = request.ref;
		if (relativeAdapterDir !== "") entry.adapterDir = relativeAdapterDir;
		if (index >= 0) entries[index] = entry;
		else entries.push(entry);
		modes[request.profile ?? "web"] = entries;
		doc.modes = modes;
		writeFileSync(depsPath, YAML.stringify(doc));
	}
	clearDisabled(profile, id) {
		removeDisabledEntry(this.home, profile, id);
	}
	adapterVars(ctx) {
		return {
			home: ctx.home,
			profileDir: ctx.profileDir,
			workDir: ctx.workDir,
			...ctx.workspaceDir === void 0 ? {} : { workspaceDir: ctx.workspaceDir },
			...ctx.pluginEnvDir === void 0 ? {} : { pluginEnvDir: ctx.pluginEnvDir }
		};
	}
	workDir(profile, id) {
		const safe = id.replaceAll(/[^A-Za-z0-9._-]/g, "-");
		return join(workRoot(this.home), `${profile}-${safe}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	}
	/** Anchor local directory sources so `dsh plugin add` never resolves them against the profile dir. */
	profileSpecFor(source, kind) {
		if (kind !== "file") return source;
		const prefix = source.startsWith("link:") ? "link:" : source.startsWith("file:") ? "file:" : "file:";
		const raw = source.replace(/^(?:link|file):/, "");
		return `${prefix}${resolve(raw)}`;
	}
	webRefreshMarker() {
		return join(pmRoot(this.home), WEB_REFRESH_MARKER);
	}
	touchWebRefresh() {
		mkdirSync(pmRoot(this.home), { recursive: true });
		writeFileSync(this.webRefreshMarker(), (/* @__PURE__ */ new Date()).toISOString() + "\n");
	}
	/**
	* The host's client-modules graph updates live from the loader diff; open
	* web tabs only need a reload. Missing client artifacts are reported instead
	* of failing the install.
	*/
	noteClientFace(entry, log) {
		if (entry.adapter !== "dsh-bundle" || entry.packageName === "") return;
		const packageDir = resolveBundlePackageDir(entry);
		if (packageDir === void 0) return;
		let face;
		try {
			face = clientFaceOf(packageDir);
		} catch {
			return;
		}
		if (!face.declared) return;
		if (!face.platformOk) {
			log("warn", `bundle ${entry.packageName} declares dsh.client with a non-web platform; the host client-modules registry will ignore this row`);
			return;
		}
		this.touchWebRefresh();
		if (face.artifactPath === void 0 || !existsSync(face.artifactPath)) log("warn", `bundle ${entry.packageName} declares dsh.client but the client artifact is missing (expected ${face.artifactPath ?? "lib/client.js"}); build it before reloading the web tab`);
		else log("info", `bundle ${entry.packageName} client module registered live; reload the web tab to load it`);
	}
};
/** Create a manager bound to one harness home (CLI / tests seam). */
function createPackageManager(options = {}) {
	return new PackageManager(options);
}
function idFromSource(source) {
	const github = /^github:([^/#]+?)(?:#.*)?$/.exec(source);
	if (github !== null && github[1] !== void 0) return github[1].split("/").pop() ?? github[1];
	const clean = source.replace(/^git\+/, "").replace(/(?:\.git)?#.*$/, "").replace(/^.*[/:]/, "");
	return clean === "" || clean === "." ? "plugin" : clean;
}
function npmNameOf(source) {
	const stripped = source.replace(/^npm:/, "");
	if (stripped.startsWith("@")) {
		const parts = stripped.split("/");
		if (parts.length < 2) return stripped;
		const scope = parts[0];
		const tail = (parts[1] ?? "").split("@")[0] ?? "";
		return tail === "" ? stripped : `${scope}/${tail}`;
	}
	return stripped.split("@")[0] ?? stripped;
}
function buildScriptHint(source, allowBuild, error) {
	const message = messageOf$2(error);
	if (!allowBuild && isGitSpec(source) && /build script|ignored build|approve-builds|allowBuilds|build scripts/i.test(message)) return `${message}\nhint: this git-hosted plugin runs build scripts. Re-run with allowBuild: true — the manager adds the exact package to the profile's pnpm allowBuilds list and records the inverse for uninstall.`;
	return message;
}
function messageOf$2(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/ai.ts
/**
* AI dispatch: one settings action turns a plugin link into a live agent
* session. The session's cwd is the per-plugin workspace; the workspace is
* registered with `ctx.workspaceRegistry`, and the created session is attached
* to it, so the frontend history/sidebar receives it through the normal
* host/workspace and session/created live event streams. The first prompt
* points the model at the `pm_install` / `pm_scaffold` tools registered by
* this package's `./tools` row, keeping installation in-process (and therefore
* hot-pluggable through Cordis).
* @module @dsh-ext/dsh-package-manager/ai
*/
const AGENTS_FILE = "AGENTS.md";
async function dispatchAiInstall(ctx, manager, request) {
	const agents = ctx.root.get("agents");
	if (agents === void 0) throw new Error("AI install is unavailable: this deployment mounts no dsh-agent registry");
	const workspaceRegistry = ctx.root.get("workspaceRegistry");
	if (workspaceRegistry === void 0) throw new Error("AI install is unavailable: this deployment mounts no dsh-workspace registry");
	const source = request.source.trim();
	if (source === "") throw new Error("plugin source link must not be empty");
	const profile = (request.profile ?? inferProfile(manager)).trim();
	const id = idFromSource(source);
	const workspaceDir = ensurePluginWorkspace(manager.workspaceRoot(), profile, id, source);
	writeAgentsFile(workspaceDir, profile, id, source);
	const workspace = await workspaceRegistry.resolveByPath(workspaceDir) ?? await workspaceRegistry.create(workspaceDir, `插件 · ${id}`);
	const sessionId = SessionId(request.sessionId ?? `session-${randomUUID()}`);
	const handle = await agents.create({
		sessionId,
		meta: { cwd: workspaceDir }
	});
	try {
		await workspace.attachSession(handle.agent.id);
	} catch (error) {
		await handle.dispose();
		throw new Error(`AI install session was created but could not attach to workspace ${workspace.path}: ${messageOf$1(error)}`);
	}
	const prompt = buildPrompt(profile, id, source, workspaceDir);
	handle.agent.followup(createUserMessage({
		content: [{
			type: "text",
			text: prompt
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-package-manager"
		}
	}));
	return {
		profile,
		id,
		source,
		workspaceId: workspace.id,
		workspacePath: workspace.path,
		sessionId: String(handle.agent.id),
		prompt
	};
}
function inferProfile(manager) {
	const profiles = manager.state().profiles.map((item) => item.name);
	return profiles.includes("web") ? "web" : profiles[0] ?? "web";
}
function buildPrompt(profile, id, source, workspaceDir) {
	return [
		"你是 DSH 插件工作区的安装智能体。你的 cwd 就是这个插件的专属工作区。",
		"",
		`任务：安装插件 "${id}"`,
		`来源：${source}`,
		`目标 profile：${profile}`,
		`工作区：${workspaceDir}`,
		"",
		"约束：产出的插件包必须遵守宿主 harness 的包规范（docs/cookbook/adding-a-package.zh.md）：",
		"ESM（type: module）、入口与 exports 指向已构建的 lib/ 产物、内部依赖不得使用 workspace: 协议",
		"（只发布 registry 版或自包含构建）、带 UI 的插件需声明 dsh.client 并构建 lib/client.js。",
		"",
		"安装步骤：",
		"1. 调用 `pm_install` 工具执行安装（无需参数，来源从工作区 manifest 读取）。该工具由当前进程内的包管理器执行，",
		"   dsh-bundle 插件安装为 profile 依赖后，其 bundle patch 行会写入 profile cordis.patch.yml，",
		"   宿主 watchUserPatches 立即热挂载，不需要重启。",
		"2. 如果 `pm_install` 返回错误说该插件需要自定义 adapter：",
		"   a. 调用 `pm_scaffold` 生成 adapter 骨架；",
		"   b. 阅读本目录 `requirements/adapters/<id>/adapter.yaml`，补全 install/uninstall/verify 步骤；",
		"      每一个 install 步骤都必须有显式逆操作（包管理器按 LIFO 回放，卸载不依赖单独脚本）；",
		"   c. 再次调用 `pm_install`，并传入该 adapter 目录。",
		"3. dsh-bundle 由包管理器直接安装为 profile 依赖并热挂载；custom adapter 的依赖只允许安装在 `" + join(workspaceDir, ".venv") + "` 内，禁止直接修改全局 profile。",
		"4. 完成后报告：安装方式（内置/custom adapter）、是否已热挂载、以及用户如何验证。"
	].join("\n");
}
function writeAgentsFile(workspaceDir, profile, id, source) {
	const text = [
		"# 插件安装任务",
		"",
		`- 插件 id: ${id}`,
		`- 来源: ${source}`,
		`- 目标 profile: ${profile}`,
		"",
		"优先调用 `pm_install` 工具；需要自定义 adapter 时调用 `pm_scaffold`，",
		"补全 adapter 后再次调用 `pm_install`。依赖统一放在 `.venv/` 中。",
		"",
		"包规范：ESM（type: module）、入口指向已构建产物、不用 workspace: 协议、",
		"带 UI 的插件需声明 dsh.client 并构建 lib/client.js（见宿主 docs/cookbook/adding-a-package.zh.md）。",
		""
	].join("\n");
	writeFileSync(join(workspaceDir, AGENTS_FILE), text);
}
function messageOf$1(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/localPlugins.ts
const SYSTEM_PREFIXES = [
	"@deepseek-ai/",
	"cordis:",
	"@dsh-ext/dsh-package-manager"
];
const SYSTEM_SHORT_NAMES = /* @__PURE__ */ new Set([
	"Loader",
	"Include",
	"Group",
	"Hmr",
	"Timer",
	"TimerService",
	"isolate"
]);
function isSystemPlugin(name) {
	if (name === "" || name === "root") return true;
	if (SYSTEM_SHORT_NAMES.has(name)) return true;
	return SYSTEM_PREFIXES.some((prefix) => name.startsWith(prefix));
}
var LocalPluginRegistry = class {
	ctx;
	live = /* @__PURE__ */ new Map();
	cache = /* @__PURE__ */ new Map();
	constructor(ctx) {
		this.ctx = ctx;
		this.refresh();
		ctx.on("internal/plugin", (fiber) => {
			if (!isSystemPlugin(fiber.name)) {
				this.live.set(fiber.name, fiber);
				this.cache.set(fiber.name, this.infoOf(fiber.name, fiber, false));
			}
		});
	}
	list() {
		this.refresh();
		return [...this.cache.values()].sort((left, right) => left.name.localeCompare(right.name));
	}
	/** Re-walk every registry runtime and keep cached rows for absent fibers. */
	refresh() {
		const seen = /* @__PURE__ */ new Set();
		const loaderFibers = this.loaderFibers();
		for (const runtime of this.ctx.registry.values()) for (const fiber of runtime.fibers) {
			const name = loaderFibers.get(fiber) ?? fiber.name;
			if (isSystemPlugin(name)) continue;
			seen.add(name);
			this.live.set(name, fiber);
			this.cache.set(name, this.infoOf(name, fiber, false));
		}
		for (const [name, cached] of this.cache) {
			if (seen.has(name)) continue;
			this.cache.set(name, {
				...cached,
				active: false,
				uid: null,
				cached: true
			});
		}
		return [...this.cache.values()].sort((left, right) => left.name.localeCompare(right.name));
	}
	loaderFibers() {
		const map = /* @__PURE__ */ new Map();
		const loader = this.ctx.get("loader");
		if (loader === void 0) return map;
		for (const entry of loader.entries()) {
			if (entry.fiber === void 0 || typeof entry.options?.name !== "string") continue;
			map.set(entry.fiber, entry.options.name);
		}
		return map;
	}
	infoOf(name, fiber, cached) {
		return {
			name,
			uid: fiber.uid,
			state: fiber.state,
			active: fiber.state === 2,
			cached
		};
	}
};
//#endregion
//#region src/index.ts
const name = "package-manager";
const Config = z.object({
	home: z.string().default(""),
	apiPrefix: z.string().default("/pm-api")
});
/** Cordis service wrapping the package manager core. */
var PackageManagerService = class extends Service {
	manager;
	apiPrefix;
	home;
	localPluginRegistry;
	constructor(ctx, config) {
		super(ctx, "packageManager");
		this.apiPrefix = config.apiPrefix;
		const home = config.home === "" ? resolveHome() : config.home;
		this.home = home;
		this.manager = new PackageManager({
			...config.home === "" ? {} : { home: config.home },
			host: createHost(ctx)
		});
		this.localPluginRegistry = new LocalPluginRegistry(ctx);
		ctx.effect(() => () => {
			console.log("[package-manager] DSH backend shutting down...");
		}, "package-manager: shutdown notice");
		process.on("exit", () => {
			console.log("[package-manager] DSH backend closed");
		});
		const managerConfig = this.manager.getConfig();
		if (managerConfig.autoSync && managerConfig.storagePath !== "") Promise.resolve().then(() => this.manager.syncConfigured()).catch((error) => {
			ctx.logger("package-manager").warn("package-manager auto-sync failed: %s", messageOf(error));
		});
	}
	state() {
		return {
			...this.manager.state(),
			localPlugins: this.localPluginRegistry.list()
		};
	}
	/** Live non-system plugins discovered from Cordis fibers. */
	localPlugins() {
		return this.localPluginRegistry.list();
	}
	/** Re-walk Cordis fibers and refresh the cached local-plugin view. */
	refreshLocalPlugins() {
		return this.localPluginRegistry.refresh();
	}
	doctor() {
		return this.manager.doctor();
	}
	install(request) {
		return this.manager.install(request);
	}
	uninstall(request) {
		return this.manager.uninstall(request);
	}
	restore(request) {
		return this.manager.restore(request);
	}
	sync(request) {
		return this.manager.sync(request);
	}
	syncConfigured() {
		return this.manager.syncConfigured();
	}
	adapterInit(request) {
		return this.manager.adapterInit(request);
	}
	checkUpdate(request) {
		return this.manager.checkUpdate(request);
	}
	disable(request) {
		return this.manager.disable(request);
	}
	enable(request) {
		return this.manager.enable(request);
	}
	forgetDisabled(request) {
		return this.manager.forgetDisabled(request);
	}
	getConfig() {
		return this.manager.getConfig();
	}
	setConfig(config) {
		return this.manager.setConfig(config);
	}
	clearWebRefreshMarker() {
		this.manager.clearWebRefreshMarker();
	}
	workspaceRoot() {
		return this.manager.workspaceRoot();
	}
	workspaceDefault() {
		return this.manager.workspaceDefault();
	}
	pluginWorkspaceDir(profile, id) {
		return this.manager.pluginWorkspaceDir(profile, id);
	}
	workspaceHistory() {
		return this.manager.workspaceHistory();
	}
	recordWorkspaceHistory(path) {
		return this.manager.recordWorkspaceHistory(path);
	}
	forgetWorkspaceHistory(path) {
		return this.manager.forgetWorkspaceHistory(path);
	}
	clearWorkspaceHistory() {
		return this.manager.clearWorkspaceHistory();
	}
	/** Switch the active requirements root and reconcile against its requirements file. */
	switchWorkspace(path, dryRun = false) {
		return this.manager.switchWorkspace(path, dryRun);
	}
	/** Create an AI session in one plugin workspace and dispatch installation. */
	dispatchAiInstall(request) {
		return dispatchAiInstall(this.ctx, this.manager, request);
	}
};
/** Mount the service. */
function apply(ctx, config) {
	ctx.plugin(PackageManagerService, config);
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
export { Config, HarnessHost, LocalHost, PackageManager, PackageManagerService, apply, createHost, createPackageManager, idFromSource, name };
