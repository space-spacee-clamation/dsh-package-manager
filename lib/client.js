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
			intro: "从 git / 本地目录安装插件、从 requirements 文件复原整套插件与模式，安装卸载由内置或自定义 adapter 包装。",
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
			allowBuild: "允许 git 插件构建脚本（加入 profile allowBuilds，卸载时撤销）",
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
			storageTitle: "requirements 仓库与包存储",
			storageHint: "设置本地 requirements 仓库路径和远程 URL；自动同步开启后，插件服务启动时会 clone / pull 并执行 restore。",
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
			developerHint: "显示原始状态、安装 ref、API 路径等高级信息。",
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
			refresh: "刷新"
		};
		const en = {
			tab: "Packages",
			intro: "Install plugins from git / local directories, restore whole plugin sets and profile modes from a requirements file; install and uninstall go through built-in or custom adapters.",
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
			allowBuild: "Allow git plugin build scripts (added to profile allowBuilds; undone on uninstall)",
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
			storageTitle: "Requirements repo & package storage",
			storageHint: "Set the local requirements repo path and remote URL. When auto-sync is on, the plugin service clones / pulls and restores on startup.",
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
			developerHint: "Show raw state, install ref, API paths and other advanced information.",
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
			refresh: "Refresh"
		};
		//#endregion
		//#region src/client/PackageManagerTab.tsx
		/**
		* Package manager settings tab. Pure presentation over the /pm-api JSON
		* route: no business state beyond form drafts, no subscription machinery.
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
		const styles = {
			root: {
				display: "flex",
				flexDirection: "column",
				gap: 16,
				maxWidth: 760
			},
			intro: {
				opacity: .75,
				lineHeight: 1.6,
				margin: 0
			},
			card: {
				border: "1px solid var(--dsw-border, rgba(127,127,127,0.25))",
				borderRadius: 10,
				padding: 14,
				display: "flex",
				flexDirection: "column",
				gap: 10
			},
			title: {
				margin: 0,
				fontSize: 15,
				fontWeight: 600
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
				gap: 4,
				flex: "1 1 200px",
				minWidth: 180
			},
			label: {
				fontSize: 12,
				opacity: .75
			},
			input: {
				padding: "6px 8px",
				border: "1px solid var(--dsw-border, rgba(127,127,127,0.25))",
				borderRadius: 6,
				background: "transparent",
				color: "inherit",
				minWidth: 0
			},
			select: {
				padding: "6px 8px",
				border: "1px solid var(--dsw-border, rgba(127,127,127,0.25))",
				borderRadius: 6,
				background: "transparent",
				color: "inherit"
			},
			button: {
				padding: "6px 12px",
				border: "1px solid var(--dsw-border, rgba(127,127,127,0.25))",
				borderRadius: 6,
				background: "transparent",
				color: "inherit",
				cursor: "pointer"
			},
			danger: {
				borderColor: "rgba(220,80,80,0.55)",
				color: "#e05a5a"
			},
			banner: {
				border: "1px solid rgba(255,190,80,0.55)",
				borderRadius: 10,
				padding: 10,
				display: "flex",
				gap: 10,
				alignItems: "center",
				justifyContent: "space-between",
				flexWrap: "wrap"
			},
			log: {
				fontFamily: "ui-monospace, Consolas, monospace",
				fontSize: 12,
				whiteSpace: "pre-wrap",
				margin: 0
			},
			list: {
				display: "flex",
				flexDirection: "column",
				gap: 8
			},
			item: {
				border: "1px solid var(--dsw-border, rgba(127,127,127,0.25))",
				borderRadius: 8,
				padding: 10,
				display: "flex",
				flexDirection: "column",
				gap: 6
			},
			meta: {
				fontSize: 12,
				opacity: .8,
				display: "flex",
				gap: 12,
				flexWrap: "wrap"
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
				cursor: "pointer"
			}
		};
		function PackageManagerTab({ t }) {
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
			const [profile, setProfile] = (0, react.useState)("web");
			const [source, setSource] = (0, react.useState)("");
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
				setStoragePath(state.config.storagePath);
				setRemoteUrl(state.config.remoteUrl);
				setAutoSync(state.config.autoSync);
			}, [state]);
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
			const configPayload = () => ({
				storagePath,
				remoteUrl,
				autoSync
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: styles.root,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.intro,
						children: t("intro")
					}),
					state?.restartNeeded === true && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.banner,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("restart") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: styles.button,
							onClick: () => void run(async () => {
								await api("/restart/clear", {});
								await refresh();
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
					error !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						style: styles.error,
						children: error
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: styles.title,
								children: t("storageTitle")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.intro,
								children: t("storageHint")
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
										onChange: (event) => setStoragePath(event.target.value),
										placeholder: "D:\\dsh-profiles\\default"
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: styles.field,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: styles.label,
										children: t("remoteUrl")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										style: styles.input,
										value: remoteUrl,
										onChange: (event) => setRemoteUrl(event.target.value),
										placeholder: "ssh://git@gitlab.example.com:32200/group/profile.git"
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
									children: busy ? t("running") : t("saveConfig")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: styles.button,
									disabled: busy || storagePath === "" && remoteUrl === "",
									onClick: () => void run(async () => {
										await api("/config", configPayload());
										return api("/sync-configured", {});
									}),
									children: busy ? t("running") : t("syncConfigured")
								})]
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
					developerMode && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: styles.intro,
						children: t("developerHint")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: styles.title,
								children: t("installedTitle")
							}),
							(state?.entries ?? []).length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.intro,
								children: t("empty")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: styles.list,
								children: (state?.entries ?? []).map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.item,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											justifyContent: "space-between",
											gap: 8,
											alignItems: "center"
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: entry.id }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: styles.row,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
												style: styles.switch,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "checkbox",
													checked: true,
													disabled: busy,
													onChange: () => void run(() => api("/disable", {
														profile: entry.profile,
														id: entry.id
													}))
												}), t("disable")]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: {
													...styles.button,
													...styles.danger
												},
												disabled: busy,
												onClick: () => void run(() => api("/uninstall", {
													profile: entry.profile,
													id: entry.id
												})),
												children: t("uninstall")
											})]
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.meta,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: entry.profile }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: entry.source }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: entry.adapter }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [entry.steps.length, " steps"] }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: entry.updatedAt })
										]
									})]
								}, `${entry.profile}/${entry.id}`))
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: styles.title,
								children: t("disabledTitle")
							}),
							(state?.disabled ?? []).length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: styles.intro,
								children: t("disabledEmpty")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: styles.list,
								children: (state?.disabled ?? []).map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.item,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											justifyContent: "space-between",
											gap: 8,
											alignItems: "center"
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.id }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
											style: styles.switch,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "checkbox",
												checked: false,
												disabled: busy,
												onChange: () => void run(() => api("/enable", {
													profile: item.profile,
													id: item.id
												}))
											}), t("enable")]
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.meta,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.profile }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.source }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.adapter }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: item.ref === "" ? "default ref" : item.ref })
										]
									})]
								}, `${item.profile}/${item.id}`))
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.card,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							style: styles.title,
							children: t("profilesTitle")
						}), (state?.profiles ?? []).map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.item,
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
						}, item.name))]
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
										onChange: (event) => setSource(event.target.value),
										placeholder: "github:Nagi-ovo/dsh-visualize"
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
							developerMode && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
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
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
								style: {
									display: "flex",
									gap: 8,
									alignItems: "center",
									fontSize: 13
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: allowBuild,
									onChange: (event) => setAllowBuild(event.target.checked)
								}), t("allowBuild")]
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
										onChange: (event) => setRequirementsFile(event.target.value),
										placeholder: "D:\\plugins\\requirements\\deps.yaml"
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
									children: busy ? t("running") : t("restore")
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
								children: busy ? t("running") : t("sync")
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
								children: busy ? t("running") : t("adapterInit")
							})
						]
					}),
					developerMode && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.card,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: styles.title,
								children: t("rawState")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
								style: styles.log,
								children: JSON.stringify(state, null, 2)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								style: styles.title,
								children: "API"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
								style: styles.log,
								children: `GET  /pm-api/state
POST /pm-api/install | uninstall | restore | sync
POST /pm-api/config | sync-configured | disable | enable
POST /pm-api/adapter-init | restart/clear
Header for POST: x-dsh-pm: 1`
							})
						]
					}),
					(result !== null || logs.length > 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
								children: JSON.stringify(result, null, 2)
							})
						]
					})
				]
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
			ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
				name: "settings.plugins.tab",
				id: "package-manager",
				order: 5,
				label: () => t("tab"),
				locale: NS,
				inject: () => ({ t: ctx.locale.bind(NS) })
			}, PackageManagerTab));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
