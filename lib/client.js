window.__ModuleLoader__.load({
	id: "@dsh-ext/dsh-package-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/locales.ts
		/** Locale dictionaries for the package-manager settings tab. */
		const zh = {
			tab: "包管理",
			pageWorkspace: "插件工作区",
			pageSettings: "详细设置",
			pageSettingsHint: "工作区配置、requirements 同步、adapter 与开发者选项。",
			currentPath: "当前路径",
			defaultPath: "默认位置",
			historyPath: "历史路径",
			newPathPlaceholder: "输入新的插件工作区根目录…",
			switchPath: "切换",
			clearHistory: "清空历史",
			installPlaceholder: "粘贴插件链接，例如 github:owner/plugin 或 https://…/plugin.git",
			installFooterHint: "安装会创建插件工作区，并派发给 AI 执行。",
			deleteConfirm: "确认删除",
			deleteDisabled: "删除记录",
			on: "开",
			off: "关",
			pluginSummary: "来源",
			section: "插件工作区",
			intro: "给每个插件一个专属工作区：工作区内有类似 Python .venv 的隔离依赖层。粘贴一个链接，派发给 AI 安装即可。",
			workspaceTitle: "插件工作区（虚拟依赖环境）",
			workspaceHint: "所有插件工作区都放在这个根目录下：<root>/<profile>/<插件>，依赖统一安装到各工作区的 .venv。留空则使用默认位置。",
			workspaceRoot: "插件工作区根目录",
			workspaceDefault: "当前生效",
			workspaceUseDefault: "使用默认",
			aiInstallTitle: "从链接安装",
			aiInstallHint: "只需一个链接。包管理器会创建插件工作区和 AI 会话，并让 AI 调用 pm_install 工具完成安装；dsh-bundle 插件支持随时热插拔。",
			dispatchToAi: "派发给 AI 安装",
			aiInstallNote: "新会话会自动出现在前端历史记录中（按插件工作区分组）。普通插件若需要自定义 adapter，AI 会调用 pm_scaffold 生成后继续。",
			installedTitle: "已安装",
			profilesTitle: "模式 (profile)",
			empty: "还没有由包管理器安装的插件。",
			restart: "插件集已变更：重启 dsh 后生效（开发时可刷新页面并观察 client-hmr）。",
			restartClear: "我知道了",
			installTitle: "安装插件",
			profile: "模式 / profile",
			source: "来源（github:owner/repo、git URL、npm 名或本地路径）",
			id: "插件 id（默认从来源推导）",
			adapter: "adapter",
			adapterAuto: "自动探测",
			adapterBundle: "内置 dsh-bundle",
			adapterCustom: "自定义（需 adapter 目录）",
			adapterDir: "自定义 adapter 目录",
			allowBuild: "允许 git 插件构建脚本（加入工作区 .venv allowBuilds，卸载时撤销）",
			install: "安装",
			uninstall: "卸载",
			dryRun: "试运行",
			restoreTitle: "从文件复原",
			requirementsFile: "requirements.yaml 路径",
			modes: "模式列表（逗号分隔，留空 = 文件内全部）",
			restore: "复原",
			syncTitle: "从 git 同步复原",
			repo: "本地 git 仓库路径",
			sync: "拉取并复原",
			adapterInitTitle: "为新插件生成 adapter",
			adapterInit: "生成（AI 填充后再安装）",
			outDir: "requirements 输出目录",
			storageTitle: "requirements 仓库与自动同步",
			storagePath: "本地存储路径",
			remoteUrl: "远程仓库 URL",
			autoSync: "启动时自动同步远程仓库",
			saveConfig: "保存设置",
			syncConfigured: "保存并立即同步",
			disabledTitle: "已关闭（可重新打开）",
			disabledEmpty: "没有处于关闭状态的插件。关闭插件 = 按记录卸载，但会记住原安装参数，可一键重新打开。",
			enable: "打开",
			disable: "关闭",
			enabled: "已启用",
			developerMode: "开发者模式",
			developerHint: "显示直接安装、requirements 复原、git 同步、adapter 生成等高级操作。",
			rawState: "原始状态",
			ref: "git 分支 / tag / commit（可选）",
			running: "执行中…",
			result: "执行结果",
			logs: "日志",
			close: "关闭",
			bundle: "bundle 层",
			dependencies: "依赖",
			actions: "计划",
			state: "状态",
			refresh: "刷新",
			env: "隔离 .venv",
			hotBadge: "热插拔",
			customBadge: "自定义 adapter"
		};
		const en = {
			tab: "Packages",
			pageWorkspace: "Plugin workspaces",
			pageSettings: "Details",
			pageSettingsHint: "Workspace config, requirements sync, adapters, and developer options.",
			currentPath: "Current path",
			defaultPath: "Default location",
			historyPath: "History",
			newPathPlaceholder: "Enter a new plugin workspace root…",
			switchPath: "Switch",
			clearHistory: "Clear history",
			installPlaceholder: "Paste a plugin link, e.g. github:owner/plugin or https://…/plugin.git",
			installFooterHint: "Creates a plugin workspace and dispatches the install to the AI.",
			deleteConfirm: "Confirm delete",
			deleteDisabled: "Delete record",
			on: "On",
			off: "Off",
			pluginSummary: "Source",
			section: "Plugin workspaces",
			intro: "Every plugin gets a dedicated workspace with an isolated dependency layer like a Python .venv. Paste one link and dispatch it to the AI.",
			workspaceTitle: "Plugin workspaces (virtual dependency env)",
			workspaceHint: "All plugin workspaces live under this root: <root>/<profile>/<plugin>, with dependencies installed in each workspace .venv. Leave empty for the default location.",
			workspaceRoot: "Plugin workspace root",
			workspaceDefault: "Effective",
			workspaceUseDefault: "Use default",
			aiInstallTitle: "Install from a link",
			aiInstallHint: "One link is all you need. The manager creates a plugin workspace and an AI session; the AI calls pm_install to finish the job. dsh-bundle plugins hot-plug through Cordis.",
			dispatchToAi: "Dispatch to AI",
			aiInstallNote: "The new session appears in the frontend history automatically, grouped under its plugin workspace. If a plugin needs a custom adapter, the AI runs pm_scaffold and continues.",
			installedTitle: "Installed",
			profilesTitle: "Modes (profiles)",
			empty: "Nothing installed through the package manager yet.",
			restart: "Plugin set changed: restart dsh to apply (in development, refresh and watch client-hmr).",
			restartClear: "Got it",
			installTitle: "Install plugin",
			profile: "Mode / profile",
			source: "Source (github:owner/repo, git URL, npm name, or local path)",
			id: "Plugin id (defaults to source-derived name)",
			adapter: "Adapter",
			adapterAuto: "Auto detect",
			adapterBundle: "Built-in dsh-bundle",
			adapterCustom: "Custom (needs adapter dir)",
			adapterDir: "Custom adapter directory",
			allowBuild: "Allow git plugin build scripts (added to the workspace .venv allowBuilds; undone on uninstall)",
			install: "Install",
			uninstall: "Uninstall",
			dryRun: "Dry run",
			restoreTitle: "Restore from file",
			requirementsFile: "requirements.yaml path",
			modes: "Modes (comma separated; empty = all in file)",
			restore: "Restore",
			syncTitle: "Sync from git",
			repo: "Local git repository path",
			sync: "Pull and restore",
			adapterInitTitle: "Scaffold adapter for a new plugin",
			adapterInit: "Scaffold (fill in with AI, then install)",
			outDir: "Requirements output directory",
			storageTitle: "Requirements repo & auto sync",
			storagePath: "Local storage path",
			remoteUrl: "Remote repository URL",
			autoSync: "Auto-sync remote repository on startup",
			saveConfig: "Save settings",
			syncConfigured: "Save & sync now",
			disabledTitle: "Switched off (re-enable anytime)",
			disabledEmpty: "No plugins are switched off. Turning a plugin off uninstalls it from its recorded steps but remembers the request for one-click re-enable.",
			enable: "Turn on",
			disable: "Turn off",
			enabled: "Enabled",
			developerMode: "Developer mode",
			developerHint: "Show direct install, requirements restore, git sync, and adapter scaffolding.",
			rawState: "Raw state",
			ref: "git branch / tag / commit (optional)",
			running: "Working…",
			result: "Result",
			logs: "Logs",
			close: "Close",
			bundle: "bundles",
			dependencies: "dependencies",
			actions: "Plan",
			state: "State",
			refresh: "Refresh",
			env: "isolated .venv",
			hotBadge: "hot-plug",
			customBadge: "custom adapter"
		};
		//#endregion
		//#region src/client/PackageManagerTab.tsx
		/**
		* Package manager settings tab.
		*
		* Page 1 is the plugin workspace: a path/history toolbar on top, scrollable
		* plugin cards in the middle, and a persistent AI-install input pinned at the
		* bottom. Page 2 keeps the original form-based settings for workspace
		* configuration and developer-mode operations.
		*/
		const CSRF_HEADER = "x-dsh-pm";
		const DEVELOPER_MODE_KEY = "dsh-package-manager.developerMode";
		async function api(path, body) {
			const init = body === void 0 ? { method: "GET" } : {
				method: "POST",
				headers: {
					"content-type": "application/json",
					[CSRF_HEADER]: "1"
				},
				body: JSON.stringify(body)
			};
			const response = await fetch(`/pm-api${path}`, init);
			const payload = await response.json();
			if (!payload.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
			return payload.value;
		}
		function logsOf(value) {
			return "logs" in value ? value.logs : [];
		}
		function resultSummary(value) {
			if ("sessionId" in value) return `session: ${value.sessionId}\nworkspace: ${value.workspacePath}`;
			return JSON.stringify(value, null, 2);
		}
		function deleteKey(target) {
			return `${target.kind}\u0000${target.profile}\u0000${target.id}`;
		}
		function sourceSummary(source, ref) {
			return ref.trim() === "" ? source : `${source} @ ${ref.trim()}`;
		}
		const styles = {
			workspaceRoot: {
				display: "flex",
				flexDirection: "column",
				height: "100%",
				minHeight: 0,
				maxWidth: 1080,
				width: "100%",
				margin: "0 auto",
				gap: 12
			},
			settingsRoot: {
				display: "flex",
				flexDirection: "column",
				gap: 18,
				maxWidth: 860,
				width: "100%",
				margin: "0 auto",
				paddingBottom: 32
			},
			intro: {
				opacity: .72,
				lineHeight: 1.7,
				margin: 0,
				fontSize: 13
			},
			topbar: {
				flex: "none",
				display: "flex",
				alignItems: "center",
				gap: 12,
				flexWrap: "wrap",
				padding: "10px 12px",
				border: "1px solid var(--dsw-border, rgba(127,127,127,0.22))",
				borderRadius: 14,
				background: "var(--dsw-surface, rgba(255,255,255,0.018))"
			},
			tabs: {
				display: "flex",
				gap: 4,
				padding: 2,
				border: "1px solid var(--dsw-border, rgba(127,127,127,0.22))",
				borderRadius: 10
			},
			tab: {
				padding: "6px 12px",
				border: "none",
				borderRadius: 8,
				background: "transparent",
				color: "inherit",
				cursor: "pointer",
				whiteSpace: "nowrap"
			},
			tabActive: {
				background: "rgba(88,136,255,0.14)",
				color: "#a8c0ff"
			},
			pathArea: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				flex: "1 1 520px",
				minWidth: 300,
				flexWrap: "wrap"
			},
			topLabel: {
				fontSize: 12,
				opacity: .66,
				whiteSpace: "nowrap"
			},
			select: {
				flex: "1 1 260px",
				minWidth: 200,
				padding: "8px 10px",
				border: "1px solid var(--dsw-border, rgba(127,127,127,0.28))",
				borderRadius: 8,
				background: "transparent",
				color: "inherit",
				textOverflow: "ellipsis"
			},
			input: {
				padding: "8px 10px",
				border: "1px solid var(--dsw-border, rgba(127,127,127,0.28))",
				borderRadius: 8,
				background: "transparent",
				color: "inherit",
				minWidth: 0
			},
			button: {
				padding: "7px 14px",
				border: "1px solid var(--dsw-border, rgba(127,127,127,0.30))",
				borderRadius: 8,
				background: "transparent",
				color: "inherit",
				cursor: "pointer",
				whiteSpace: "nowrap"
			},
			primary: {
				borderColor: "rgba(88,136,255,0.65)",
				color: "#a8c0ff",
				background: "rgba(88,136,255,0.12)"
			},
			ghost: { opacity: .78 },
			danger: {
				borderColor: "rgba(220,80,80,0.55)",
				color: "#e05a5a",
				background: "rgba(220,80,80,0.06)"
			},
			dangerArmed: {
				borderColor: "#e05a5a",
				color: "#fff",
				background: "rgba(220,80,80,0.32)"
			},
			scroller: {
				flex: 1,
				minHeight: 0,
				overflowY: "auto",
				display: "flex",
				flexDirection: "column",
				gap: 14,
				padding: "2px 2px 18px",
				scrollbarGutter: "stable"
			},
			footer: {
				flex: "none",
				display: "flex",
				alignItems: "center",
				gap: 12,
				flexWrap: "wrap",
				padding: "12px 14px",
				border: "1px solid rgba(88,136,255,0.42)",
				borderRadius: 14,
				background: "linear-gradient(135deg, rgba(88,136,255,0.10), rgba(88,136,255,0.02))"
			},
			footerInputWrap: {
				flex: "1 1 320px",
				display: "flex",
				flexDirection: "column",
				gap: 5,
				minWidth: 220
			},
			card: {
				border: "1px solid var(--dsw-border, rgba(127,127,127,0.22))",
				borderRadius: 14,
				padding: 16,
				display: "flex",
				flexDirection: "column",
				gap: 12,
				background: "var(--dsw-surface, rgba(255,255,255,0.018))"
			},
			title: {
				margin: 0,
				fontSize: 15,
				fontWeight: 650
			},
			titleRow: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 10,
				flexWrap: "wrap"
			},
			row: {
				display: "flex",
				gap: 8,
				alignItems: "center",
				flexWrap: "wrap"
			},
			field: {
				display: "flex",
				flexDirection: "column",
				gap: 6,
				flex: "1 1 240px",
				minWidth: 200
			},
			label: {
				fontSize: 12,
				opacity: .72
			},
			banner: {
				border: "1px solid rgba(255,190,80,0.55)",
				borderRadius: 12,
				padding: 12,
				display: "flex",
				gap: 10,
				alignItems: "center",
				justifyContent: "space-between",
				flexWrap: "wrap",
				background: "rgba(255,190,80,0.06)"
			},
			log: {
				fontFamily: "ui-monospace, Consolas, monospace",
				fontSize: 12,
				whiteSpace: "pre-wrap",
				margin: 0
			},
			mono: {
				fontFamily: "ui-monospace, Consolas, monospace",
				fontSize: 12,
				padding: "3px 8px",
				border: "1px solid var(--dsw-border, rgba(127,127,127,0.22))",
				borderRadius: 999,
				opacity: .86,
				overflowWrap: "anywhere"
			},
			list: {
				display: "flex",
				flexDirection: "column",
				gap: 10
			},
			pluginCard: {
				border: "1px solid var(--dsw-border, rgba(127,127,127,0.22))",
				borderRadius: 14,
				padding: 14,
				display: "flex",
				alignItems: "center",
				gap: 16,
				flexWrap: "wrap",
				background: "var(--dsw-surface, rgba(255,255,255,0.018))"
			},
			pluginName: {
				flex: "1 1 180px",
				minWidth: 150,
				display: "flex",
				flexDirection: "column",
				gap: 8,
				alignItems: "flex-start"
			},
			pluginDesc: {
				flex: "1 1 320px",
				minWidth: 220,
				display: "flex",
				flexDirection: "column",
				gap: 8,
				alignItems: "flex-start"
			},
			pluginSource: {
				margin: 0,
				fontSize: 13,
				lineHeight: 1.55,
				overflowWrap: "anywhere"
			},
			pluginActions: {
				flex: "0 0 auto",
				display: "flex",
				gap: 10,
				alignItems: "center"
			},
			meta: {
				fontSize: 12,
				opacity: .78,
				display: "flex",
				gap: 8,
				flexWrap: "wrap",
				alignItems: "center"
			},
			badge: {
				fontSize: 11,
				padding: "2px 8px",
				borderRadius: 999,
				border: "1px solid var(--dsw-border, rgba(127,127,127,0.30))",
				opacity: .82
			},
			hotBadge: {
				fontSize: 11,
				padding: "2px 8px",
				borderRadius: 999,
				border: "1px solid rgba(88,136,255,0.50)",
				color: "#a8c0ff",
				background: "rgba(88,136,255,0.08)"
			},
			aiBadge: {
				fontSize: 11,
				padding: "3px 9px",
				borderRadius: 999,
				border: "1px solid rgba(88,136,255,0.55)",
				color: "#a8c0ff",
				background: "rgba(88,136,255,0.10)",
				whiteSpace: "nowrap"
			},
			error: {
				color: "#e05a5a",
				fontSize: 12,
				whiteSpace: "pre-wrap"
			},
			switch: {
				display: "flex",
				gap: 8,
				alignItems: "center",
				fontSize: 13,
				cursor: "pointer",
				whiteSpace: "nowrap"
			},
			sectionTitle: {
				display: "flex",
				alignItems: "center",
				gap: 10,
				flexWrap: "wrap"
			}
		};
		function PackageManagerTab({ t }) {
			const [page, setPage] = (0, react.useState)("workspace");
			const [state, setState] = (0, react.useState)(null);
			const [logs, setLogs] = (0, react.useState)([]);
			const [result, setResult] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [developerMode, setDeveloperMode] = (0, react.useState)(() => {
				try {
					return localStorage.getItem(DEVELOPER_MODE_KEY) === "1";
				} catch {
					return false;
				}
			});
			const [pathDraft, setPathDraft] = (0, react.useState)("");
			const [confirmDelete, setConfirmDelete] = (0, react.useState)(null);
			const [source, setSource] = (0, react.useState)("");
			const [workspaceRoot, setWorkspaceRoot] = (0, react.useState)("");
			const [profile, setProfile] = (0, react.useState)("web");
			const [id, setId] = (0, react.useState)("");
			const [adapter, setAdapter] = (0, react.useState)("auto");
			const [adapterDir, setAdapterDir] = (0, react.useState)("");
			const [ref, setRef] = (0, react.useState)("");
			const [allowBuild, setAllowBuild] = (0, react.useState)(false);
			const [requirementsFile, setRequirementsFile] = (0, react.useState)("");
			const [modes, setModes] = (0, react.useState)("");
			const [repo, setRepo] = (0, react.useState)("");
			const [outDir, setOutDir] = (0, react.useState)("");
			const [storagePath, setStoragePath] = (0, react.useState)("");
			const [remoteUrl, setRemoteUrl] = (0, react.useState)("");
			const [autoSync, setAutoSync] = (0, react.useState)(false);
			const refresh = async () => {
				try {
					const next = await api("/state");
					setState(next);
					setError("");
				} catch (reason) {
					setError(messageOf(reason));
				}
			};
			(0, react.useEffect)(() => {
				refresh();
			}, []);
			(0, react.useEffect)(() => {
				if (state === null) return;
				setWorkspaceRoot(state.config.workspaceRoot);
				setStoragePath(state.config.storagePath);
				setRemoteUrl(state.config.remoteUrl);
				setAutoSync(state.config.autoSync);
			}, [state]);
			(0, react.useEffect)(() => {
				if (confirmDelete === null) return;
				const timer = setTimeout(() => setConfirmDelete(null), 5e3);
				return () => clearTimeout(timer);
			}, [confirmDelete]);
			const setDeveloperModePersistent = (value) => {
				setDeveloperMode(value);
				try {
					localStorage.setItem(DEVELOPER_MODE_KEY, value ? "1" : "0");
				} catch {}
			};
			const run = async (action) => {
				setBusy(true);
				setError("");
				setResult(null);
				setLogs([]);
				try {
					const value = await action();
					setResult(value);
					setLogs(logsOf(value));
					await refresh();
				} catch (reason) {
					setError(messageOf(reason));
				} finally {
					setBusy(false);
				}
			};
			const submit = (event) => {
				event.preventDefault();
			};
			const modesList = () => modes.split(",").map((mode) => mode.trim()).filter((mode) => mode !== "");
			const configPayload = (workspaceRootValue = workspaceRoot) => ({
				storagePath,
				remoteUrl,
				autoSync,
				workspaceRoot: workspaceRootValue
			});
			const targetProfile = state?.profiles.map((item) => item.name).includes("web") ? "web" : state?.profiles[0]?.name ?? "web";
			const runQuiet = async (action) => {
				setBusy(true);
				setError("");
				setResult(null);
				setLogs([]);
				try {
					await action();
					await refresh();
				} catch (reason) {
					setError(messageOf(reason));
				} finally {
					setBusy(false);
				}
			};
			const switchWorkspace = (path) => {
				const target = path.trim();
				const current = state?.workspaceRoot ?? "";
				const defaultRoot = state?.workspaceDefault ?? "";
				if (state === null || busy || target === current) return;
				const useDefault = target === "" || target === defaultRoot;
				setPathDraft("");
				runQuiet(() => api("/config", configPayload(useDefault ? "" : target)));
			};
			const clearHistory = () => {
				runQuiet(() => api("/workspace-history/clear", {}));
			};
			const requestDelete = (target) => {
				const key = deleteKey(target);
				if (confirmDelete !== key) {
					setConfirmDelete(key);
					return;
				}
				setConfirmDelete(null);
				if (target.kind === "installed") run(() => api("/uninstall", {
					profile: target.profile,
					id: target.id
				}));
				else run(() => api("/disabled/remove", {
					profile: target.profile,
					id: target.id
				}));
			};
			const currentRoot = state?.workspaceRoot ?? "";
			const defaultRoot = state?.workspaceDefault ?? "";
			const historyPaths = (state?.workspaceHistory ?? []).filter((path) => path !== currentRoot && path !== defaultRoot);
			const enabledEntries = state?.entries ?? [];
			const disabledEntries = state?.disabled ?? [];
			const resultPanel = result !== null || logs.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.card,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						style: styles.title,
						children: t("result")
					}),
					logs.map((line, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("pre", {
						style: {
							...styles.log,
							color: line.level === "error" ? "#e05a5a" : void 0
						},
						children: [
							"[",
							line.level,
							"] ",
							line.message
						]
					}, index)),
					result !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						style: styles.log,
						children: resultSummary(result)
					})
				]
			}) : null;
			const restartBanner = state?.restartNeeded === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.banner,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("restart") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: styles.button,
					disabled: busy,
					onClick: () => void run(async () => {
						await api("/restart/clear", {});
						return {
							logs: [{
								level: "info",
								message: "ok"
							}],
							dryRun: false
						};
					}),
					children: t("restartClear")
				})]
			}) : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: page === "workspace" ? styles.workspaceRoot : styles.settingsRoot,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: styles.topbar,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.tabs,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: {
								...styles.tab,
								...page === "workspace" ? styles.tabActive : {}
							},
							onClick: () => setPage("workspace"),
							children: t("pageWorkspace")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: {
								...styles.tab,
								...page === "settings" ? styles.tabActive : {}
							},
							onClick: () => setPage("settings"),
							children: t("pageSettings")
						})]
					}), page === "workspace" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.pathArea,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.topLabel,
								children: t("workspaceRoot")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								style: styles.select,
								value: currentRoot,
								disabled: state === null || busy,
								onChange: (event) => switchWorkspace(event.target.value),
								children: [
									currentRoot !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: currentRoot,
										children: [
											t("currentPath"),
											" · ",
											currentRoot
										]
									}),
									defaultRoot !== "" && defaultRoot !== currentRoot && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: defaultRoot,
										children: [
											t("defaultPath"),
											" · ",
											defaultRoot
										]
									}),
									historyPaths.map((path) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
										value: path,
										children: [
											t("historyPath"),
											" · ",
											path
										]
									}, path))
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: {
									...styles.input,
									flex: "1 1 220px",
									minWidth: 180
								},
								value: pathDraft,
								onChange: (event) => setPathDraft(event.target.value),
								placeholder: t("newPathPlaceholder")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: styles.button,
								disabled: busy || state === null || pathDraft.trim() === "",
								onClick: () => switchWorkspace(pathDraft),
								children: t("switchPath")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									...styles.button,
									...styles.ghost
								},
								disabled: busy || state === null || currentRoot === defaultRoot,
								onClick: () => switchWorkspace(defaultRoot),
								children: t("workspaceUseDefault")
							})
						]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.intro,
						children: t("pageSettingsHint")
					})]
				}), page === "workspace" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: styles.scroller,
					children: [
						restartBanner,
						error !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							style: styles.error,
							children: error
						}),
						resultPanel,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.card,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.titleRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.sectionTitle,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
											style: styles.title,
											children: t("installedTitle")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: styles.badge,
											children: enabledEntries.length
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: styles.mono,
										title: currentRoot,
										children: currentRoot || t("workspaceDefault")
									})]
								}),
								enabledEntries.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: styles.intro,
									children: t("empty")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: styles.list,
									children: enabledEntries.map((entry) => {
										const key = deleteKey({
											kind: "installed",
											profile: entry.profile,
											id: entry.id
										});
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: styles.pluginCard,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: styles.pluginName,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: entry.id }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: entry.adapter === "dsh-bundle" ? styles.hotBadge : styles.badge,
														children: entry.adapter === "dsh-bundle" ? t("hotBadge") : t("customBadge")
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: styles.pluginDesc,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
														style: styles.pluginSource,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
															style: styles.label,
															children: [t("pluginSummary"), ": "]
														}), sourceSummary(entry.source, entry.ref)]
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														style: styles.meta,
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: styles.badge,
																children: entry.profile
															}),
															entry.ref !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: styles.mono,
																children: entry.ref
															}),
															entry.pluginEnvDir !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: styles.mono,
																title: entry.pluginEnvDir,
																children: t("env")
															})
														]
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: styles.pluginActions,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														style: styles.switch,
														title: t("disable"),
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															type: "checkbox",
															checked: true,
															disabled: busy,
															onChange: () => void run(() => api("/disable", {
																profile: entry.profile,
																id: entry.id
															}))
														}), t("on")]
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														style: {
															...styles.button,
															...confirmDelete === key ? styles.dangerArmed : styles.danger
														},
														disabled: busy,
														onClick: () => requestDelete({
															kind: "installed",
															profile: entry.profile,
															id: entry.id
														}),
														children: confirmDelete === key ? t("deleteConfirm") : t("uninstall")
													})]
												})
											]
										}, `${entry.profile}/${entry.id}`);
									})
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.card,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.titleRow,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.sectionTitle,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
											style: styles.title,
											children: t("disabledTitle")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: styles.badge,
											children: disabledEntries.length
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										style: styles.intro,
										children: [
											t("enable"),
											" / ",
											t("deleteDisabled")
										]
									})]
								}),
								disabledEntries.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: styles.intro,
									children: t("disabledEmpty")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: styles.list,
									children: disabledEntries.map((item) => {
										const key = deleteKey({
											kind: "disabled",
											profile: item.profile,
											id: item.id
										});
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: styles.pluginCard,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: styles.pluginName,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.id }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: item.adapter === "dsh-bundle" ? styles.hotBadge : styles.badge,
														children: item.adapter === "dsh-bundle" ? t("hotBadge") : t("customBadge")
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: styles.pluginDesc,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
														style: styles.pluginSource,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
															style: styles.label,
															children: [t("pluginSummary"), ": "]
														}), sourceSummary(item.source, item.ref)]
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														style: styles.meta,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: styles.badge,
															children: item.profile
														}), item.ref !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: styles.mono,
															children: item.ref
														})]
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: styles.pluginActions,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														style: styles.switch,
														title: t("enable"),
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															type: "checkbox",
															checked: false,
															disabled: busy,
															onChange: () => void run(() => api("/enable", {
																profile: item.profile,
																id: item.id
															}))
														}), t("off")]
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														style: {
															...styles.button,
															...confirmDelete === key ? styles.dangerArmed : styles.danger
														},
														disabled: busy,
														onClick: () => requestDelete({
															kind: "disabled",
															profile: item.profile,
															id: item.id
														}),
														children: confirmDelete === key ? t("deleteConfirm") : t("deleteDisabled")
													})]
												})
											]
										}, `${item.profile}/${item.id}`);
									})
								})
							]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
					style: styles.footer,
					onSubmit: (event) => {
						event.preventDefault();
						if (source.trim() === "") return;
						run(() => api("/ai-install", { source: source.trim() }));
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: styles.aiBadge,
							children: "AI"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.footerInputWrap,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: styles.input,
								value: source,
								onChange: (event) => setSource(event.target.value),
								placeholder: t("installPlaceholder"),
								disabled: busy
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								style: styles.intro,
								children: [
									t("installFooterHint"),
									" · ",
									t("profile"),
									": ",
									targetProfile
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "submit",
							style: {
								...styles.button,
								...styles.primary
							},
							disabled: busy || source.trim() === "",
							children: busy ? t("running") : t("dispatchToAi")
						})
					]
				})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.intro,
						children: t("workspaceHint")
					}),
					error !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						style: styles.error,
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.titleRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: styles.title,
									children: t("workspaceTitle")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: styles.mono,
									title: currentRoot,
									children: [
										t("workspaceDefault"),
										": ",
										currentRoot
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: styles.field,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.label,
									children: t("workspaceRoot")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									style: styles.input,
									value: workspaceRoot,
									onChange: (event) => setWorkspaceRoot(event.target.value),
									placeholder: defaultRoot
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.row,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: styles.button,
										disabled: busy || state === null,
										onClick: () => void run(() => api("/config", configPayload())),
										children: busy ? t("running") : t("saveConfig")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: {
											...styles.button,
											...styles.ghost
										},
										disabled: busy || state === null || workspaceRoot.trim() === "",
										onClick: () => void run(() => api("/config", {
											...configPayload(),
											workspaceRoot: ""
										})),
										children: t("workspaceUseDefault")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: {
											...styles.button,
											...styles.ghost
										},
										disabled: busy || (state?.workspaceHistory.length ?? 0) === 0,
										onClick: clearHistory,
										children: t("clearHistory")
									})
								]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: styles.switch,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: developerMode,
							onChange: (event) => setDeveloperModePersistent(event.target.checked)
						}), t("developerMode")]
					}),
					developerMode && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: styles.intro,
							children: t("developerHint")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.card,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: styles.title,
									children: t("storageTitle")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.row,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: styles.field,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: styles.label,
											children: t("storagePath")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: styles.input,
											value: storagePath,
											onChange: (event) => setStoragePath(event.target.value)
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: styles.field,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: styles.label,
											children: t("remoteUrl")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: styles.input,
											value: remoteUrl,
											onChange: (event) => setRemoteUrl(event.target.value)
										})]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: styles.switch,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: autoSync,
										onChange: (event) => setAutoSync(event.target.checked)
									}), t("autoSync")]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.row,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: styles.button,
										disabled: busy,
										onClick: () => void run(() => api("/config", configPayload())),
										children: t("saveConfig")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: styles.button,
										disabled: busy || storagePath === "" && remoteUrl === "",
										onClick: () => void run(async () => {
											await api("/config", configPayload());
											return api("/sync-configured", {});
										}),
										children: t("syncConfigured")
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
							style: styles.card,
							onSubmit: submit,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: styles.title,
									children: t("installTitle")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.row,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: styles.field,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: styles.label,
											children: t("profile")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: styles.input,
											value: profile,
											onChange: (event) => setProfile(event.target.value)
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: styles.field,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: styles.label,
											children: t("source")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: styles.input,
											value: source,
											onChange: (event) => setSource(event.target.value)
										})]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.row,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: styles.field,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: styles.label,
											children: t("id")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: styles.input,
											value: id,
											onChange: (event) => setId(event.target.value)
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: styles.field,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: styles.label,
											children: t("adapter")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											style: styles.select,
											value: adapter,
											onChange: (event) => setAdapter(event.target.value),
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "auto",
													children: t("adapterAuto")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "dsh-bundle",
													children: t("adapterBundle")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
													value: "custom",
													children: t("adapterCustom")
												})
											]
										})]
									})]
								}),
								adapter === "custom" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: styles.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: styles.label,
										children: t("adapterDir")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										style: styles.input,
										value: adapterDir,
										onChange: (event) => setAdapterDir(event.target.value)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.row,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: styles.field,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: styles.label,
											children: t("ref")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: styles.input,
											value: ref,
											onChange: (event) => setRef(event.target.value),
											placeholder: "main"
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: styles.switch,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: allowBuild,
											onChange: (event) => setAllowBuild(event.target.checked)
										}), t("allowBuild")]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.row,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "submit",
										style: styles.button,
										disabled: busy || source === "",
										onClick: () => void run(() => api("/install", {
											profile,
											source,
											id: id === "" ? void 0 : id,
											adapter,
											adapterDir: adapterDir === "" ? void 0 : adapterDir,
											ref: ref === "" ? void 0 : ref,
											allowBuild
										})),
										children: busy ? t("running") : t("install")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: styles.button,
										disabled: busy || source === "",
										onClick: () => void run(() => api("/install", {
											profile,
											source,
											id: id === "" ? void 0 : id,
											adapter,
											adapterDir: adapterDir === "" ? void 0 : adapterDir,
											ref: ref === "" ? void 0 : ref,
											allowBuild,
											dryRun: true
										})),
										children: t("dryRun")
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
							style: styles.card,
							onSubmit: submit,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: styles.title,
									children: t("restoreTitle")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.row,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: styles.field,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: styles.label,
											children: t("requirementsFile")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: styles.input,
											value: requirementsFile,
											onChange: (event) => setRequirementsFile(event.target.value)
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: styles.field,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: styles.label,
											children: t("modes")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											style: styles.input,
											value: modes,
											onChange: (event) => setModes(event.target.value),
											placeholder: "web,headless"
										})]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.row,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "submit",
										style: styles.button,
										disabled: busy || requirementsFile === "",
										onClick: () => void run(() => api("/restore", {
											file: requirementsFile,
											modes: modesList()
										})),
										children: t("restore")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: styles.button,
										disabled: busy || requirementsFile === "",
										onClick: () => void run(() => api("/restore", {
											file: requirementsFile,
											modes: modesList(),
											dryRun: true
										})),
										children: t("dryRun")
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
							style: styles.card,
							onSubmit: submit,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: styles.title,
								children: t("syncTitle")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: styles.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: styles.label,
										children: t("repo")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										style: styles.input,
										value: repo,
										onChange: (event) => setRepo(event.target.value)
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "submit",
									style: styles.button,
									disabled: busy || repo === "",
									onClick: () => void run(() => api("/sync", {
										repo,
										modes: modesList()
									})),
									children: t("sync")
								})]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
							style: styles.card,
							onSubmit: submit,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: styles.title,
									children: t("adapterInitTitle")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.row,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											style: styles.field,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: styles.label,
												children: t("source")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												style: styles.input,
												value: source,
												onChange: (event) => setSource(event.target.value)
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											style: styles.field,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: styles.label,
												children: t("id")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												style: styles.input,
												value: id,
												onChange: (event) => setId(event.target.value)
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											style: styles.field,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: styles.label,
												children: t("outDir")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												style: styles.input,
												value: outDir,
												onChange: (event) => setOutDir(event.target.value)
											})]
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "submit",
									style: styles.button,
									disabled: busy || source === "" || id === "" || outDir === "",
									onClick: () => void run(() => api("/adapter-init", {
										source,
										id,
										outDir,
										profile,
										ref: ref === "" ? void 0 : ref
									})),
									children: t("adapterInit")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.card,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: styles.title,
									children: t("profilesTitle")
								}),
								(state?.profiles ?? []).map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.pluginCard,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.meta,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
											t("bundle"),
											": ",
											item.bundles.join(", ")
										] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
											t("dependencies"),
											": ",
											item.dependencies.length > 0 ? item.dependencies.join(", ") : "—"
										] })]
									})]
								}, item.name)),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									style: styles.title,
									children: t("rawState")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
									style: styles.log,
									children: JSON.stringify(state, null, 2)
								})
							]
						})
					] }),
					resultPanel
				] })]
			});
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		//#endregion
		//#region src/client/index.tsx
		const name = "dsh-package-manager";
		const inject = ["slots", "locale"];
		/** Dictionary namespace owned by this plugin. */
		const NS = "settings.packageManager";
		/**
		* Register the package-manager tab. Waiting on the slot declaration mirrors
		* the official registrants: a direct register racing the declaration fails.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "package-manager: dictionaries");
			const t = ctx.locale.bind(NS);
			const injectT = () => ({ t: ctx.locale.bind(NS) });
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "package-manager",
				order: 5,
				label: () => t("tab"),
				locale: NS,
				inject: injectT
			}, PackageManagerTab));
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "package-manager",
				order: 40,
				label: () => t("section"),
				locale: NS,
				inject: injectT
			}, PackageManagerTab));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
