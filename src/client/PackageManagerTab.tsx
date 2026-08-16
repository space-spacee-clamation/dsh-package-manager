/**
 * Package manager settings tab. The default view is deliberately tiny:
 * configure one plugin-workspace root, paste one plugin link, and dispatch it
 * to an AI session. Restore/sync/direct-install/adapter forms stay available
 * under developer mode for advanced users.
 */

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactElement } from 'react'
import type {
  AdapterInitResult, AiInstallResult, InstallResult, ManagerState, OperationLog, PackageManagerConfig, RestoreResult, UninstallResult,
} from '../types.ts'
import type { LocaleKey } from './locales.ts'

export interface PackageManagerTabProps {
  t: (key: LocaleKey) => string
}

type AnyResult = InstallResult | UninstallResult | RestoreResult | AdapterInitResult | PackageManagerConfig | AiInstallResult

const CSRF_HEADER = 'x-dsh-pm'
const DEVELOPER_MODE_KEY = 'dsh-package-manager.developerMode'

async function api<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' }, body: JSON.stringify(body) }
  const response = await fetch(`/pm-api${path}`, init)
  const payload = await response.json() as { ok: boolean; value?: T; error?: { code: string; message: string } }
  if (!payload.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`)
  return payload.value as T
}

function logsOf(value: AnyResult): OperationLog[] {
  return 'logs' in value ? value.logs : []
}

function resultSummary(value: AnyResult): string {
  if ('sessionId' in value) return `session: ${value.sessionId}\nworkspace: ${value.workspacePath}`
  return JSON.stringify(value, null, 2)
}

const styles: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 },
  intro: { opacity: 0.75, lineHeight: 1.6, margin: 0, fontSize: 13 },
  card: { border: '1px solid var(--dsw-border, rgba(127,127,127,0.25))', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 },
  title: { margin: 0, fontSize: 15, fontWeight: 600 },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 240px', minWidth: 200 },
  label: { fontSize: 12, opacity: 0.75 },
  input: { padding: '7px 9px', border: '1px solid var(--dsw-border, rgba(127,127,127,0.25))', borderRadius: 6, background: 'transparent', color: 'inherit', minWidth: 0 },
  select: { padding: '7px 9px', border: '1px solid var(--dsw-border, rgba(127,127,127,0.25))', borderRadius: 6, background: 'transparent', color: 'inherit' },
  button: { padding: '7px 14px', border: '1px solid var(--dsw-border, rgba(127,127,127,0.25))', borderRadius: 6, background: 'transparent', color: 'inherit', cursor: 'pointer' },
  primary: { borderColor: 'rgba(80,130,255,0.65)', color: '#7aa2ff' },
  danger: { borderColor: 'rgba(220,80,80,0.55)', color: '#e05a5a' },
  banner: { border: '1px solid rgba(255,190,80,0.55)', borderRadius: 10, padding: 10, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  log: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  item: { border: '1px solid var(--dsw-border, rgba(127,127,127,0.25))', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 },
  meta: { fontSize: 12, opacity: 0.8, display: 'flex', gap: 12, flexWrap: 'wrap' },
  error: { color: '#e05a5a', fontSize: 12, whiteSpace: 'pre-wrap' },
  switch: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer' },
}

export function PackageManagerTab({ t }: PackageManagerTabProps): ReactElement {
  const [state, setState] = useState<ManagerState | null>(null)
  const [logs, setLogs] = useState<OperationLog[]>([])
  const [result, setResult] = useState<AnyResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [developerMode, setDeveloperMode] = useState(() => {
    try {
      return localStorage.getItem(DEVELOPER_MODE_KEY) === '1'
    } catch {
      return false
    }
  })

  // Default view: one link + one AI dispatch.
  const [source, setSource] = useState('')
  const [workspaceRoot, setWorkspaceRoot] = useState('')

  // Advanced drafts, rendered only in developer mode.
  const [profile, setProfile] = useState('web')
  const [id, setId] = useState('')
  const [adapter, setAdapter] = useState<'auto' | 'dsh-bundle' | 'custom'>('auto')
  const [adapterDir, setAdapterDir] = useState('')
  const [ref, setRef] = useState('')
  const [allowBuild, setAllowBuild] = useState(false)
  const [requirementsFile, setRequirementsFile] = useState('')
  const [modes, setModes] = useState('')
  const [repo, setRepo] = useState('')
  const [outDir, setOutDir] = useState('')
  const [storagePath, setStoragePath] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [autoSync, setAutoSync] = useState(false)

  const refresh = async (): Promise<void> => {
    try {
      const next = await api<ManagerState>('/state')
      setState(next)
      setError('')
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  useEffect(() => { void refresh() }, [])

  useEffect(() => {
    if (state === null) return
    setWorkspaceRoot(state.workspaceRoot)
    setStoragePath(state.config.storagePath)
    setRemoteUrl(state.config.remoteUrl)
    setAutoSync(state.config.autoSync)
  }, [state])

  const setDeveloperModePersistent = (value: boolean): void => {
    setDeveloperMode(value)
    try {
      localStorage.setItem(DEVELOPER_MODE_KEY, value ? '1' : '0')
    } catch {
      // Settings pages should not crash when storage is unavailable.
    }
  }

  const run = async (action: () => Promise<AnyResult>): Promise<void> => {
    setBusy(true)
    setError('')
    setResult(null)
    setLogs([])
    try {
      const value = await action()
      setResult(value)
      setLogs(logsOf(value))
      await refresh()
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
  }

  const modesList = (): string[] => modes.split(',').map(mode => mode.trim()).filter(mode => mode !== '')
  const configPayload = (): PackageManagerConfig => ({ storagePath, remoteUrl, autoSync, workspaceRoot })
  const targetProfile = state?.profiles.map(item => item.name).includes('web') ? 'web' : state?.profiles[0]?.name ?? 'web'

  return (
    <div style={styles.root}>
      <p style={styles.intro}>{t('intro')}</p>

      {state?.restartNeeded === true && (
        <div style={styles.banner}>
          <span>{t('restart')}</span>
          <button
            type="button"
            style={styles.button}
            disabled={busy}
            onClick={() => void run(async () => {
              await api<null>('/restart/clear', {})
              await refresh()
              return { logs: [{ level: 'info', message: 'ok' }], dryRun: false } as AnyResult
            })}
          >
            {t('restartClear')}
          </button>
        </div>
      )}

      {error !== '' && <pre style={styles.error}>{error}</pre>}

      <div style={styles.card}>
        <h3 style={styles.title}>{t('workspaceTitle')}</h3>
        <p style={styles.intro}>{t('workspaceHint')}</p>
        <label style={styles.field}>
          <span style={styles.label}>{t('workspaceRoot')}</span>
          <input style={styles.input} value={workspaceRoot} onChange={event => setWorkspaceRoot(event.target.value)} placeholder={state?.workspaceRoot ?? ''} />
        </label>
        <div style={styles.row}>
          <button
            type="button"
            style={styles.button}
            disabled={busy || state === null}
            onClick={() => void run(() => api<PackageManagerConfig>('/config', configPayload()))}
          >
            {busy ? t('running') : t('saveConfig')}
          </button>
          <span style={styles.intro}>{t('workspaceDefault')} {state?.workspaceRoot ?? ''}</span>
        </div>
      </div>

      <form style={styles.card} onSubmit={submit}>
        <h3 style={styles.title}>{t('aiInstallTitle')}</h3>
        <p style={styles.intro}>{t('aiInstallHint')} · {t('profile')}: {targetProfile}</p>
        <div style={styles.row}>
          <label style={styles.field}>
            <span style={styles.label}>{t('source')}</span>
            <input
              style={styles.input}
              value={source}
              onChange={event => setSource(event.target.value)}
              placeholder="github:owner/plugin 或 https://…/plugin.git"
            />
          </label>
          <button
            type="submit"
            style={{ ...styles.button, ...styles.primary }}
            disabled={busy || source.trim() === ''}
            onClick={() => void run(() => api<AiInstallResult>('/ai-install', { source: source.trim() }))}
          >
            {busy ? t('running') : t('dispatchToAi')}
          </button>
        </div>
        <p style={styles.intro}>{t('aiInstallNote')}</p>
      </form>

      <div style={styles.card}>
        <h3 style={styles.title}>{t('installedTitle')}</h3>
        {(state?.entries ?? []).length === 0 && <p style={styles.intro}>{t('empty')}</p>}
        <div style={styles.list}>
          {(state?.entries ?? []).map(entry => (
            <div key={`${entry.profile}/${entry.id}`} style={styles.item}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <strong>{entry.id}</strong>
                <div style={styles.row}>
                  <label style={styles.switch}>
                    <input
                      type="checkbox"
                      checked
                      disabled={busy}
                      onChange={() => void run(() => api<UninstallResult>('/disable', { profile: entry.profile, id: entry.id }))}
                    />
                    {t('disable')}
                  </label>
                  <button
                    type="button"
                    style={{ ...styles.button, ...styles.danger }}
                    disabled={busy}
                    onClick={() => void run(() => api<UninstallResult>('/uninstall', { profile: entry.profile, id: entry.id }))}
                  >
                    {t('uninstall')}
                  </button>
                </div>
              </div>
              <div style={styles.meta}>
                <span>{entry.profile}</span>
                <span>{entry.adapter}</span>
                <span>{entry.source}</span>
                {entry.pluginEnvDir !== undefined && <span>{t('env')}: {entry.pluginEnvDir}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.card}>
        <h3 style={styles.title}>{t('disabledTitle')}</h3>
        {(state?.disabled ?? []).length === 0 && <p style={styles.intro}>{t('disabledEmpty')}</p>}
        <div style={styles.list}>
          {(state?.disabled ?? []).map(item => (
            <div key={`${item.profile}/${item.id}`} style={styles.item}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <strong>{item.id}</strong>
                <label style={styles.switch}>
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={busy}
                    onChange={() => void run(() => api<InstallResult>('/enable', { profile: item.profile, id: item.id }))}
                  />
                  {t('enable')}
                </label>
              </div>
              <div style={styles.meta}>
                <span>{item.profile}</span>
                <span>{item.source}</span>
                <span>{item.adapter}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <label style={styles.switch}>
        <input type="checkbox" checked={developerMode} onChange={event => setDeveloperModePersistent(event.target.checked)} />
        {t('developerMode')}
      </label>

      {developerMode && (
        <>
          <p style={styles.intro}>{t('developerHint')}</p>

          <div style={styles.card}>
            <h3 style={styles.title}>{t('storageTitle')}</h3>
            <div style={styles.row}>
              <label style={styles.field}>
                <span style={styles.label}>{t('storagePath')}</span>
                <input style={styles.input} value={storagePath} onChange={event => setStoragePath(event.target.value)} />
              </label>
              <label style={styles.field}>
                <span style={styles.label}>{t('remoteUrl')}</span>
                <input style={styles.input} value={remoteUrl} onChange={event => setRemoteUrl(event.target.value)} />
              </label>
            </div>
            <label style={styles.switch}>
              <input type="checkbox" checked={autoSync} onChange={event => setAutoSync(event.target.checked)} />
              {t('autoSync')}
            </label>
            <div style={styles.row}>
              <button
                type="button"
                style={styles.button}
                disabled={busy}
                onClick={() => void run(() => api<PackageManagerConfig>('/config', configPayload()))}
              >
                {t('saveConfig')}
              </button>
              <button
                type="button"
                style={styles.button}
                disabled={busy || storagePath === '' && remoteUrl === ''}
                onClick={() => void run(async () => {
                  await api<PackageManagerConfig>('/config', configPayload())
                  return api<RestoreResult>('/sync-configured', {})
                })}
              >
                {t('syncConfigured')}
              </button>
            </div>
          </div>

          <form style={styles.card} onSubmit={submit}>
            <h3 style={styles.title}>{t('installTitle')}</h3>
            <div style={styles.row}>
              <label style={styles.field}>
                <span style={styles.label}>{t('profile')}</span>
                <input style={styles.input} value={profile} onChange={event => setProfile(event.target.value)} />
              </label>
              <label style={styles.field}>
                <span style={styles.label}>{t('source')}</span>
                <input style={styles.input} value={source} onChange={event => setSource(event.target.value)} />
              </label>
            </div>
            <div style={styles.row}>
              <label style={styles.field}>
                <span style={styles.label}>{t('id')}</span>
                <input style={styles.input} value={id} onChange={event => setId(event.target.value)} />
              </label>
              <label style={styles.field}>
                <span style={styles.label}>{t('adapter')}</span>
                <select style={styles.select} value={adapter} onChange={event => setAdapter(event.target.value as typeof adapter)}>
                  <option value="auto">{t('adapterAuto')}</option>
                  <option value="dsh-bundle">{t('adapterBundle')}</option>
                  <option value="custom">{t('adapterCustom')}</option>
                </select>
              </label>
            </div>
            {adapter === 'custom' && (
              <label style={styles.field}>
                <span style={styles.label}>{t('adapterDir')}</span>
                <input style={styles.input} value={adapterDir} onChange={event => setAdapterDir(event.target.value)} />
              </label>
            )}
            <div style={styles.row}>
              <label style={styles.field}>
                <span style={styles.label}>{t('ref')}</span>
                <input style={styles.input} value={ref} onChange={event => setRef(event.target.value)} placeholder="main" />
              </label>
              <label style={styles.switch}>
                <input type="checkbox" checked={allowBuild} onChange={event => setAllowBuild(event.target.checked)} />
                {t('allowBuild')}
              </label>
            </div>
            <div style={styles.row}>
              <button
                type="submit"
                style={styles.button}
                disabled={busy || source === ''}
                onClick={() => void run(() => api<InstallResult>('/install', {
                  profile, source, id: id === '' ? undefined : id, adapter,
                  adapterDir: adapterDir === '' ? undefined : adapterDir,
                  ref: ref === '' ? undefined : ref,
                  allowBuild,
                }))}
              >
                {busy ? t('running') : t('install')}
              </button>
              <button
                type="button"
                style={styles.button}
                disabled={busy || source === ''}
                onClick={() => void run(() => api<InstallResult>('/install', {
                  profile, source, id: id === '' ? undefined : id, adapter,
                  adapterDir: adapterDir === '' ? undefined : adapterDir,
                  ref: ref === '' ? undefined : ref,
                  allowBuild, dryRun: true,
                }))}
              >
                {t('dryRun')}
              </button>
            </div>
          </form>

          <form style={styles.card} onSubmit={submit}>
            <h3 style={styles.title}>{t('restoreTitle')}</h3>
            <div style={styles.row}>
              <label style={styles.field}>
                <span style={styles.label}>{t('requirementsFile')}</span>
                <input style={styles.input} value={requirementsFile} onChange={event => setRequirementsFile(event.target.value)} />
              </label>
              <label style={styles.field}>
                <span style={styles.label}>{t('modes')}</span>
                <input style={styles.input} value={modes} onChange={event => setModes(event.target.value)} placeholder="web,headless" />
              </label>
            </div>
            <div style={styles.row}>
              <button
                type="submit"
                style={styles.button}
                disabled={busy || requirementsFile === ''}
                onClick={() => void run(() => api<RestoreResult>('/restore', { file: requirementsFile, modes: modesList() }))}
              >
                {t('restore')}
              </button>
              <button
                type="button"
                style={styles.button}
                disabled={busy || requirementsFile === ''}
                onClick={() => void run(() => api<RestoreResult>('/restore', { file: requirementsFile, modes: modesList(), dryRun: true }))}
              >
                {t('dryRun')}
              </button>
            </div>
          </form>

          <form style={styles.card} onSubmit={submit}>
            <h3 style={styles.title}>{t('syncTitle')}</h3>
            <div style={styles.row}>
              <label style={styles.field}>
                <span style={styles.label}>{t('repo')}</span>
                <input style={styles.input} value={repo} onChange={event => setRepo(event.target.value)} />
              </label>
              <button
                type="submit"
                style={styles.button}
                disabled={busy || repo === ''}
                onClick={() => void run(() => api<RestoreResult>('/sync', { repo, modes: modesList() }))}
              >
                {t('sync')}
              </button>
            </div>
          </form>

          <form style={styles.card} onSubmit={submit}>
            <h3 style={styles.title}>{t('adapterInitTitle')}</h3>
            <div style={styles.row}>
              <label style={styles.field}>
                <span style={styles.label}>{t('source')}</span>
                <input style={styles.input} value={source} onChange={event => setSource(event.target.value)} />
              </label>
              <label style={styles.field}>
                <span style={styles.label}>{t('id')}</span>
                <input style={styles.input} value={id} onChange={event => setId(event.target.value)} />
              </label>
              <label style={styles.field}>
                <span style={styles.label}>{t('outDir')}</span>
                <input style={styles.input} value={outDir} onChange={event => setOutDir(event.target.value)} />
              </label>
            </div>
            <button
              type="submit"
              style={styles.button}
              disabled={busy || source === '' || id === '' || outDir === ''}
              onClick={() => void run(() => api<AdapterInitResult>('/adapter-init', { source, id, outDir, profile, ref: ref === '' ? undefined : ref }))}
            >
              {t('adapterInit')}
            </button>
          </form>

          <div style={styles.card}>
            <h3 style={styles.title}>{t('profilesTitle')}</h3>
            {(state?.profiles ?? []).map(item => (
              <div key={item.name} style={styles.item}>
                <strong>{item.name}</strong>
                <div style={styles.meta}>
                  <span>{t('bundle')}: {item.bundles.join(', ')}</span>
                  <span>{t('dependencies')}: {item.dependencies.length > 0 ? item.dependencies.join(', ') : '—'}</span>
                </div>
              </div>
            ))}
            <h3 style={styles.title}>{t('rawState')}</h3>
            <pre style={styles.log}>{JSON.stringify(state, null, 2)}</pre>
          </div>
        </>
      )}

      {(result !== null || logs.length > 0) && (
        <div style={styles.card}>
          <h3 style={styles.title}>{t('result')}</h3>
          {logs.map((line, index) => (
            <pre key={index} style={{ ...styles.log, color: line.level === 'error' ? '#e05a5a' : undefined }}>
              [{line.level}] {line.message}
            </pre>
          ))}
          {result !== null && <pre style={styles.log}>{resultSummary(result)}</pre>}
        </div>
      )}
    </div>
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
