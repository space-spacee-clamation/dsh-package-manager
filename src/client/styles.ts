/**
 * Package-manager settings styles. Card-based layout matching the harness
 * conversation surfaces: dark neutral cards, thin borders, restrained radius.
 * Core plugin grid is always three columns; notices and results are overlays,
 * so they never reflow the main content.
 */

import type { CSSProperties } from 'react'

const SURFACE = 'var(--dsw-surface, rgba(255,255,255,0.025))'
const SURFACE_STRONG = 'var(--dsw-surface, rgba(255,255,255,0.05))'
const BORDER = 'var(--dsw-border, rgba(127,127,127,0.22))'
const MUTED = 'rgba(220,226,240,0.62)'
const ACCENT = '#a8c0ff'
const ACCENT_BG = 'rgba(88,136,255,0.14)'
const ACCENT_BORDER = 'rgba(88,136,255,0.42)'

export const styles: Record<string, CSSProperties> = {
  workspaceRoot: {
    position: 'relative', display: 'flex', flexDirection: 'column', height: '100%',
    minHeight: 500, maxWidth: 1180, width: '100%', margin: '0 auto', gap: 14, padding: '14px 4px 0',
  },
  settingsRoot: {
    display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 940,
    width: '100%', margin: '0 auto', padding: '0 0 40px',
  },
  header: {
    flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 14, flexWrap: 'wrap', padding: '2px 4px',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
  logo: {
    width: 40, height: 40, flex: 'none', display: 'grid', placeItems: 'center',
    fontSize: 16, fontWeight: 850, color: ACCENT, background: ACCENT_BG,
    border: `1px solid ${ACCENT_BORDER}`, borderRadius: 12,
  },
  pageTitle: { margin: 0, fontSize: 18, fontWeight: 760 },
  pageSubtitle: { margin: '4px 0 0', fontSize: 12, color: MUTED, lineHeight: 1.55 },
  intro: { color: MUTED, lineHeight: 1.7, margin: 0, fontSize: 13 },
  pathCard: {
    flex: 'none', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    padding: '12px 14px', border: `1px solid ${BORDER}`, borderRadius: 14, background: SURFACE,
  },
  pathArea: { display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 560px', minWidth: 340, flexWrap: 'wrap' },
  topLabel: { fontSize: 12, color: MUTED, whiteSpace: 'nowrap', fontWeight: 650 },
  tabs: {
    display: 'flex', gap: 4, padding: 4, border: `1px solid ${BORDER}`,
    borderRadius: 12, background: 'rgba(127,127,127,0.06)',
  },
  tab: {
    padding: '8px 14px', border: '1px solid transparent', borderRadius: 9,
    background: 'transparent', color: MUTED, cursor: 'pointer', whiteSpace: 'nowrap',
    fontSize: 13, fontWeight: 650,
  },
  tabActive: { background: ACCENT_BG, color: ACCENT, borderColor: ACCENT_BORDER },
  select: {
    flex: '1 1 260px', minWidth: 200, padding: '9px 11px',
    border: `1px solid ${BORDER}`, borderRadius: 10, background: SURFACE_STRONG,
    color: 'inherit', textOverflow: 'ellipsis',
  },
  input: {
    padding: '9px 11px', border: `1px solid ${BORDER}`, borderRadius: 10,
    background: SURFACE_STRONG, color: 'inherit', minWidth: 0,
  },
  button: {
    padding: '8px 14px', border: `1px solid ${BORDER}`, borderRadius: 10,
    background: SURFACE_STRONG, color: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
    fontSize: 13, fontWeight: 650,
  },
  primary: { borderColor: ACCENT_BORDER, color: ACCENT, background: ACCENT_BG },
  ghost: { opacity: 0.78 },
  danger: { borderColor: 'rgba(220,80,80,0.55)', color: '#e05a5a', background: 'rgba(220,80,80,0.07)' },
  dangerArmed: { borderColor: '#e05a5a', color: '#fff', background: 'rgba(220,80,80,0.35)' },
  scroller: {
    flex: 1, minHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column',
    gap: 14, padding: '2px 4px 14px', scrollbarGutter: 'stable',
  },
  footer: {
    flex: 'none', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
    padding: '14px 16px', border: `1px solid ${ACCENT_BORDER}`, borderRadius: 14,
    background: 'linear-gradient(135deg, rgba(88,136,255,0.14), rgba(88,136,255,0.03))',
  },
  footerInputWrap: { flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 5, minWidth: 230 },
  card: {
    border: `1px solid ${BORDER}`, borderRadius: 14, padding: 16,
    display: 'flex', flexDirection: 'column', gap: 12, background: SURFACE,
  },
  title: { margin: 0, fontSize: 15, fontWeight: 720 },
  titleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 240px', minWidth: 200 },
  label: { fontSize: 12, color: MUTED },
  banner: {
    border: `1px solid rgba(255,190,80,0.55)`, borderRadius: 12, padding: '12px 14px',
    display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between',
    flexWrap: 'wrap', background: 'rgba(255,190,80,0.07)',
  },
  logPanel: { maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 },
  log: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 },
  mono: {
    fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, padding: '4px 9px',
    border: `1px solid ${BORDER}`, borderRadius: 999, opacity: 0.88, overflowWrap: 'anywhere',
  },
  pluginGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 12,
    alignItems: 'stretch',
  },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  pluginCard: {
    border: `1px solid ${BORDER}`, borderRadius: 14, padding: '14px 15px',
    display: 'flex', flexDirection: 'column', gap: 12, minHeight: 148,
    background: SURFACE,
  },
  hotCard: { borderColor: ACCENT_BORDER, background: 'rgba(88,136,255,0.06)' },
  disabledCard: { opacity: 0.52, background: 'rgba(127,127,127,0.035)' },
  pluginName: { display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', minWidth: 0 },
  pluginDesc: { flex: 1, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', minWidth: 0 },
  pluginSource: {
    margin: 0, fontSize: 13, lineHeight: 1.55, overflowWrap: 'anywhere',
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  pluginActions: { display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
  meta: { fontSize: 12, color: MUTED, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  badge: { fontSize: 11, padding: '3px 9px', borderRadius: 999, border: `1px solid ${BORDER}`, color: MUTED },
  hotBadge: { fontSize: 11, padding: '3px 9px', borderRadius: 999, border: `1px solid ${ACCENT_BORDER}`, color: ACCENT, background: ACCENT_BG },
  aiBadge: {
    fontSize: 11, padding: '5px 11px', borderRadius: 999, border: `1px solid ${ACCENT_BORDER}`,
    color: ACCENT, background: ACCENT_BG, whiteSpace: 'nowrap', fontWeight: 850,
  },
  error: { color: '#e05a5a', fontSize: 12, whiteSpace: 'pre-wrap' },
  switch: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
  sectionTitle: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  statusDot: { width: 8, height: 8, borderRadius: 999, flex: 'none', background: '#6fdc8c' },
  toggleOn: {
    minWidth: 58, padding: '7px 12px', borderRadius: 10, border: `1px solid ${ACCENT_BORDER}`,
    background: ACCENT_BG, color: ACCENT, fontSize: 13, fontWeight: 750, cursor: 'pointer',
  },
  toggleOff: {
    minWidth: 58, padding: '7px 12px', borderRadius: 10, border: `1px solid ${BORDER}`,
    background: 'rgba(127,127,127,0.10)', color: MUTED, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  resultOverlay: {
    position: 'absolute', right: 16, bottom: 86, width: 380, maxWidth: 'calc(100% - 32px)',
    zIndex: 30, border: `1px solid ${ACCENT_BORDER}`, borderRadius: 14,
    background: 'var(--dsw-background, #171a1f)', color: 'inherit', padding: 14,
    display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflow: 'hidden',
  },
  noticeStack: {
    position: 'absolute', top: 12, right: 16, zIndex: 40,
    display: 'flex', flexDirection: 'column', gap: 8, width: 380, maxWidth: 'calc(100% - 32px)',
  },
}
