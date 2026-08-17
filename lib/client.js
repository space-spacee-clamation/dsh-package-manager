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
			pageWorkspace: "插件管理",
			pageSettings: "详细设置",
			pageSettingsHint: "requirements 同步、custom adapter 与开发者选项。",
			currentPath: "当前路径",
			requirementsRoot: "requirements 根目录",
			defaultPath: "默认位置",
			historyPath: "历史路径",
			newPathPlaceholder: "输入新的插件工作区根目录…",
			workspaceSwitchHint: "切换 requirements 根目录后会自动按 deps.yaml 对齐：安装缺失插件、关闭多余插件。",
			switchPath: "切换",
			realignWorkspace: "重新对齐",
			clearHistory: "清空历史",
			installPlaceholder: "粘贴插件链接，例如 github:owner/plugin 或 https://…/plugin.git",
			installFooterHint: "安装会创建 AI 工作目录并派发给 AI 执行；dsh-bundle 热挂载无需重启。",
			deleteConfirm: "确认删除",
			deleteDisabled: "删除记录",
			on: "开",
			off: "关",
			pluginSummary: "来源",
			packageName: "包名",
			patchBlock: "cordis.patch.yml 托管块",
			section: "插件管理",
			sidebarLabel: "插件管理",
			switchedOffTitle: "已关闭（保留安装）",
			switchedOffHint: "关闭 = 热禁用补丁行，安装保留；点击按钮重新打开。",
			intro: "dsh-bundle 直接安装为 profile 依赖，bundle patch 行写入 cordis.patch.yml，由官方 watchUserPatches 热装卸。粘贴链接，派发给 AI 安装即可。",
			workspaceTitle: "插件管理（官方热重载）",
			workspaceHint: "工作区根目录仅作为 AI 安装会话与 custom adapter 的工作目录；dsh-bundle 依赖装在 profile，热装卸状态在 profile 的 cordis.patch.yml。",
			workspaceRoot: "工作区根目录（AI 会话 / custom adapter）",
			workspaceDefault: "当前生效",
			workspaceUseDefault: "使用默认",
			aiInstallTitle: "从链接安装",
			aiInstallHint: "只需一个链接。包管理器会创建 AI 工作目录和会话，并让 AI 调用 pm_install 完成安装；dsh-bundle 通过官方 watchUserPatches 热插拔。",
			dispatchToAi: "派发给 AI 安装",
			aiInstallNote: "新会话会自动出现在前端历史记录中（按插件工作区分组）。普通插件若需要 custom adapter，AI 会调用 pm_scaffold 生成后继续。",
			installedTitle: "已安装",
			profilesTitle: "模式 (profile)",
			empty: "还没有由包管理器安装的插件。",
			restart: "插件集已变更：重启 dsh 后生效（开发时可刷新页面并观察 client-hmr）。",
			restartClear: "我知道了",
			webRefresh: "已安装带界面的插件：页面模块图已热更新，刷新网页标签即可加载。",
			webRefreshClear: "我知道了",
			installTitle: "安装插件",
			profile: "模式 / profile",
			source: "来源（github:owner/repo、git URL、npm 名或本地路径）",
			id: "插件 id（默认从来源推导）",
			adapter: "adapter",
			adapterAuto: "自动探测",
			adapterBundle: "内置 dsh-bundle",
			adapterCustom: "自定义（需 adapter 目录）",
			adapterDir: "自定义 adapter 目录",
			allowBuild: "允许 git 插件构建脚本（加入 profile 的 pnpm allowBuilds，卸载时撤销）",
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
			disabledEmpty: "没有处于关闭状态的插件。dsh-bundle 关闭=保留安装、热禁用补丁行；无稳定行的插件关闭=卸载并记住原参数。",
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
			env: "cordis.patch.yml 热重载块",
			hotBadge: "热插拔",
			customBadge: "自定义 adapter"
		};
		const en = {
			tab: "Packages",
			pageWorkspace: "Packages",
			pageSettings: "Details",
			pageSettingsHint: "Requirements sync, custom adapters, and developer options.",
			currentPath: "Current path",
			requirementsRoot: "Requirements root",
			defaultPath: "Default location",
			historyPath: "History",
			newPathPlaceholder: "Enter a new plugin workspace root…",
			workspaceSwitchHint: "Switching requirements roots reconciles against deps.yaml: missing plugins are installed and extra plugins are closed.",
			switchPath: "Switch",
			realignWorkspace: "Re-align",
			clearHistory: "Clear history",
			installPlaceholder: "Paste a plugin link, e.g. github:owner/plugin or https://…/plugin.git",
			installFooterHint: "Creates an AI working directory and dispatches the install; dsh-bundle hot-mounts without a restart.",
			deleteConfirm: "Confirm delete",
			deleteDisabled: "Delete record",
			on: "On",
			off: "Off",
			pluginSummary: "Source",
			packageName: "package",
			patchBlock: "cordis.patch.yml hot-reload block",
			section: "Packages",
			sidebarLabel: "Packages",
			switchedOffTitle: "Switched off (install kept)",
			switchedOffHint: "Switched-off rows are hot-disabled but still installed. Click the button to turn them back on.",
			intro: "dsh-bundle installs as a profile dependency and its bundle patch rows are written to cordis.patch.yml for the official watchUserPatches hot reload. Paste a link and dispatch it to the AI.",
			workspaceTitle: "Packages (official hot reload)",
			workspaceHint: "This root is only the AI session / custom-adapter working directory. dsh-bundle dependencies live in the profile and their hot-reload state lives in the profile cordis.patch.yml.",
			workspaceRoot: "Workspace root (AI session / custom adapters)",
			workspaceDefault: "Effective",
			workspaceUseDefault: "Use default",
			aiInstallTitle: "Install from a link",
			aiInstallHint: "One link is all you need. The manager creates an AI working directory and session; the AI calls pm_install. dsh-bundle plugins hot-plug through the official watchUserPatches path.",
			dispatchToAi: "Dispatch to AI",
			aiInstallNote: "The new session appears in the frontend history automatically, grouped under its plugin workspace. If a plugin needs a custom adapter, the AI runs pm_scaffold and continues.",
			installedTitle: "Installed",
			profilesTitle: "Modes (profiles)",
			empty: "Nothing installed through the package manager yet.",
			restart: "Plugin set changed: restart dsh to apply (in development, refresh and watch client-hmr).",
			restartClear: "Got it",
			webRefresh: "A plugin with a web UI was installed: the client module graph is already live, reload the web tab to load it.",
			webRefreshClear: "Got it",
			installTitle: "Install plugin",
			profile: "Mode / profile",
			source: "Source (github:owner/repo, git URL, npm name, or local path)",
			id: "Plugin id (defaults to source-derived name)",
			adapter: "Adapter",
			adapterAuto: "Auto detect",
			adapterBundle: "Built-in dsh-bundle",
			adapterCustom: "Custom (needs adapter dir)",
			adapterDir: "Custom adapter directory",
			allowBuild: "Allow git plugin build scripts (added to the profile pnpm allowBuilds; undone on uninstall)",
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
			disabledEmpty: "No plugins are switched off. dsh-bundle rows are disabled in place; plugins without stable rows are uninstalled and remembered for one-click re-enable.",
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
			env: "cordis.patch.yml hot-reload block",
			hotBadge: "hot-plug",
			customBadge: "custom adapter"
		};
		//#endregion
		//#region src/client/styles.ts
		const NEUTRAL_900 = "hsl(227, 75%, 14%)";
		const NEUTRAL_600 = "hsl(226, 11%, 37%)";
		const NEUTRAL_300 = "hsl(0, 0%, 78%)";
		const NEUTRAL_200 = "hsl(217, 61%, 90%)";
		const NEUTRAL_100 = "hsl(0, 0%, 93%)";
		const NEUTRAL_0 = "hsl(200, 60%, 99%)";
		const RED_500 = "hsl(3, 71%, 56%)";
		const CANVAS = "linear-gradient(180deg, #F5F6F8 0%, #ECEEF1 100%)";
		const BORDER = "#D6D9E6";
		const TEXT = NEUTRAL_900;
		const MUTED = "rgba(39, 49, 86, 0.62)";
		const ACCENT = "#4f6ef7";
		const ACCENT_BG = "#EDF2FF";
		const ACCENT_BORDER = "#C7D4FA";
		const styles = {
			workspaceRoot: {
				position: "relative",
				display: "flex",
				flexDirection: "column",
				height: "100%",
				minHeight: 0,
				maxWidth: 1200,
				width: "100%",
				margin: "0 auto",
				gap: 12,
				padding: "12px 16px 14px",
				overflow: "hidden",
				background: CANVAS,
				color: TEXT,
				fontFamily: "'Noto Sans', 'Segoe UI', sans-serif"
			},
			settingsRoot: {
				display: "flex",
				flexDirection: "column",
				gap: 16,
				maxWidth: 960,
				width: "100%",
				margin: "0 auto",
				padding: "0 0 40px",
				background: "transparent",
				color: TEXT,
				fontFamily: "'Noto Sans', 'Segoe UI', sans-serif"
			},
			header: {
				flex: "none",
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 14,
				flexWrap: "wrap",
				padding: "4px 6px"
			},
			brand: {
				display: "flex",
				alignItems: "center",
				gap: 12,
				minWidth: 0
			},
			logo: {
				width: 44,
				height: 44,
				flex: "none",
				display: "grid",
				placeItems: "center",
				fontSize: 17,
				fontWeight: 850,
				color: "#ffffff",
				background: ACCENT,
				borderRadius: 14
			},
			pageTitle: {
				margin: 0,
				fontSize: 20,
				fontWeight: 780,
				letterSpacing: -.2
			},
			pageSubtitle: {
				margin: "4px 0 0",
				fontSize: 13,
				color: MUTED,
				lineHeight: 1.55
			},
			intro: {
				color: MUTED,
				lineHeight: 1.7,
				margin: 0,
				fontSize: 13
			},
			pathCard: {
				flex: "none",
				display: "flex",
				alignItems: "center",
				gap: 10,
				flexWrap: "wrap",
				padding: "14px 16px",
				border: `1px solid ${BORDER}`,
				borderRadius: 20,
				background: NEUTRAL_0,
				boxShadow: "0 2px 4px rgba(0,0,0,0.05)"
			},
			pathArea: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				flex: "1 1 560px",
				minWidth: 340,
				flexWrap: "wrap"
			},
			topLabel: {
				fontSize: 12,
				color: MUTED,
				whiteSpace: "nowrap",
				fontWeight: 700
			},
			tabs: {
				display: "flex",
				gap: 6,
				padding: 5,
				border: `1px solid ${BORDER}`,
				borderRadius: 16,
				background: NEUTRAL_100
			},
			tab: {
				padding: "8px 16px",
				border: "1px solid transparent",
				borderRadius: 12,
				background: "transparent",
				color: MUTED,
				cursor: "pointer",
				whiteSpace: "nowrap",
				fontSize: 13,
				fontWeight: 700
			},
			tabActive: {
				background: "#ffffff",
				color: TEXT,
				borderColor: BORDER
			},
			select: {
				flex: "1 1 260px",
				minWidth: 200,
				padding: "10px 12px",
				border: `1px solid ${BORDER}`,
				borderRadius: 12,
				background: "#ffffff",
				color: TEXT,
				textOverflow: "ellipsis"
			},
			input: {
				padding: "10px 12px",
				border: `1px solid ${BORDER}`,
				borderRadius: 12,
				background: "#ffffff",
				color: TEXT,
				minWidth: 0
			},
			button: {
				padding: "9px 15px",
				border: `1px solid ${BORDER}`,
				borderRadius: 12,
				background: "#ffffff",
				color: TEXT,
				cursor: "pointer",
				whiteSpace: "nowrap",
				fontSize: 13,
				fontWeight: 700
			},
			primary: {
				borderColor: ACCENT_BORDER,
				color: ACCENT,
				background: ACCENT_BG
			},
			ghost: { opacity: .8 },
			danger: {
				borderColor: "#F1B7B2",
				color: "#B3342B",
				background: "#FFF3F2"
			},
			dangerArmed: {
				borderColor: "#B3342B",
				color: "#ffffff",
				background: "#B3342B"
			},
			scroller: {
				flex: 1,
				minHeight: 0,
				overflowY: "auto",
				display: "flex",
				flexDirection: "column",
				gap: 12,
				padding: "2px 4px 12px",
				scrollbarGutter: "stable"
			},
			footer: {
				flex: "none",
				display: "flex",
				alignItems: "center",
				gap: 14,
				flexWrap: "wrap",
				padding: "16px 18px",
				border: `1px solid ${ACCENT_BORDER}`,
				borderRadius: 20,
				background: "#ffffff"
			},
			footerInputWrap: {
				flex: "1 1 340px",
				display: "flex",
				flexDirection: "column",
				gap: 5,
				minWidth: 230
			},
			card: {
				border: `1px solid ${BORDER}`,
				borderRadius: 20,
				padding: 18,
				display: "flex",
				flexDirection: "column",
				gap: 14,
				background: NEUTRAL_0,
				boxShadow: "0 2px 4px rgba(0,0,0,0.05)"
			},
			title: {
				margin: 0,
				fontSize: 16,
				fontWeight: 780
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
				gap: 10,
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
				color: MUTED,
				fontWeight: 700
			},
			banner: {
				border: `1px solid #E8C98B`,
				borderRadius: 14,
				padding: "12px 14px",
				display: "flex",
				gap: 10,
				alignItems: "center",
				justifyContent: "space-between",
				flexWrap: "wrap",
				background: "#FFF8E9"
			},
			logPanel: {
				maxHeight: 180,
				overflowY: "auto",
				display: "flex",
				flexDirection: "column",
				gap: 6
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
				padding: "4px 9px",
				border: `1px solid ${BORDER}`,
				borderRadius: 999,
				color: MUTED,
				overflowWrap: "anywhere"
			},
			pluginGrid: {
				display: "grid",
				gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
				gap: 14,
				alignItems: "stretch"
			},
			list: {
				display: "flex",
				flexDirection: "column",
				gap: 10
			},
			pluginCard: {
				border: `1px solid ${BORDER}`,
				borderRadius: 20,
				padding: "16px 16px 14px",
				display: "flex",
				flexDirection: "column",
				gap: 12,
				minHeight: 168,
				background: "#ffffff",
				boxShadow: "0 2px 4px rgba(0,0,0,0.05)"
			},
			hotCard: { borderColor: ACCENT_BORDER },
			disabledCard: {
				opacity: .55,
				background: NEUTRAL_100
			},
			pluginTop: {
				display: "flex",
				gap: 12,
				alignItems: "flex-start",
				minWidth: 0
			},
			pluginLogo: {
				width: 40,
				height: 40,
				flex: "none",
				display: "grid",
				placeItems: "center",
				borderRadius: 12,
				background: ACCENT_BG,
				color: ACCENT,
				fontSize: 15,
				fontWeight: 850
			},
			pluginName: {
				display: "flex",
				flexDirection: "column",
				gap: 5,
				alignItems: "flex-start",
				minWidth: 0
			},
			pluginTitle: {
				margin: 0,
				fontSize: 15,
				fontWeight: 780
			},
			pluginDesc: {
				flex: 1,
				display: "flex",
				flexDirection: "column",
				gap: 8,
				alignItems: "flex-start",
				minWidth: 0
			},
			pluginSource: {
				margin: 0,
				fontSize: 12,
				lineHeight: 1.5,
				overflowWrap: "anywhere",
				color: MUTED,
				display: "-webkit-box",
				WebkitLineClamp: 2,
				WebkitBoxOrient: "vertical",
				overflow: "hidden"
			},
			pluginBottom: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 10,
				marginTop: "auto"
			},
			pluginActions: {
				display: "flex",
				gap: 10,
				alignItems: "center",
				flexWrap: "wrap"
			},
			meta: {
				fontSize: 12,
				color: MUTED,
				display: "flex",
				gap: 8,
				flexWrap: "wrap",
				alignItems: "center"
			},
			badge: {
				fontSize: 11,
				padding: "3px 9px",
				borderRadius: 999,
				border: `1px solid ${BORDER}`,
				color: MUTED,
				background: "#F7F8FA"
			},
			hotBadge: {
				fontSize: 11,
				padding: "3px 9px",
				borderRadius: 999,
				border: `1px solid ${ACCENT_BORDER}`,
				color: ACCENT,
				background: ACCENT_BG
			},
			aiBadge: {
				fontSize: 11,
				padding: "5px 11px",
				borderRadius: 999,
				border: `1px solid ${ACCENT_BORDER}`,
				color: "#ffffff",
				background: ACCENT,
				whiteSpace: "nowrap",
				fontWeight: 850
			},
			error: {
				color: "#B3342B",
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
			},
			statusDot: {
				width: 8,
				height: 8,
				borderRadius: 999,
				flex: "none",
				background: "#3fae5a"
			},
			switchTrack: {
				position: "relative",
				display: "inline-block",
				width: 50,
				height: 28,
				cursor: "pointer"
			},
			switchInput: {
				opacity: 0,
				width: 0,
				height: 0
			},
			switchSlider: {
				position: "absolute",
				inset: 0,
				background: NEUTRAL_300,
				borderRadius: 28,
				transition: "0.3s"
			},
			switchSliderOn: { background: RED_500 },
			switchKnob: {
				position: "absolute",
				height: 20,
				width: 20,
				left: 4,
				bottom: 4,
				background: "#ffffff",
				borderRadius: "50%",
				transition: "0.3s"
			},
			switchKnobOn: { transform: "translateX(22px)" },
			toggleOn: {
				minWidth: 58,
				padding: "7px 12px",
				borderRadius: 12,
				border: `1px solid ${ACCENT_BORDER}`,
				background: ACCENT_BG,
				color: ACCENT,
				fontSize: 13,
				fontWeight: 750,
				cursor: "pointer"
			},
			toggleOff: {
				minWidth: 58,
				padding: "7px 12px",
				borderRadius: 12,
				border: `1px solid ${BORDER}`,
				background: NEUTRAL_200,
				color: NEUTRAL_600,
				fontSize: 13,
				fontWeight: 700,
				cursor: "pointer"
			},
			resultOverlay: {
				position: "absolute",
				right: 16,
				bottom: 90,
				width: 390,
				maxWidth: "calc(100% - 32px)",
				zIndex: 30,
				border: `1px solid ${ACCENT_BORDER}`,
				borderRadius: 18,
				background: "#ffffff",
				color: TEXT,
				padding: 14,
				display: "flex",
				flexDirection: "column",
				gap: 10,
				maxHeight: 320,
				overflow: "hidden",
				boxShadow: "0 6px 18px rgba(30,50,100,0.12)"
			}
		};
		//#endregion
		//#region src/client/PackageManagerTab.tsx
		/**
		* Package manager settings tab.
		*
		* Page 1 is the package list: a requirements-root toolbar on top, scrollable
		* plugin cards in the middle, and a persistent AI-install input pinned at the
		* bottom. Page 2 keeps the original form-based settings for requirements
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
			const text = await response.text();
			if (text.trim() === "") throw new Error(`HTTP ${response.status} 返回了空响应；DSH 可能在切换插件时重启了，请稍候重试或使用 CLI / AI 工具执行对齐`);
			let payload;
			try {
				payload = JSON.parse(text);
			} catch {
				throw new Error(`HTTP ${response.status} 返回了非 JSON 响应：${text.slice(0, 120)}`);
			}
			if (!payload.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
			return payload.value;
		}
		function logsOf(value) {
			return "logs" in value ? value.logs : [];
		}
		function resultSummary(value) {
			if ("sessionId" in value) return `session: ${value.sessionId}\nworkspace: ${value.workspacePath}`;
			if ("actions" in value) return value.actions.map((action) => `${action.action}: ${action.profile}/${action.id} — ${action.reason}`).join("\n");
			return JSON.stringify(value, null, 2);
		}
		function deleteKey(target) {
			return `${target.kind}\u0000${target.profile}\u0000${target.id}`;
		}
		function sourceSummary(source, ref) {
			return ref.trim() === "" ? source : `${source} @ ${ref.trim()}`;
		}
		function delay(milliseconds) {
			return new Promise((resolve) => setTimeout(resolve, milliseconds));
		}
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
					const message = messageOf(reason);
					setError(message);
					if (/空响应|Failed to fetch|NetworkError|fetch failed/i.test(message)) setTimeout(() => void refresh(), 1500);
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
			const switchWorkspace = (path, force = false) => {
				const target = path.trim();
				const current = state?.workspaceRoot ?? "";
				const defaultRoot = state?.workspaceDefault ?? "";
				if (state === null || busy || !force && target === current) return;
				const rawTarget = target === "" || target === defaultRoot ? "" : target;
				setPathDraft("");
				(async () => {
					setBusy(true);
					setError("");
					setResult(null);
					setLogs([]);
					try {
						const value = await api("/workspace/switch", { path: rawTarget });
						setResult(value);
						setLogs(logsOf(value));
						await refresh();
					} catch (reason) {
						const message = messageOf(reason);
						if (/空响应|Failed to fetch|NetworkError|fetch failed/i.test(message)) {
							setError("请求已提交，但响应中断（DSH Web 可能在切换插件时重启）。正在等待对齐完成…");
							const status = await waitForSwitchSettled(rawTarget);
							if (status === "ok") {
								setError("");
								setResult({
									file: "",
									actions: [],
									installed: [],
									uninstalled: [],
									updated: [],
									logs: [{
										level: "info",
										message: "工作区对齐已完成（响应中断后通过轮询确认）。"
									}],
									dryRun: false
								});
							} else if (status !== "error") setError(`${message}（等待对齐状态超时）`);
						} else setError(message);
					} finally {
						setBusy(false);
					}
				})();
			};
			const waitForSwitchSettled = async (rawTarget, timeoutMs = 9e4) => {
				const startedAt = Date.now();
				while (Date.now() - startedAt < timeoutMs) {
					try {
						const next = await api("/state");
						setState(next);
						if (next.reconciling) {
							await delay(1200);
							continue;
						}
						if (typeof next.switchError === "string" && next.switchError !== "") {
							setError(`工作区对齐失败：${next.switchError}`);
							return "error";
						}
						if (next.config.workspaceRoot === rawTarget) return "ok";
					} catch {}
					await delay(1200);
				}
				return "timeout";
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
			const historyCount = (state?.workspaceHistory ?? []).length;
			const installedEntries = state?.entries ?? [];
			const clearOutput = () => {
				setLogs([]);
				setResult(null);
				setError("");
			};
			const resultOverlay = result !== null || logs.length > 0 || error !== "" || state?.restartNeeded === true || state?.webRefreshNeeded === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.resultOverlay,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.titleRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: styles.title,
							children: t("result")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: styles.button,
							onClick: clearOutput,
							children: t("close")
						})]
					}),
					state?.restartNeeded === true && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					}),
					state?.webRefreshNeeded === true && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.banner,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("webRefresh") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: styles.button,
							disabled: busy,
							onClick: () => void run(async () => {
								await api("/web-refresh/clear", {});
								return {
									logs: [{
										level: "info",
										message: "ok"
									}],
									dryRun: false
								};
							}),
							children: t("webRefreshClear")
						})]
					}),
					error !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						style: styles.error,
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.logPanel,
						children: [logs.map((line, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("pre", {
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
						}, index)), result !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
							style: styles.log,
							children: resultSummary(result)
						})]
					})
				]
			}) : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: page === "workspace" ? styles.workspaceRoot : styles.settingsRoot,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						style: styles.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.brand,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.logo,
								children: "PM"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
								style: styles.pageTitle,
								children: page === "workspace" ? t("pageWorkspace") : t("pageSettings")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.pageSubtitle,
								children: page === "workspace" ? t("workspaceSwitchHint") : t("pageSettingsHint")
							})] })]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
						})]
					}),
					page === "workspace" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: styles.pathCard,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.pathArea,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: styles.topLabel,
									children: t("requirementsRoot")
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
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: {
										...styles.button,
										...styles.ghost
									},
									disabled: busy || state === null || currentRoot === "",
									onClick: () => switchWorkspace(currentRoot, true),
									children: t("realignWorkspace")
								})
							]
						})
					}) : null,
					page === "workspace" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: styles.scroller,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
											children: installedEntries.length
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: styles.mono,
										title: currentRoot,
										children: currentRoot || t("workspaceDefault")
									})]
								}),
								installedEntries.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									style: styles.intro,
									children: t("empty")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: styles.pluginGrid,
									children: installedEntries.map((entry) => {
										const key = deleteKey({
											kind: "installed",
											profile: entry.profile,
											id: entry.id
										});
										const off = entry.disabled === true;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												...styles.pluginCard,
												...off ? styles.disabledCard : entry.adapter === "dsh-bundle" ? styles.hotCard : {}
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: styles.pluginTop,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: styles.pluginLogo,
														children: entry.id.slice(0, 2).toUpperCase()
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														style: styles.pluginName,
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
																style: styles.pluginTitle,
																children: entry.id
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
																style: styles.pluginSource,
																children: sourceSummary(entry.source, entry.ref)
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: entry.adapter === "dsh-bundle" ? styles.hotBadge : styles.badge,
																children: entry.adapter === "dsh-bundle" ? t("hotBadge") : t("customBadge")
															})
														]
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
														entry.adapter === "dsh-bundle" && entry.packageName !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: styles.mono,
															title: entry.packageName,
															children: entry.packageName
														})
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: styles.pluginBottom,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
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
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
														style: styles.switchTrack,
														title: off ? t("enable") : t("disable"),
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															type: "checkbox",
															style: styles.switchInput,
															checked: !off,
															disabled: busy,
															onChange: () => void run(() => api(off ? "/enable" : "/disable", {
																profile: entry.profile,
																id: entry.id
															}))
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: {
																...styles.switchSlider,
																...off ? {} : styles.switchSliderOn
															},
															children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
																...styles.switchKnob,
																...off ? {} : styles.switchKnobOn
															} })
														})]
													})]
												})
											]
										}, `${entry.profile}/${entry.id}`);
									})
								})
							]
						})
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
											disabled: busy || historyCount === 0,
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
						] })
					] }),
					resultOverlay
				]
			});
		}
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		//#endregion
		//#region src/client/SidebarPackageManagerButton.tsx
		/**
		* Main-menu package-manager entry beside Settings in the sidebar footer.
		* Clicking it opens a large flat panel with the same package-manager page.
		*/
		const buttonStyle = {
			width: "100%",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			gap: 8,
			padding: "10px 12px",
			border: "1px solid #D6D9E6",
			borderRadius: 14,
			background: "#ffffff",
			color: "hsl(227, 75%, 14%)",
			cursor: "pointer",
			fontSize: 14,
			fontWeight: 700,
			whiteSpace: "nowrap"
		};
		const activeButtonStyle = {
			...buttonStyle,
			border: "1px solid #C7D4FA",
			background: "#EDF2FF",
			color: "#4f6ef7"
		};
		const overlayStyle = {
			position: "fixed",
			inset: 0,
			zIndex: 1200,
			background: "rgba(15,20,35,0.28)",
			display: "flex",
			alignItems: "stretch",
			justifyContent: "stretch"
		};
		const panelStyle = {
			position: "absolute",
			top: "50%",
			left: "50%",
			width: "min(1120px, calc(100vw - 48px))",
			height: "min(760px, calc(100vh - 48px))",
			transform: "translate(-50%, -50%)",
			display: "flex",
			flexDirection: "column",
			overflow: "hidden",
			border: "1px solid #D6D9E6",
			borderRadius: 20,
			background: "linear-gradient(180deg, #F5F6F8 0%, #ECEEF1 100%)",
			color: "hsl(227, 75%, 14%)"
		};
		const panelContentStyle = {
			flex: 1,
			minHeight: 0,
			overflow: "hidden"
		};
		const closeStyle = {
			alignSelf: "flex-end",
			margin: 10,
			padding: "7px 12px",
			border: "1px solid #D6D9E6",
			borderRadius: 12,
			background: "#ffffff",
			color: "hsl(227, 75%, 14%)",
			cursor: "pointer",
			fontSize: 13,
			fontWeight: 700
		};
		function SidebarPackageManagerButton({ wide, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				style: open ? activeButtonStyle : buttonStyle,
				title: t("sidebarLabel"),
				onClick: () => setOpen((value) => !value),
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: { fontSize: wide ? 14 : 18 },
					children: "▣"
				}), wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("sidebarLabel") })]
			}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: overlayStyle,
				onClick: () => setOpen(false),
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					style: panelStyle,
					onClick: (event) => event.stopPropagation(),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						style: closeStyle,
						onClick: () => setOpen(false),
						children: t("close")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: panelContentStyle,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PackageManagerTab, { t })
					})]
				})
			})] });
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
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "package-manager",
				order: 0,
				label: () => t("sidebarLabel"),
				locale: NS,
				inject: injectT
			}, SidebarPackageManagerButton));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
