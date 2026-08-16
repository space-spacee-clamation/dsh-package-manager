import { a as cacheRoot, c as ledgerPath, d as resolveHome, l as pmRoot, n as pluginEnvDir, o as defaultWorkspaceRoot, r as pluginWorkspaceDir, s as isAbsolutePath, t as ensurePluginWorkspace, u as profileDir } from "./pluginWorkspace-DstmGTB0.js";
import { createRequire } from "node:module";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import YAML from "yaml";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
//#region src/adapters/builtin-bundle.ts
/**
* Built-in adapter for standard DSH bundle plugins (packages declaring
* `dsh.bundle.patch`). The plugin source is materialized into its own
* workspace `.venv` (the python-virtualenv analogue for plugins), dependencies
* are installed inside that isolated layer, and the profile links the package
* in through `link:<.venv>`. This is the adapter every dsh-visualize-shaped
* plugin gets for free; anything else goes through the custom adapter.
* @module @dsh-ext/dsh-package-manager/adapters/builtin-bundle
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
* Install plan for a bundle plugin. The allowBuild whitelist entry is added
* BEFORE pnpm runs so git-hosted plugins may run their prepare scripts, and
* its inverse restores the previous list on uninstall.
* @param options - resolved install inputs.
* @returns the step list to execute.
*/
function builtinInstallSteps(options) {
	const specs = [];
	const allowBuild = options.allowBuild && (isGitSpec(options.source) || options.sourceKind === "npm");
	if (options.sourceKind === "npm") {
		specs.push({
			uses: "pluginEnv.create",
			path: options.pluginEnvDir
		});
		specs.push({
			uses: "file.write",
			path: join(options.pluginEnvDir, "package.json"),
			content: JSON.stringify({
				name: `@dsh-pm/plugin-env-${safeName(options.packageName)}`,
				private: true,
				version: "0.0.0",
				type: "module"
			}, void 0, 2) + "\n"
		});
		if (allowBuild) specs.push({
			uses: "pluginEnv.allowBuild.add",
			dir: options.pluginEnvDir,
			package: options.packageName
		});
		specs.push({
			uses: "pnpm",
			args: ["add", options.source],
			cwd: options.pluginEnvDir,
			unargs: []
		});
		specs.push({
			uses: "profile.dependency.add",
			spec: `link:${join(options.pluginEnvDir, "node_modules", options.packageName)}`,
			packageName: options.packageName
		});
	} else {
		specs.push({
			uses: "file.copy",
			from: join(options.workDir, "source"),
			to: options.pluginEnvDir
		});
		if (allowBuild) specs.push({
			uses: "pluginEnv.allowBuild.add",
			dir: options.pluginEnvDir,
			package: options.packageName
		});
		specs.push({
			uses: "pnpm",
			args: ["install"],
			cwd: options.pluginEnvDir,
			unargs: []
		});
		specs.push({
			uses: "profile.dependency.add",
			spec: `link:${options.pluginEnvDir}`,
			packageName: options.packageName
		});
	}
	specs.push({ uses: "profile.bundles.reconcile" });
	return specs;
}
function safeName(packageName) {
	const safe = packageName.replaceAll(/[^A-Za-z0-9._-]/g, "-").replaceAll(/^-+|-+$/g, "");
	return safe.length > 0 ? safe : "plugin";
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
	const result = spawnSync(command, args, {
		cwd,
		env: {
			...process.env,
			...env
		},
		encoding: "utf8",
		shell: process.platform === "win32",
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
	if (spec.uses === "profile.allowBuild.set" || spec.uses === "profile.bundles.set") {
		const packages = spec.uses === "profile.allowBuild.set" ? spec.packages : spec.bundles;
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
	constructor(pnpm = defaultPnpmRunner(), command = defaultCommandRunner()) {
		this.pnpm = pnpm;
		this.command = command;
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
				failures.push(`${record.label}: ${messageOf$4(error)}`);
				ctx.log("error", `rollback failed: ${record.label}: ${messageOf$4(error)}`);
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
				await this.runPnpm(["add", specText], ctx.profileDir, ctx);
				const packageName = addedDependency(before, readManifest(ctx.profileDir).dependencies ?? {});
				if (packageName === void 0) throw new Error(`pnpm add ${JSON.stringify(specText)} reported success but wrote no dependency`);
				const label = `pnpm add ${specText} (${packageName})`;
				return {
					...base,
					label,
					params: {
						spec: specText,
						packageName
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
				await this.runPnpm(["remove", packageName], ctx.profileDir, ctx);
				const label = `pnpm remove ${packageName}`;
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
				const before = [...readManifest(ctx.profileDir).dsh?.profile?.bundles ?? []];
				const result = reconcileBundles(ctx.profileDir);
				return {
					...base,
					label: result.changed ? `bundles reconciled (+${result.added.join(",")})` : "bundles reconciled (no change)",
					params: { added: result.added },
					inverse: {
						uses: "profile.bundles.set",
						bundles: before
					}
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
				if (directory) cpSync(from, to, {
					recursive: true,
					force: true,
					filter: (candidate) => basename(candidate) !== ".git" && basename(candidate) !== "node_modules"
				});
				else cpSync(from, to);
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
};
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
function messageOf$4(error) {
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
//#endregion
//#region src/host.ts
const COLLECT_BYTES = 4194304;
const GRACE_MS = 6e4;
/** Current-machine adapter. This is the CLI/tests default and the fallback. */
var LocalHost = class {
	name = "local";
	async pnpm(args, cwd, env) {
		return localSpawn("pnpm", args, cwd, env);
	}
	async git(args, cwd) {
		return localSpawn("git", args, cwd, {});
	}
	async shell(command, cwd, env) {
		return normalizeLocalResult("shell", spawnSync(command, {
			cwd,
			env: {
				...process.env,
				...env
			},
			encoding: "utf8",
			shell: process.platform === "win32" ? true : command.includes(" "),
			windowsHide: true
		}));
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
	name;
	fallback = new LocalHost();
	constructor(ctx, subprocess) {
		this.ctx = ctx;
		this.subprocess = subprocess;
		this.name = subprocess === void 0 ? "local (subprocess unavailable)" : "harness subprocess";
	}
	async pnpm(args, cwd, env) {
		return this.run(["pnpm", ...args], cwd, env, "pnpm");
	}
	async git(args, cwd) {
		return this.run(["git", ...args], cwd, {}, "git");
	}
	async shell(command, cwd, env) {
		const shell = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh";
		const argv = process.platform === "win32" ? [
			shell,
			"/d",
			"/s",
			"/c",
			command
		] : [
			shell,
			"-c",
			command
		];
		return this.run(argv, cwd, env, "shell");
	}
	async run(argv, cwd, env, capability) {
		if (this.subprocess === void 0) return this.runFallback(capability, argv, cwd, env);
		try {
			const executable = await this.subprocess.resolveExecutable(argv[0] ?? "", env);
			const handle = this.subprocess.spawn({
				argv: [executable, ...argv.slice(1)],
				cwd,
				env,
				graceMs: GRACE_MS,
				stdio: {
					stdin: "ignore",
					stdout: { maxBytes: COLLECT_BYTES },
					stderr: { maxBytes: COLLECT_BYTES }
				}
			});
			return {
				exitCode: (await handle.done).exitCode ?? 1,
				stdout: handle.collected.stdout?.readFrom(0).text ?? "",
				stderr: handle.collected.stderr?.readFrom(0).text ?? ""
			};
		} catch {
			return this.runFallback(capability, argv, cwd, env);
		}
	}
	runFallback(capability, argv, cwd, env) {
		if (capability === "pnpm") return this.fallback.pnpm(argv.slice(1), cwd, env);
		if (capability === "git") return this.fallback.git(argv.slice(1), cwd);
		return this.fallback.shell(commandOf(argv), cwd, env);
	}
};
function createHost(ctx) {
	if (ctx === void 0) return new LocalHost();
	return new HarnessHost(ctx, ctx.get("subprocess"));
}
function localSpawn(command, args, cwd, env) {
	return normalizeLocalResult(command, spawnSync(command, args, {
		cwd,
		env: {
			...process.env,
			...env
		},
		encoding: "utf8",
		shell: process.platform === "win32",
		windowsHide: true
	}));
}
function normalizeLocalResult(command, result) {
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
function commandOf(argv) {
	if (process.platform === "win32") return argv.slice(3).join(" ");
	return argv[2] ?? "";
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
/**
* Materialize a git/file source into `workDir/source`. File sources are copied
* so probing sees one stable snapshot; the pnpm dependency still points at the
* user-supplied original path (matching `dsh plugin` semantics).
* @param workDir - per-install scratch directory.
* @param source - verbatim source spec.
* @param ref - requested branch/tag/commit (empty = remote default).
* @param git - git runner seam.
*/
async function materializeSource(workDir, source, ref, git) {
	const kind = detectSourceKind(source);
	if (kind === "npm") return {
		kind,
		dir: "",
		resolvedCommit: ""
	};
	mkdirSync(workDir, { recursive: true });
	const dir = join(workDir, "source");
	if (kind === "git") {
		const github = parseGithubSpec(source);
		const url = github?.url ?? source.replace(/^git\+/, "");
		const targetRef = github?.ref ?? ref;
		const args = ["clone", "--quiet"];
		if (targetRef !== "") args.push("--branch", targetRef);
		if (!/^[0-9a-f]{7,40}$/i.test(targetRef)) args.push("--depth", "1");
		args.push(url, dir);
		const clone = await git(args, workDir);
		if (clone.exitCode !== 0) throw new Error(`git clone failed (exit ${clone.exitCode}): ${clone.stderr || clone.stdout}`);
		const rev = await git(["rev-parse", "HEAD"], dir);
		if (rev.exitCode !== 0) throw new Error(`git rev-parse failed (exit ${rev.exitCode}): ${rev.stderr || rev.stdout}`);
		return {
			kind,
			dir,
			resolvedCommit: rev.stdout.trim()
		};
	}
	const resolved = resolve(source.replace(/^file:/, ""));
	if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new Error(`file source is not a directory: ${resolved}`);
	cpSync(resolved, dir, {
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
		ref: entry.ref
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
	const modes = modeFilter.length > 0 ? [...modeFilter] : Object.keys(spec.modes);
	const actions = [];
	for (const mode of modes) {
		const desired = spec.modes[mode];
		if (desired === void 0) throw new Error(`requirements: mode ${JSON.stringify(mode)} is not declared`);
		const currentEntries = ledger.profiles[mode] ?? {};
		for (const entry of desired) {
			const current = currentEntries[entry.id];
			if (current === void 0) actions.push({
				action: "install",
				profile: mode,
				id: entry.id,
				reason: "declared in requirements, not installed",
				entry
			});
			else if (sameFingerprint(fingerprint(entry), current.spec)) actions.push({
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
		for (const id of Object.keys(currentEntries)) if (!desired.some((entry) => entry.id === id)) {
			const current = currentEntries[id];
			actions.push({
				action: "uninstall",
				profile: mode,
				id,
				reason: "not declared in requirements",
				...current === void 0 ? {} : { current }
			});
		}
	}
	return actions;
}
function sameFingerprint(left, right) {
	return left.source === right.source && left.adapter === right.adapter && left.adapterDir === right.adapterDir && left.ref === right.ref;
}
//#endregion
//#region src/manager.ts
/**
* Package manager core: installs, uninstalls, restores, syncs, and scaffolds
* adapters. Install steps are transactional — any failure replays the recorded
* inverses LIFO — and every successful install persists its step records so
* uninstall is the same replay, never a separately authored procedure.
* @module @dsh-ext/dsh-package-manager/manager
*/
const RESTART_MARKER = "restart-needed";
const DEPS_FILENAME = "deps.yaml";
var PackageManager = class {
	home;
	executor;
	git;
	runtime;
	constructor(options = {}) {
		this.home = options.home ?? resolveHome();
		const host = options.host ?? createHost();
		this.executor = new StepExecutor(options.pnpm ?? ((args, cwd, env) => host.pnpm(args, cwd, env)), options.command ?? ((command, cwd, env) => host.shell(command, cwd, env)));
		this.git = options.git ?? ((args, cwd) => host.git(args, cwd));
		this.runtime = options.runtime;
	}
	/** Resolved root for per-plugin workspaces (config or default). */
	workspaceRoot() {
		const configured = this.getConfig().workspaceRoot.trim();
		if (configured === "") return defaultWorkspaceRoot(this.home);
		return isAbsolute(configured) ? resolve(configured) : resolve(this.home, configured);
	}
	/** `<workspaceRoot>/<profile>/<safe-id>` for one plugin install. */
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
			restartNeeded: existsSync(this.restartMarker()),
			profiles,
			entries: listEntries(loadLedger(this.home)),
			disabled: loadDisabled(this.home),
			config: loadConfig(this.home)
		};
	}
	/** Remove the restart hint (the Web UI calls this once the user acknowledged it). */
	clearRestartMarker() {
		rmSync(this.restartMarker(), { force: true });
	}
	async install(request) {
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
			log("info", `dry run: plugin workspace ${workspaceDir}, isolated env ${envDir}`);
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
		if (getEntry(ledger, profile, id) !== void 0) throw new Error(`plugin ${JSON.stringify(id)} is already installed in profile ${JSON.stringify(profile)} — uninstall it first, or change its spec via restore`);
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
		try {
			const materialized = kind === "npm" ? void 0 : await materializeSource(workDir, source, ref, this.git);
			const resolved = this.resolveAdapter(request.adapter, request.adapterDir ?? "", source, materialized?.dir ?? "");
			const packageName = resolved.packageName ?? (kind === "npm" ? npmNameOf(source) : "");
			log("info", `adapter: ${resolved.kind}${resolved.reason === "" ? "" : ` (${resolved.reason})`}`);
			if (resolved.kind === "dsh-bundle") {
				const steps = builtinInstallSteps({
					source,
					sourceKind: kind,
					ref,
					allowBuild,
					packageName,
					pluginEnvDir: envDir,
					workDir,
					executor: this.executor
				});
				records = await this.executor.run(steps, ctx, join(workDir, "backups"));
			} else {
				if (resolved.adapterDir === "") throw new Error(`plugin ${JSON.stringify(id)} needs a custom adapter but none was provided — run adapter-init to scaffold one`);
				records = await runCustomInstall({
					adapter: loadCustomAdapter(resolved.adapterDir, this.adapterVars(ctx)),
					executor: this.executor,
					backupRoot: join(workDir, "backups")
				}, ctx);
			}
			const entry = {
				id,
				profile,
				profileDir: dir,
				source,
				sourceKind: kind,
				ref,
				adapter: resolved.kind,
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
					ref
				},
				allowBuild
			};
			let runtime = {
				mounted: false,
				reason: "no in-process runtime (CLI/tests)"
			};
			if (resolved.kind === "dsh-bundle" && this.runtime !== void 0 && packageName !== "") {
				runtime = await this.runtime.mount(entry);
				if (runtime.mounted) log("info", `hot-mounted ${packageName} through Cordis`);
				else log("warn", `live mount skipped: ${runtime.reason}`);
			}
			setEntry(ledger, entry);
			saveLedger(this.home, ledger);
			this.clearDisabled(profile, id);
			if (!runtime.mounted) this.touchRestart();
			log("info", `installed ${id} in profile ${profile} (${records.length} steps recorded)`);
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
				dryRun: false
			};
		} catch (error) {
			const message = buildScriptHint(source, allowBuild, error);
			try {
				if (records.length > 0) await this.executor.rollback(records, ctx, join(workDir, "backups"));
			} catch (rollbackError) {
				throw new Error(`${messageOf$3(error)}\n${messageOf$3(rollbackError)}`);
			}
			throw new Error(message);
		}
	}
	async uninstall(request) {
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
		const dir = profileDir(this.home, entry.profile);
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
		let runtime = {
			mounted: false,
			reason: "no in-process runtime"
		};
		if (entry.adapter === "dsh-bundle" && this.runtime !== void 0 && entry.packageName !== "") {
			runtime = await this.runtime.unmount(entry);
			if (runtime.mounted) log("info", `hot-unmounted ${entry.packageName} through Cordis`);
			else log("warn", `live unmount skipped: ${runtime.reason}`);
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
			throw new Error(`uninstall failed (ledger entry kept for retry): ${messageOf$3(error)}`);
		}
		removeEntry(ledger, entry.profile, entry.id);
		saveLedger(this.home, ledger);
		rmSync(workDir, {
			recursive: true,
			force: true
		});
		if (!runtime.mounted) this.touchRestart();
		log("info", `uninstalled ${entry.id} from profile ${entry.profile}`);
		return {
			profile: entry.profile,
			id: entry.id,
			hotUnmounted: runtime.mounted,
			steps: entry.steps,
			logs,
			dryRun: false
		};
	}
	async restore(request) {
		const logs = [];
		const log = (level, message) => {
			logs.push({
				level,
				message
			});
		};
		const file = resolve(request.file);
		const spec = parseRequirements(readFileSync(file, "utf8"), dirname(file));
		const actions = planRestore(spec, loadLedger(this.home), request.modes ?? []);
		const installed = [];
		const uninstalled = [];
		const updated = [];
		for (const action of actions) {
			log("info", `${action.action}: ${action.profile}/${action.id} — ${action.reason}`);
			if (action.action === "keep" || request.dryRun === true) continue;
			try {
				if (action.action === "uninstall" || action.action === "update") {
					const result = await this.uninstall({
						profile: action.profile,
						id: action.id
					});
					uninstalled.push(result);
					logs.push(...result.logs);
				}
				if (action.action === "install" || action.action === "update") {
					const entry = action.entry;
					const adapterDir = entry.adapter === "custom" && entry.adapterDir !== "" ? resolveAdapterDir(spec, entry.adapterDir) : "";
					const result = await this.install({
						id: entry.id,
						profile: action.profile,
						source: entry.source,
						adapter: entry.adapter,
						adapterDir,
						specAdapterDir: entry.adapterDir,
						ref: entry.ref,
						allowBuild: entry.allowBuild
					});
					installed.push(result);
					if (action.action === "update") updated.push(result);
					logs.push(...result.logs);
				}
			} catch (error) {
				throw new Error(`restore failed at ${action.action} ${action.profile}/${action.id}: ${messageOf$3(error)}`);
			}
		}
		return {
			file,
			actions,
			installed,
			uninstalled,
			updated,
			logs,
			dryRun: request.dryRun === true
		};
	}
	async sync(request) {
		const repo = resolve(request.repo);
		if (!existsSync(join(repo, ".git"))) throw new Error(`sync repo is not a git checkout: ${repo}`);
		const pulled = await this.git(["pull", "--ff-only"], repo);
		if (pulled.exitCode !== 0) throw new Error(`git pull failed (exit ${pulled.exitCode}): ${pulled.stderr || pulled.stdout}`);
		const file = resolve(request.file ?? join(repo, "requirements", DEPS_FILENAME));
		return this.restore({
			file,
			...request.modes === void 0 ? {} : { modes: request.modes },
			...request.dryRun === void 0 ? {} : { dryRun: request.dryRun }
		});
	}
	/** Persistent preferences: local requirements storage, remote URL, auto sync. */
	getConfig() {
		return loadConfig(this.home);
	}
	/** Validate and persist manager preferences. */
	setConfig(config) {
		return saveConfig(this.home, config);
	}
	/** Clone/pull the configured requirements repo, then restore its default deps.yaml. */
	async syncConfigured() {
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
		return this.restore({ file });
	}
	/** Switch a plugin off: remember its request, then uninstall it. */
	async disable(request) {
		const { profile, id } = request;
		const entry = getEntry(loadLedger(this.home), profile, id);
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
		upsertDisabledEntry(this.home, disabled);
		try {
			return await this.uninstall({
				profile,
				id
			});
		} catch (error) {
			if (!alreadyDisabled) removeDisabledEntry(this.home, profile, id);
			throw error;
		}
	}
	/** Switch a disabled plugin back on by replaying its remembered request. */
	async enable(request) {
		const disabled = loadDisabled(this.home).find((item) => item.profile === request.profile && item.id === request.id);
		if (disabled === void 0) throw new Error(`plugin ${JSON.stringify(request.id)} is not disabled in profile ${JSON.stringify(request.profile)}`);
		return this.install({
			profile: disabled.profile,
			id: disabled.id,
			source: disabled.source,
			adapter: disabled.adapter,
			...disabled.adapterDir === "" ? {} : { adapterDir: disabled.adapterDir },
			...disabled.ref === "" ? {} : { ref: disabled.ref },
			allowBuild: disabled.allowBuild
		});
	}
	/** Analyze a source and scaffold a requirements entry + adapter for it. */
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
		const materialized = await materializeSource(this.workDir("probe", request.id), request.source, request.ref ?? "", this.git);
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
			reason: "npm dependency — bundle declaration reconciled after install",
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
		return join(cacheRoot(this.home), "work", `${profile}-${safe}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	}
	restartMarker() {
		return join(pmRoot(this.home), RESTART_MARKER);
	}
	touchRestart() {
		mkdirSync(pmRoot(this.home), { recursive: true });
		writeFileSync(this.restartMarker(), (/* @__PURE__ */ new Date()).toISOString() + "\n");
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
	const message = messageOf$3(error);
	if (!allowBuild && isGitSpec(source) && /build script|ignored build|approve-builds|allowBuilds|build scripts/i.test(message)) return `${message}\nhint: this git-hosted plugin runs build scripts. Re-run with allowBuild: true — the manager adds the exact package to the profile's pnpm allowBuilds list and records the inverse for uninstall.`;
	return message;
}
function messageOf$3(error) {
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
		throw new Error(`AI install session was created but could not attach to workspace ${workspace.path}: ${messageOf$2(error)}`);
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
		"安装步骤：",
		"1. 调用 `pm_install` 工具执行安装（无需参数，来源从工作区 manifest 读取）。该工具由当前进程内的包管理器执行，",
		"   dsh-bundle 插件安装完成后会立即通过 Cordis 热挂载，不需要重启。",
		"2. 如果 `pm_install` 返回错误说该插件需要自定义 adapter：",
		"   a. 调用 `pm_scaffold` 生成 adapter 骨架；",
		"   b. 阅读本目录 `requirements/adapters/<id>/adapter.yaml`，补全 install/uninstall/verify 步骤；",
		"      每一个 install 步骤都必须有显式逆操作（包管理器按 LIFO 回放，卸载不依赖单独脚本）；",
		"   c. 再次调用 `pm_install`，并传入该 adapter 目录。",
		"3. 依赖只允许安装在 `" + join(workspaceDir, ".venv") + "` 内，禁止直接修改全局 profile。",
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
		""
	].join("\n");
	writeFileSync(join(workspaceDir, AGENTS_FILE), text);
}
function messageOf$2(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
//#region src/runtime.ts
/**
* Cordis hot-plug seam for installed plugins. The package-manager service is
* itself a Cordis plugin, so installing another plugin does not require a
* process restart: import the freshly linked module and `ctx.plugin()` it in
* the current context. The returned fiber is the live component; disposing it
* unwinds every effect the plugin registered. This is the runtime realization
* of the paper's time-compositionality contract — uninstall removes the
* provider, Cordis disposes its effects, and only then the package manager
* replays the recorded inverse steps.
* @module @dsh-ext/dsh-package-manager/runtime
*/
const NOT_BUNDLE = {
	mounted: false,
	reason: "entry is not a hot-loadable dsh-bundle package"
};
var CordisRuntime = class {
	ctx;
	fibers = /* @__PURE__ */ new Map();
	constructor(ctx) {
		this.ctx = ctx;
	}
	key(entry) {
		return `${entry.profile}\u0000${entry.id}`;
	}
	async mount(entry) {
		if (entry.adapter !== "dsh-bundle" || entry.packageName === "") return NOT_BUNDLE;
		const key = this.key(entry);
		if (this.fibers.has(key)) return {
			mounted: false,
			reason: "already hot-mounted by this package-manager instance"
		};
		try {
			const plugin = pluginOf(await this.importPlugin(entry));
			if (this.ctx.registry.has(plugin)) return {
				mounted: false,
				reason: `${entry.packageName} is already active in the Cordis registry`
			};
			const fiber = this.ctx.plugin(plugin);
			await fiber;
			this.fibers.set(key, fiber);
			return {
				mounted: true,
				reason: ""
			};
		} catch (error) {
			return {
				mounted: false,
				reason: messageOf$1(error)
			};
		}
	}
	async unmount(entry) {
		if (entry.adapter !== "dsh-bundle" || entry.packageName === "") return NOT_BUNDLE;
		const key = this.key(entry);
		try {
			const owned = this.fibers.get(key);
			if (owned !== void 0) {
				await owned.dispose();
				this.fibers.delete(key);
				return {
					mounted: true,
					reason: ""
				};
			}
			const plugin = pluginOf(await this.importPlugin(entry));
			const runtime = this.ctx.registry.get(plugin);
			if (runtime !== void 0) {
				await Promise.all([...runtime.fibers].map((fiber) => fiber.dispose()));
				this.ctx.registry.delete(plugin);
				return {
					mounted: true,
					reason: ""
				};
			}
			return {
				mounted: false,
				reason: `${entry.packageName} has no live Cordis fiber`
			};
		} catch (error) {
			return {
				mounted: false,
				reason: messageOf$1(error)
			};
		}
	}
	/**
	* Resolve the package entrypoint through the target profile's node_modules.
	* This also works when dsh-package-manager itself is linked from outside
	* the profile: a bare dynamic import would resolve relative to THIS module,
	* while the installed plugin is linked into the profile.
	*/
	async importPlugin(entry) {
		if (entry.packageName.startsWith("data:") || entry.packageName.startsWith("file:")) return import(
			/* @vite-ignore */
			entry.packageName
);
		if (entry.profileDir !== void 0 && entry.profileDir !== "") {
			const require = createRequire(join(entry.profileDir, "package.json"));
			let resolved;
			try {
				resolved = require.resolve(entry.packageName);
			} catch {
				resolved = resolvePackageEntry(require.resolve.paths(entry.packageName) ?? [], entry.packageName);
			}
			return import(pathToFileURL(resolved).href);
		}
		return import(
			/* @vite-ignore */
			entry.packageName
);
	}
};
function resolvePackageEntry(searchPaths, packageName) {
	for (const searchPath of searchPaths) {
		const root = join(searchPath, packageName);
		const manifestPath = join(root, "package.json");
		if (!existsSync(manifestPath)) continue;
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		const entry = (typeof manifest.exports === "string" ? manifest.exports : typeof manifest.exports === "object" && manifest.exports !== null ? exportTargetOf(manifest.exports["."]) : void 0) ?? manifest.module ?? manifest.main ?? "index.js";
		return join(root, entry);
	}
	throw new Error(`cannot resolve package entrypoint for ${JSON.stringify(packageName)}`);
}
function exportTargetOf(target) {
	if (typeof target === "string") return target;
	return target?.default ?? target?.import ?? target?.require;
}
function pluginOf(loaded) {
	const record = loaded;
	const candidate = record !== null && typeof record === "object" && "default" in record && record.default !== void 0 ? record.default : loaded;
	if (typeof candidate === "function") return candidate;
	if (candidate !== null && typeof candidate === "object" && typeof candidate.apply === "function") return candidate;
	throw new Error("plugin module has no function, class, or { apply } entrypoint");
}
function messageOf$1(error) {
	return error instanceof Error ? error.message : String(error);
}
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
	constructor(ctx, config) {
		super(ctx, "packageManager");
		this.apiPrefix = config.apiPrefix;
		this.manager = new PackageManager({
			...config.home === "" ? {} : { home: config.home },
			host: createHost(ctx),
			runtime: new CordisRuntime(ctx)
		});
		const managerConfig = this.manager.getConfig();
		if (managerConfig.autoSync && managerConfig.storagePath !== "") Promise.resolve().then(() => this.manager.syncConfigured()).catch((error) => {
			ctx.logger("package-manager").warn("package-manager auto-sync failed: %s", messageOf(error));
		});
	}
	/** Create an AI session in one plugin workspace and dispatch installation. */
	dispatchAiInstall(request) {
		return dispatchAiInstall(this.ctx, this.manager, request);
	}
};
/**
* Mount the service.
* @param ctx - registrant context.
* @param config - validated deployment configuration.
*/
function apply(ctx, config) {
	ctx.plugin(PackageManagerService, config);
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
export { Config, HarnessHost, LocalHost, PackageManager, PackageManagerService, apply, createHost, createPackageManager, idFromSource, name };
