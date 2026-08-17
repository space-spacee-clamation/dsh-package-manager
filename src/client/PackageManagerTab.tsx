/**
 * Package manager settings tab.
 *
 * Page 1 is the package list: a requirements-root toolbar on top, scrollable
 * plugin cards in the middle, and a persistent AI-install input pinned at the
 * bottom. Page 2 keeps the original form-based settings for requirements
 * configuration and developer-mode operations.
 */

import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import type {
  AdapterInitResult, AiInstallResult, DisabledEntry, InstallResult, ManagerState, OperationLog, PackageManagerConfig,
  RestoreResult, UninstallResult,
} from '../types.ts'
import type { LocaleKey } from './locales.ts'
import { styles } from './styles.ts'

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
  const text = await response.text()
  if (text.trim() === '') {
    throw new Error(`HTTP ${response.status} 返回了空响应；DSH 可能在切换插件时重启了，请稍候重试或使用 CLI / AI 工具执行对齐`)
  }
  let payload: { ok: boolean; value?: T; error?: { code: string; message: string } }
  try {
    payload = JSON.parse(text) as typeof payload
  } catch {
    throw new Error(`HTTP ${response.status} 返回了非 JSON 响应：${text.slice(0, 120)}`)
  }
  if (!payload.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`)
  return payload.value as T
}

function logsOf(value: AnyResult): OperationLog[] {
  return 'logs' in value ? value.logs : []
}

function resultSummary(value: AnyResult): string {
  if ('sessionId' in value) return `session: ${value.sessionId}\nworkspace: ${value.workspacePath}`
  if ('actions' in value) {
    return value.actions.map(action => `${action.action}: ${action.profile}/${action.id} — ${action.reason}`).join('\n')
  }
  return JSON.stringify(value, null, 2)
}

function deleteKey(target: DeleteTarget): string {
  return `${target.kind}\u0000${target.profile}\u0000${target.id}`
}

function sourceSummary(source: string, ref: string): string {
  return ref.trim() === '' ? source : `${source} @ ${ref.trim()}`
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
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
      const message = messageOf(reason)
      setError(message)
      if (/空响应|Failed to fetch|NetworkError|fetch failed/i.test(message)) {
        // The host web server often restarts while plugins are switched.
        setTimeout(() => void refresh(), 1500)
      }
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

  const switchWorkspace = (path: string, force = false): void => {
    const target = path.trim()
    const current = state?.workspaceRoot ?? ''
    const defaultRoot = state?.workspaceDefault ?? ''
    if (state === null || busy || (!force && target === current)) return
    const useDefault = target === '' || target === defaultRoot
    const rawTarget = useDefault ? '' : target
    setPathDraft('')
    void (async () => {
      setBusy(true)
      setError('')
      setResult(null)
      setLogs([])
      try {
        const value = await api<RestoreResult>('/workspace/switch', { path: rawTarget })
        setResult(value)
        setLogs(logsOf(value))
        await refresh()
      } catch (reason) {
        const message = messageOf(reason)
        if (/空响应|Failed to fetch|NetworkError|fetch failed/i.test(message)) {
          setError('请求已提交，但响应中断（DSH Web 可能在切换插件时重启）。正在等待对齐完成…')
          const status = await waitForSwitchSettled(rawTarget)
          if (status === 'ok') {
            setError('')
            setResult({
              file: '',
              actions: [],
              installed: [],
              uninstalled: [],
              updated: [],
              logs: [{ level: 'info', message: '工作区对齐已完成（响应中断后通过轮询确认）。' }],
              dryRun: false,
            })
          } else if (status !== 'error') {
            setError(`${message}（等待对齐状态超时）`)
          }
        } else {
          setError(message)
        }
      } finally {
        setBusy(false)
      }
    })()
  }

  const waitForSwitchSettled = async (rawTarget: string, timeoutMs = 90_000): Promise<'ok' | 'error' | 'timeout'> => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const next = await api<ManagerState>('/state')
        setState(next)
        if (next.reconciling) {
          await delay(1200)
          continue
        }
        if (typeof next.switchError === 'string' && next.switchError !== '') {
          setError(`工作区对齐失败：${next.switchError}`)
          return 'error'
        }
        if (next.config.workspaceRoot === rawTarget) return 'ok'
      } catch {
        // The server is still reconnecting; keep polling.
      }
      await delay(1200)
    }
    return 'timeout'
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
  const historyCount = (state?.workspaceHistory ?? []).length
  const installedEntries = state?.entries ?? []

  const clearOutput = (): void => {
    setLogs([])
    setResult(null)
    setError('')
  }

  const resultOverlay = (result !== null || logs.length > 0 || error !== '' || state?.restartNeeded === true || state?.webRefreshNeeded === true) ? (
    <div style={styles.resultOverlay}>
      <div style={styles.titleRow}>
        <h3 style={styles.title}>{t('result')}</h3>
        <button type="button" style={styles.button} onClick={clearOutput}>{t('close')}</button>
      </div>
      {state?.restartNeeded === true && (
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
      )}
      {state?.webRefreshNeeded === true && (
        <div style={styles.banner}>
          <span>{t('webRefresh')}</span>
          <button
            type="button"
            style={styles.button}
            disabled={busy}
            onClick={() => void run(async () => {
              await api<null>('/web-refresh/clear', {})
              return { logs: [{ level: 'info', message: 'ok' }], dryRun: false } as AnyResult
            })}
          >
            {t('webRefreshClear')}
          </button>
        </div>
      )}
      {error !== '' && <pre style={styles.error}>{error}</pre>}
      <div style={styles.logPanel}>
        {logs.map((line, index) => (
          <pre key={index} style={{ ...styles.log, color: line.level === 'error' ? '#e05a5a' : undefined }}>
            [{line.level}] {line.message}
          </pre>
        ))}
        {result !== null && <pre style={styles.log}>{resultSummary(result)}</pre>}
      </div>
    </div>
  ) : null

  return (
    <div style={page === 'workspace' ? styles.workspaceRoot : styles.settingsRoot}>
      <header style={styles.header}>
        <div style={styles.brand}>
          <span style={styles.logo}>PM</span>
          <div>
            <h1 style={styles.pageTitle}>{page === 'workspace' ? t('pageWorkspace') : t('pageSettings')}</h1>
            <p style={styles.pageSubtitle}>{page === 'workspace' ? t('workspaceSwitchHint') : t('pageSettingsHint')}</p>
          </div>
        </div>
        <div style={styles.tabs}>
          <button type="button" style={{ ...styles.tab, ...(page === 'workspace' ? styles.tabActive : {}) }} onClick={() => setPage('workspace')}>
            {t('pageWorkspace')}
          </button>
          <button type="button" style={{ ...styles.tab, ...(page === 'settings' ? styles.tabActive : {}) }} onClick={() => setPage('settings')}>
            {t('pageSettings')}
          </button>
        </div>
      </header>

      {page === 'workspace' ? (
        <div style={styles.pathCard}>
          <div style={styles.pathArea}>
            <span style={styles.topLabel}>{t('requirementsRoot')}</span>
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
            <button
              type="button"
              style={{ ...styles.button, ...styles.ghost }}
              disabled={busy || state === null || currentRoot === ''}
              onClick={() => switchWorkspace(currentRoot, true)}
            >
              {t('realignWorkspace')}
            </button>
          </div>
        </div>
      ) : null}

      {page === 'workspace' ? (
        <>
          <div style={styles.scroller}>
            <div style={styles.card}>
              <div style={styles.titleRow}>
                <div style={styles.sectionTitle}>
                  <h3 style={styles.title}>{t('installedTitle')}</h3>
                  <span style={styles.badge}>{installedEntries.length}</span>
                </div>
                <span style={styles.mono} title={currentRoot}>{currentRoot || t('workspaceDefault')}</span>
              </div>
              {installedEntries.length === 0 && <p style={styles.intro}>{t('empty')}</p>}
              <div style={styles.pluginGrid}>
                {installedEntries.map(entry => {
                  const key = deleteKey({ kind: 'installed', profile: entry.profile, id: entry.id })
                  const off = entry.disabled === true
                  return (
                    <div
                      key={`${entry.profile}/${entry.id}`}
                      style={{
                        ...styles.pluginCard,
                        ...(off ? styles.disabledCard : entry.adapter === 'dsh-bundle' ? styles.hotCard : {}),
                      }}
                    >
                      <div style={styles.pluginTop}>
                        <span style={styles.pluginLogo}>{entry.id.slice(0, 2).toUpperCase()}</span>
                        <div style={styles.pluginName}>
                          <strong style={styles.pluginTitle}>{entry.id}</strong>
                          <p style={styles.pluginSource}>{sourceSummary(entry.source, entry.ref)}</p>
                          <span style={entry.adapter === 'dsh-bundle' ? styles.hotBadge : styles.badge}>
                            {entry.adapter === 'dsh-bundle' ? t('hotBadge') : t('customBadge')}
                          </span>
                        </div>
                      </div>
                      <div style={styles.meta}>
                        <span style={styles.badge}>{entry.profile}</span>
                        {entry.ref !== '' && <span style={styles.mono}>{entry.ref}</span>}
                        {entry.adapter === 'dsh-bundle' && entry.packageName !== '' && (
                          <span style={styles.mono} title={entry.packageName}>{entry.packageName}</span>
                        )}
                      </div>
                      <div style={styles.pluginBottom}>
                        <button
                          type="button"
                          style={{ ...styles.button, ...(confirmDelete === key ? styles.dangerArmed : styles.danger) }}
                          disabled={busy}
                          onClick={() => requestDelete({ kind: 'installed', profile: entry.profile, id: entry.id })}
                        >
                          {confirmDelete === key ? t('deleteConfirm') : t('uninstall')}
                        </button>
                        <label style={styles.switchTrack} title={off ? t('enable') : t('disable')}>
                          <input
                            type="checkbox"
                            style={styles.switchInput}
                            checked={!off}
                            disabled={busy}
                            onChange={() => void run(() => api<UninstallResult | InstallResult>(
                              off ? '/enable' : '/disable',
                              { profile: entry.profile, id: entry.id },
                            ))}
                          />
                          <span style={{ ...styles.switchSlider, ...(off ? {} : styles.switchSliderOn) }}>
                            <span style={{ ...styles.switchKnob, ...(off ? {} : styles.switchKnobOn) }} />
                          </span>
                        </label>
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
                disabled={busy || historyCount === 0}
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

        </>
      )}

      {resultOverlay}
    </div>
  )
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
