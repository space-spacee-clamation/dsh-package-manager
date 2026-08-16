/**
 * Package manager settings tab.
 *
 * Page 1 is the plugin workspace: a path/history toolbar on top, scrollable
 * plugin cards in the middle, and a persistent AI-install input pinned at the
 * bottom. Page 2 keeps the original form-based settings for workspace
 * configuration and developer-mode operations.
 */

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactElement } from 'react'
import type {
  AdapterInitResult, AiInstallResult, DisabledEntry, InstallResult, ManagerState, OperationLog, PackageManagerConfig,
  RestoreResult, UninstallResult,
} from '../types.ts'
import type { LocaleKey } from './locales.ts'

export interface PackageManagerTabProps {
  t: (key: LocaleKey) => string
}

type AnyResult = InstallResult | UninstallResult | RestoreResult | AdapterInitResult | PackageManagerConfig | AiInstallResult | DisabledEntry
type Page = 'workspace' | 'settings'
type DeleteTarget = { kind: 'installed' | 'disabled'; profile: string; id: string }

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

function deleteKey(target: DeleteTarget): string {
  return `${target.kind}\u0000${target.profile}\u0000${target.id}`
}

function sourceSummary(source: string, ref: string): string {
  return ref.trim() === '' ? source : `${source} @ ${ref.trim()}`
}

const styles: Record<string, CSSProperties> = {
  workspaceRoot: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    maxWidth: 1080,
    width: '100%',
    margin: '0 auto',
    gap: 12,
  },
  settingsRoot: { display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 860, width: '100%', margin: '0 auto', paddingBottom: 32 },
  intro: { opacity: 0.72, lineHeight: 1.7, margin: 0, fontSize: 13 },
  topbar: {
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    padding: '10px 12px',
    border: '1px solid var(--dsw-border, rgba(127,127,127,0.22))',
    borderRadius: 14,
    background: 'var(--dsw-surface, rgba(255,255,255,0.018))',
  },
  tabs: { display: 'flex', gap: 4, padding: 2, border: '1px solid var(--dsw-border, rgba(127,127,127,0.22))', borderRadius: 10 },
  tab: { padding: '6px 12px', border: 'none', borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' },
  tabActive: { background: 'rgba(88,136,255,0.14)', color: '#a8c0ff' },
  pathArea: { display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 520px', minWidth: 300, flexWrap: 'wrap' },
  topLabel: { fontSize: 12, opacity: 0.66, whiteSpace: 'nowrap' },
  select: {
    flex: '1 1 260px',
    minWidth: 200,
    padding: '8px 10px',
    border: '1px solid var(--dsw-border, rgba(127,127,127,0.28))',
    borderRadius: 8,
    background: 'transparent',
    color: 'inherit',
    textOverflow: 'ellipsis',
  },
  input: { padding: '8px 10px', border: '1px solid var(--dsw-border, rgba(127,127,127,0.28))', borderRadius: 8, background: 'transparent', color: 'inherit', minWidth: 0 },
  button: { padding: '7px 14px', border: '1px solid var(--dsw-border, rgba(127,127,127,0.30))', borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' },
  primary: {
    borderColor: 'rgba(88,136,255,0.65)',
    color: '#a8c0ff',
    background: 'rgba(88,136,255,0.12)',
  },
  ghost: { opacity: 0.78 },
  danger: { borderColor: 'rgba(220,80,80,0.55)', color: '#e05a5a', background: 'rgba(220,80,80,0.06)' },
  dangerArmed: { borderColor: '#e05a5a', color: '#fff', background: 'rgba(220,80,80,0.32)' },
  scroller: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    padding: '2px 2px 18px',
    scrollbarGutter: 'stable',
  },
  footer: {
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    padding: '12px 14px',
    border: '1px solid rgba(88,136,255,0.42)',
    borderRadius: 14,
    background: 'linear-gradient(135deg, rgba(88,136,255,0.10), rgba(88,136,255,0.02))',
  },
  footerInputWrap: { flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 5, minWidth: 220 },
  card: {
    border: '1px solid var(--dsw-border, rgba(127,127,127,0.22))',
    borderRadius: 14,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    background: 'var(--dsw-surface, rgba(255,255,255,0.018))',
  },
  title: { margin: 0, fontSize: 15, fontWeight: 650 },
  titleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 240px', minWidth: 200 },
  label: { fontSize: 12, opacity: 0.72 },
  banner: { border: '1px solid rgba(255,190,80,0.55)', borderRadius: 12, padding: 12, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', background: 'rgba(255,190,80,0.06)' },
  log: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 },
  mono: {
    fontFamily: 'ui-monospace, Consolas, monospace',
    fontSize: 12,
    padding: '3px 8px',
    border: '1px solid var(--dsw-border, rgba(127,127,127,0.22))',
    borderRadius: 999,
    opacity: 0.86,
    overflowWrap: 'anywhere',
  },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  pluginCard: {
    border: '1px solid var(--dsw-border, rgba(127,127,127,0.22))',
    borderRadius: 14,
    padding: 14,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
    background: 'var(--dsw-surface, rgba(255,255,255,0.018))',
  },
  pluginName: { flex: '1 1 180px', minWidth: 150, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' },
  pluginDesc: { flex: '1 1 320px', minWidth: 220, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' },
  pluginSource: { margin: 0, fontSize: 13, lineHeight: 1.55, overflowWrap: 'anywhere' },
  pluginActions: { flex: '0 0 auto', display: 'flex', gap: 10, alignItems: 'center' },
  meta: { fontSize: 12, opacity: 0.78, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  badge: { fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--dsw-border, rgba(127,127,127,0.30))', opacity: 0.82 },
  hotBadge: { fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid rgba(88,136,255,0.50)', color: '#a8c0ff', background: 'rgba(88,136,255,0.08)' },
  aiBadge: { fontSize: 11, padding: '3px 9px', borderRadius: 999, border: '1px solid rgba(88,136,255,0.55)', color: '#a8c0ff', background: 'rgba(88,136,255,0.10)', whiteSpace: 'nowrap' },
  error: { color: '#e05a5a', fontSize: 12, whiteSpace: 'pre-wrap' },
  switch: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
  sectionTitle: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
}

export function PackageManagerTab({ t }: PackageManagerTabProps): ReactElement {
  const [page, setPage] = useState<Page>('workspace')
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
  const [pathDraft, setPathDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // Workspace-page AI install input.
  const [source, setSource] = useState('')

  // Page-2 drafts.
  const [workspaceRoot, setWorkspaceRoot] = useState('')
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
    setWorkspaceRoot(state.config.workspaceRoot)
    setStoragePath(state.config.storagePath)
    setRemoteUrl(state.config.remoteUrl)
    setAutoSync(state.config.autoSync)
  }, [state])

  useEffect(() => {
    if (confirmDelete === null) return
    const timer = setTimeout(() => setConfirmDelete(null), 5000)
    return () => clearTimeout(timer)
  }, [confirmDelete])

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
  const configPayload = (workspaceRootValue: string = workspaceRoot): PackageManagerConfig => ({
    storagePath,
    remoteUrl,
    autoSync,
    workspaceRoot: workspaceRootValue,
  })
  const targetProfile = state?.profiles.map(item => item.name).includes('web') ? 'web' : state?.profiles[0]?.name ?? 'web'

  const runQuiet = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError('')
    setResult(null)
    setLogs([])
    try {
      await action()
      await refresh()
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  const switchWorkspace = (path: string): void => {
    const target = path.trim()
    const current = state?.workspaceRoot ?? ''
    const defaultRoot = state?.workspaceDefault ?? ''
    if (state === null || busy || target === current) return
    const useDefault = target === '' || target === defaultRoot
    setPathDraft('')
    void runQuiet(() => api<PackageManagerConfig>('/config', configPayload(useDefault ? '' : target)))
  }

  const clearHistory = (): void => {
    void runQuiet(() => api<string[]>('/workspace-history/clear', {}))
  }

  const requestDelete = (target: DeleteTarget): void => {
    const key = deleteKey(target)
    if (confirmDelete !== key) {
      setConfirmDelete(key)
      return
    }
    setConfirmDelete(null)
    if (target.kind === 'installed') {
      void run(() => api<UninstallResult>('/uninstall', { profile: target.profile, id: target.id }))
    } else {
      void run(() => api<DisabledEntry>('/disabled/remove', { profile: target.profile, id: target.id }))
    }
  }

  const currentRoot = state?.workspaceRoot ?? ''
  const defaultRoot = state?.workspaceDefault ?? ''
  const historyPaths = (state?.workspaceHistory ?? []).filter(path => path !== currentRoot && path !== defaultRoot)
  const enabledEntries = state?.entries ?? []
  const disabledEntries = state?.disabled ?? []

  const resultPanel = (result !== null || logs.length > 0) ? (
    <div style={styles.card}>
      <h3 style={styles.title}>{t('result')}</h3>
      {logs.map((line, index) => (
        <pre key={index} style={{ ...styles.log, color: line.level === 'error' ? '#e05a5a' : undefined }}>
          [{line.level}] {line.message}
        </pre>
      ))}
      {result !== null && <pre style={styles.log}>{resultSummary(result)}</pre>}
    </div>
  ) : null

  const restartBanner = state?.restartNeeded === true ? (
    <div style={styles.banner}>
      <span>{t('restart')}</span>
      <button
        type="button"
        style={styles.button}
        disabled={busy}
        onClick={() => void run(async () => {
          await api<null>('/restart/clear', {})
          return { logs: [{ level: 'info', message: 'ok' }], dryRun: false } as AnyResult
        })}
      >
        {t('restartClear')}
      </button>
    </div>
  ) : null

  return (
    <div style={page === 'workspace' ? styles.workspaceRoot : styles.settingsRoot}>
      <div style={styles.topbar}>
        <div style={styles.tabs}>
          <button type="button" style={{ ...styles.tab, ...(page === 'workspace' ? styles.tabActive : {}) }} onClick={() => setPage('workspace')}>
            {t('pageWorkspace')}
          </button>
          <button type="button" style={{ ...styles.tab, ...(page === 'settings' ? styles.tabActive : {}) }} onClick={() => setPage('settings')}>
            {t('pageSettings')}
          </button>
        </div>

        {page === 'workspace' ? (
          <div style={styles.pathArea}>
            <span style={styles.topLabel}>{t('workspaceRoot')}</span>
            <select
              style={styles.select}
              value={currentRoot}
              disabled={state === null || busy}
              onChange={event => switchWorkspace(event.target.value)}
            >
              {currentRoot !== '' && <option value={currentRoot}>{t('currentPath')} · {currentRoot}</option>}
              {defaultRoot !== '' && defaultRoot !== currentRoot && <option value={defaultRoot}>{t('defaultPath')} · {defaultRoot}</option>}
              {historyPaths.map(path => (
                <option key={path} value={path}>{t('historyPath')} · {path}</option>
              ))}
            </select>
            <input
              style={{ ...styles.input, flex: '1 1 220px', minWidth: 180 }}
              value={pathDraft}
              onChange={event => setPathDraft(event.target.value)}
              placeholder={t('newPathPlaceholder')}
            />
            <button
              type="button"
              style={styles.button}
              disabled={busy || state === null || pathDraft.trim() === ''}
              onClick={() => switchWorkspace(pathDraft)}
            >
              {t('switchPath')}
            </button>
            <button
              type="button"
              style={{ ...styles.button, ...styles.ghost }}
              disabled={busy || state === null || currentRoot === defaultRoot}
              onClick={() => switchWorkspace(defaultRoot)}
            >
              {t('workspaceUseDefault')}
            </button>
          </div>
        ) : (
          <p style={styles.intro}>{t('pageSettingsHint')}</p>
        )}
      </div>

      {page === 'workspace' ? (
        <>
          <div style={styles.scroller}>
            {restartBanner}
            {error !== '' && <pre style={styles.error}>{error}</pre>}
            {resultPanel}

            <div style={styles.card}>
              <div style={styles.titleRow}>
                <div style={styles.sectionTitle}>
                  <h3 style={styles.title}>{t('installedTitle')}</h3>
                  <span style={styles.badge}>{enabledEntries.length}</span>
                </div>
                <span style={styles.mono} title={currentRoot}>{currentRoot || t('workspaceDefault')}</span>
              </div>
              {enabledEntries.length === 0 && <p style={styles.intro}>{t('empty')}</p>}
              <div style={styles.list}>
                {enabledEntries.map(entry => {
                  const key = deleteKey({ kind: 'installed', profile: entry.profile, id: entry.id })
                  return (
                    <div key={`${entry.profile}/${entry.id}`} style={styles.pluginCard}>
                      <div style={styles.pluginName}>
                        <strong>{entry.id}</strong>
                        <span style={entry.adapter === 'dsh-bundle' ? styles.hotBadge : styles.badge}>
                          {entry.adapter === 'dsh-bundle' ? t('hotBadge') : t('customBadge')}
                        </span>
                      </div>
                      <div style={styles.pluginDesc}>
                        <p style={styles.pluginSource}><span style={styles.label}>{t('pluginSummary')}: </span>{sourceSummary(entry.source, entry.ref)}</p>
                        <div style={styles.meta}>
                          <span style={styles.badge}>{entry.profile}</span>
                          {entry.ref !== '' && <span style={styles.mono}>{entry.ref}</span>}
                          {entry.pluginEnvDir !== undefined && <span style={styles.mono} title={entry.pluginEnvDir}>{t('env')}</span>}
                        </div>
                      </div>
                      <div style={styles.pluginActions}>
                        <label style={styles.switch} title={t('disable')}>
                          <input
                            type="checkbox"
                            checked
                            disabled={busy}
                            onChange={() => void run(() => api<UninstallResult>('/disable', { profile: entry.profile, id: entry.id }))}
                          />
                          {t('on')}
                        </label>
                        <button
                          type="button"
                          style={{ ...styles.button, ...(confirmDelete === key ? styles.dangerArmed : styles.danger) }}
                          disabled={busy}
                          onClick={() => requestDelete({ kind: 'installed', profile: entry.profile, id: entry.id })}
                        >
                          {confirmDelete === key ? t('deleteConfirm') : t('uninstall')}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={styles.card}>
              <div style={styles.titleRow}>
                <div style={styles.sectionTitle}>
                  <h3 style={styles.title}>{t('disabledTitle')}</h3>
                  <span style={styles.badge}>{disabledEntries.length}</span>
                </div>
                <span style={styles.intro}>{t('enable')} / {t('deleteDisabled')}</span>
              </div>
              {disabledEntries.length === 0 && <p style={styles.intro}>{t('disabledEmpty')}</p>}
              <div style={styles.list}>
                {disabledEntries.map(item => {
                  const key = deleteKey({ kind: 'disabled', profile: item.profile, id: item.id })
                  return (
                    <div key={`${item.profile}/${item.id}`} style={styles.pluginCard}>
                      <div style={styles.pluginName}>
                        <strong>{item.id}</strong>
                        <span style={item.adapter === 'dsh-bundle' ? styles.hotBadge : styles.badge}>
                          {item.adapter === 'dsh-bundle' ? t('hotBadge') : t('customBadge')}
                        </span>
                      </div>
                      <div style={styles.pluginDesc}>
                        <p style={styles.pluginSource}><span style={styles.label}>{t('pluginSummary')}: </span>{sourceSummary(item.source, item.ref)}</p>
                        <div style={styles.meta}>
                          <span style={styles.badge}>{item.profile}</span>
                          {item.ref !== '' && <span style={styles.mono}>{item.ref}</span>}
                        </div>
                      </div>
                      <div style={styles.pluginActions}>
                        <label style={styles.switch} title={t('enable')}>
                          <input
                            type="checkbox"
                            checked={false}
                            disabled={busy}
                            onChange={() => void run(() => api<InstallResult>('/enable', { profile: item.profile, id: item.id }))}
                          />
                          {t('off')}
                        </label>
                        <button
                          type="button"
                          style={{ ...styles.button, ...(confirmDelete === key ? styles.dangerArmed : styles.danger) }}
                          disabled={busy}
                          onClick={() => requestDelete({ kind: 'disabled', profile: item.profile, id: item.id })}
                        >
                          {confirmDelete === key ? t('deleteConfirm') : t('deleteDisabled')}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <form style={styles.footer} onSubmit={event => {
            event.preventDefault()
            if (source.trim() === '') return
            void run(() => api<AiInstallResult>('/ai-install', { source: source.trim() }))
          }}>
            <span style={styles.aiBadge}>AI</span>
            <div style={styles.footerInputWrap}>
              <input
                style={styles.input}
                value={source}
                onChange={event => setSource(event.target.value)}
                placeholder={t('installPlaceholder')}
                disabled={busy}
              />
              <p style={styles.intro}>{t('installFooterHint')} · {t('profile')}: {targetProfile}</p>
            </div>
            <button
              type="submit"
              style={{ ...styles.button, ...styles.primary }}
              disabled={busy || source.trim() === ''}
            >
              {busy ? t('running') : t('dispatchToAi')}
            </button>
          </form>
        </>
      ) : (
        <>
          <p style={styles.intro}>{t('workspaceHint')}</p>
          {error !== '' && <pre style={styles.error}>{error}</pre>}

          <div style={styles.card}>
            <div style={styles.titleRow}>
              <h3 style={styles.title}>{t('workspaceTitle')}</h3>
              <span style={styles.mono} title={currentRoot}>{t('workspaceDefault')}: {currentRoot}</span>
            </div>
            <label style={styles.field}>
              <span style={styles.label}>{t('workspaceRoot')}</span>
              <input
                style={styles.input}
                value={workspaceRoot}
                onChange={event => setWorkspaceRoot(event.target.value)}
                placeholder={defaultRoot}
              />
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
              <button
                type="button"
                style={{ ...styles.button, ...styles.ghost }}
                disabled={busy || state === null || workspaceRoot.trim() === ''}
                onClick={() => void run(() => api<PackageManagerConfig>('/config', { ...configPayload(), workspaceRoot: '' }))}
              >
                {t('workspaceUseDefault')}
              </button>
              <button
                type="button"
                style={{ ...styles.button, ...styles.ghost }}
                disabled={busy || (state?.workspaceHistory.length ?? 0) === 0}
                onClick={clearHistory}
              >
                {t('clearHistory')}
              </button>
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
                    disabled={busy || (storagePath === '' && remoteUrl === '')}
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
                  <div key={item.name} style={styles.pluginCard}>
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

          {resultPanel}
        </>
      )}
    </div>
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
