//#region src/web.ts
const name = "package-manager-web";
const inject = ["packageManager", "webServer"];
const CSRF_HEADER = "x-dsh-pm";
const MAX_BODY_BYTES = 1048576;
function apply(ctx) {
	const { manager, apiPrefix } = ctx.packageManager;
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: apiPrefix,
		handler: handle(ctx, ctx.packageManager, apiPrefix)
	}), "package-manager-web: /pm-api route");
}
/**
* Exit the backend process gracefully after a restart response: prefer the
* host's cmdline exit (runs the full dispose chain), fall back to a hard exit.
*/
function exitBackend(ctx) {
	const cmdline = ctx.get("cmdline");
	if (cmdline?.exit !== void 0) cmdline.exit(0);
	else setTimeout(() => process.exit(0), 200);
}
/**
* Strip the registered prefix from a pathname the webserver routed here.
* Prefix routes receive the full pathname, so `/pm-api/state` becomes
* `/state` and a bare `/pm-api` becomes `/`.
* @param pathname - full request pathname.
* @param prefix - the prefix this route registered under.
* @returns the prefix-relative path.
*/
function subpath(pathname, prefix) {
	if (pathname === prefix) return "/";
	if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length).replace(/\/+$/, "") || "/";
	return pathname;
}
function handle(ctx, service, apiPrefix) {
	return async (req, res) => {
		const path = subpath(new URL(req.url ?? "/", "http://localhost").pathname, apiPrefix);
		try {
			if (req.method === "GET" && path === "/health") return send(res, 200, {
				ok: true,
				value: {
					pid: process.pid,
					build: "bat-bare-fix-2"
				}
			});
			if (req.method === "GET" && path === "/state") return send(res, 200, {
				ok: true,
				value: service.state()
			});
			if (req.method === "GET" && path === "/workspace-history") return send(res, 200, {
				ok: true,
				value: {
					entries: service.workspaceHistory(),
					current: service.workspaceRoot(),
					default: service.workspaceDefault()
				}
			});
			if (req.method === "GET" && path === "/config") return send(res, 200, {
				ok: true,
				value: service.getConfig()
			});
			if (req.method === "POST" && path === "/config") return dispatch(res, req, (body) => Promise.resolve(service.setConfig(body)));
			if (req.method === "POST" && path === "/sync-configured") return dispatch(res, req, () => service.syncConfigured());
			if (req.method === "POST" && path === "/disable") return dispatch(res, req, (body) => service.disable(body));
			if (req.method === "POST" && path === "/enable") return dispatch(res, req, (body) => service.enable(body));
			if (req.method === "POST" && path === "/restart") {
				assertCsrf(req);
				const body = await readBody(req);
				const result = service.restart(typeof body.command === "string" ? body.command : void 0);
				setTimeout(() => exitBackend(ctx), 400);
				return send(res, 200, {
					ok: true,
					value: result
				});
			}
			if (req.method === "POST" && path === "/restart/clear") {
				assertCsrf(req);
				service.clearRestartMarker();
				return send(res, 200, {
					ok: true,
					value: null
				});
			}
			if (req.method === "POST" && path === "/web-refresh/clear") {
				assertCsrf(req);
				service.clearWebRefreshMarker();
				return send(res, 200, {
					ok: true,
					value: null
				});
			}
			if (req.method === "POST" && path === "/doctor") return dispatch(res, req, () => service.doctor());
			if (req.method === "POST" && path === "/install") return dispatch(res, req, (body) => service.install(body));
			if (req.method === "POST" && path === "/uninstall") return dispatch(res, req, (body) => service.uninstall(body));
			if (req.method === "POST" && path === "/disabled/remove") return dispatch(res, req, (body) => Promise.resolve(service.forgetDisabled(body)));
			if (req.method === "POST" && path === "/workspace-history") return dispatch(res, req, (body) => Promise.resolve(service.recordWorkspaceHistory(body.path)));
			if (req.method === "POST" && path === "/workspace-history/remove") return dispatch(res, req, (body) => Promise.resolve(service.forgetWorkspaceHistory(body.path)));
			if (req.method === "POST" && path === "/workspace-history/clear") return dispatch(res, req, () => Promise.resolve(service.clearWorkspaceHistory()));
			if (req.method === "POST" && path === "/workspace/switch") return dispatch(res, req, (body) => {
				const request = body;
				return service.switchWorkspace(request.path, request.dryRun === true);
			});
			if (req.method === "POST" && path === "/restore") return dispatch(res, req, (body) => service.restore(body));
			if (req.method === "POST" && path === "/sync") return dispatch(res, req, (body) => service.sync(body));
			if (req.method === "POST" && path === "/adapter-init") return dispatch(res, req, (body) => service.adapterInit(body));
			if (req.method === "POST" && path === "/ai-install") return dispatch(res, req, (body) => service.dispatchAiInstall(body));
			send(res, 404, {
				ok: false,
				error: {
					code: "not_found",
					message: `no package-manager route for ${req.method ?? "?"} ${path}`
				}
			});
		} catch (error) {
			send(res, 400, {
				ok: false,
				error: {
					code: "bad_request",
					message: messageOf(error)
				}
			});
		}
	};
}
async function dispatch(res, req, run) {
	assertCsrf(req);
	send(res, 200, {
		ok: true,
		value: await run(await readBody(req))
	});
}
function assertCsrf(req) {
	if (req.headers[CSRF_HEADER] !== "1") throw new Error(`missing ${CSRF_HEADER}: 1 header — same-origin client calls only`);
}
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(/* @__PURE__ */ new Error("request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				const text = Buffer.concat(chunks).toString("utf8");
				const parsed = text === "" ? {} : JSON.parse(text);
				if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("request body must be a JSON object");
				resolve(parsed);
			} catch (error) {
				reject(error);
			}
		});
		req.on("error", reject);
	});
}
function send(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": String(Buffer.byteLength(body)),
		"cache-control": "no-store"
	});
	res.end(body);
}
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
//#endregion
export { apply, inject, name };
