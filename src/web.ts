/**
 * @dsh-ext/dsh-package-manager/web — web-only route carrier. This loader row
 * injects `packageManager` and `webServer`, so it only mounts where a Web
 * server exists; headless profiles keep the core service without any HTTP
 * surface. The handler is a small JSON RPC over the package manager core.
 * @module @dsh-ext/dsh-package-manager/web
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { PackageManager } from './manager.ts'
import type {
  AdapterInitRequest, InstallRequest, RestoreRequest, SyncRequest, UninstallRequest,
} from './types.ts'
import type {} from './index.ts'

export const name = 'package-manager-web'

export const inject = ['packageManager', 'webServer']

const CSRF_HEADER = 'x-dsh-pm'
const MAX_BODY_BYTES = 1024 * 1024

export function apply(ctx: Context): void {
  const { manager, apiPrefix } = ctx.packageManager
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: apiPrefix, handler: handle(manager, apiPrefix) }),
    'package-manager-web: /pm-api route',
  )
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

/**
 * Strip the registered prefix from a pathname the webserver routed here.
 * Prefix routes receive the full pathname, so `/pm-api/state` becomes
 * `/state` and a bare `/pm-api` becomes `/`.
 * @param pathname - full request pathname.
 * @param prefix - the prefix this route registered under.
 * @returns the prefix-relative path.
 */
function subpath(pathname: string, prefix: string): string {
  if (pathname === prefix) return '/'
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length).replace(/\/+$/, '') || '/'
  return pathname
}

function handle(manager: PackageManager, apiPrefix: string): Handler {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = subpath(url.pathname, apiPrefix)
    try {
      if (req.method === 'GET' && path === '/state') return send(res, 200, { ok: true, value: manager.state() })
      if (req.method === 'POST' && path === '/restart/clear') {
        assertCsrf(req)
        manager.clearRestartMarker()
        return send(res, 200, { ok: true, value: null })
      }
      if (req.method === 'POST' && path === '/install') return dispatch(res, req, body => manager.install(body as unknown as InstallRequest))
      if (req.method === 'POST' && path === '/uninstall') return dispatch(res, req, body => manager.uninstall(body as unknown as UninstallRequest))
      if (req.method === 'POST' && path === '/restore') return dispatch(res, req, body => manager.restore(body as unknown as RestoreRequest))
      if (req.method === 'POST' && path === '/sync') return dispatch(res, req, body => manager.sync(body as unknown as SyncRequest))
      if (req.method === 'POST' && path === '/adapter-init') {
        return dispatch(res, req, body => Promise.resolve(manager.adapterInit(body as unknown as AdapterInitRequest)))
      }
      send(res, 404, { ok: false, error: { code: 'not_found', message: `no package-manager route for ${req.method ?? '?'} ${path}` } })
    } catch (error) {
      send(res, 400, { ok: false, error: { code: 'bad_request', message: messageOf(error) } })
    }
  }
}

async function dispatch(
  res: ServerResponse,
  req: IncomingMessage,
  run: (body: Record<string, unknown>) => Promise<unknown>,
): Promise<void> {
  assertCsrf(req)
  const body = await readBody(req)
  const result = await run(body as never)
  send(res, 200, { ok: true, value: result })
}

function assertCsrf(req: IncomingMessage): void {
  if (req.headers[CSRF_HEADER] !== '1') {
    throw new Error(`missing ${CSRF_HEADER}: 1 header — same-origin client calls only`)
  }
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        const parsed = text === '' ? {} : JSON.parse(text) as unknown
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('request body must be a JSON object')
        }
        resolve(parsed as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
