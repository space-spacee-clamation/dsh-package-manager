/**
 * Package-manager settings styles.
 * Flat gray-white surface, square corners, no shadows or gradients.
 */

import type { CSSProperties } from 'react'

const SURFACE = '#ffffff'
const CANVAS = '#f2f3f5'
const BORDER = '#d5d8dc'
const TEXT = '#1c2024'
const MUTED = 'rgba(28,32,36,0.62)'
const ACCENT = '#274b9f'
const ACCENT_BG = '#eaf0ff'
const ACCENT_BORDER = '#b9c8f0'

export const styles: Record<string, CSSProperties> = {
  workspaceRoot: {
    display: 'flex', flexDirection: 'column', height: '100%', minHeight: 480,
    maxWidth: 1180, width: '100%', margin: '0 auto', gap: 12, padding: 16,
    background: CANVAS, color: TEXT,
  },
  settingsRoot: {
    display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 920,
    width: '100%', margin: '0 auto', padding: 16, background: CANVAS, color: TEXT,
  },
  header: {
    flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 14, flexWrap: 'wrap', padding: '0 0 10px',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
  logo: {
    width: 40, height: 40, flex: 'none', display: 'grid', placeItems: 'center',
    fontSize: 16, fontWeight: 850, color: ACCENT, background: ACCENT_BG,
    border: `1px solid ${ACCENT_BORDER}`,
  },
  pageTitle: { margin: 0, fontSize: 18, fontWeight: 760 },
  pageSubtitle: { margin: '3px 0 0', fontSize: 12, color: MUTED, lineHeight: 1.55 },
  intro: { color: MUTED, lineHeight: 1.7, margin: 0, fontSize: 13 },
  pathCard: {
    flex: 'none', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    padding: '12px 14px', border: `1px solid ${BORDER}`, background: SURFACE,
  },
  pathArea: { display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 560px', minWidth: 340, flexWrap: 'wrap' },
  topLabel: { fontSize: 12, color: MUTED, whiteSpace: 'nowrap', fontWeight: 650 },
  tabs: { display: 'flex', gap: 4, padding: 4, border: `1px solid ${BORDER}`, background: '#e6e8eb' },
  tab: {
    padding: '8px 14px', border: '1px solid transparent', background: 'transparent',
    color: MUTED, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 650,
  },
  tabActive: { background: SURFACE, color: TEXT, border: `1px solid ${BORDER}` },
  select: {
    flex: '1 1 260px', minWidth: 200, padding: '9px 11px',
    border: `1px solid ${BORDER}`, background: SURFACE, color: TEXT, textOverflow: 'ellipsis',
  },
  input: {
    padding: '9px 11px', border: `1px solid ${BORDER}`, background: SURFACE,
    color: TEXT, minWidth: 0,
  },
  button: {
    padding: '8px 14px', border: '1px solid #cfd3d8', background: SURFACE,
    color: TEXT, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 650,
  },
  primary: { borderColor: ACCENT_BORDER, color: ACCENT, background: ACCENT_BG },
  ghost: { opacity: 0.78 },
  danger: { borderColor: '#f0b9b9', color: '#b33a3a', background: '#fdeeee' },
  dangerArmed: { borderColor: '#b33a3a', color: '#ffffff', background: '#b33a3a' },
  scroller: {
    flex: 1, minHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column',
    gap: 12, padding: '0 0 14px', scrollbarGutter: 'stable',
  },
  footer: {
    flex: 'none', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
    padding: '14px 16px', border: `1px solid ${ACCENT_BORDER}`, background: ACCENT_BG,
  },
  footerInputWrap: { flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 5, minWidth: 230 },
  card: {
    border: `1px solid ${BORDER}`, padding: 16, display: 'flex', flexDirection: 'column',
    gap: 12, background: SURFACE,
  },
  title: { margin: 0, fontSize: 15, fontWeight: 740 },
  titleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 240px', minWidth: 200 },
  label: { fontSize: 12, color: MUTED },
  banner: {
    border: '1px solid #e7c98a', padding: '12px 14px', display: 'flex', gap: 10,
    alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', background: '#fff7e6',
  },
  logPanel: { maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 },
  log: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 },
  mono: {
    fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, padding: '4px 9px',
    border: `1px solid ${BORDER}`, color: MUTED, overflowWrap: 'anywhere',
  },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  pluginCard: {
    border: `1px solid ${BORDER}`, padding: '14px 16px', display: 'flex',
    alignItems: 'center', gap: 16, flexWrap: 'wrap', background: SURFACE,
  },
  hotCard: { borderColor: ACCENT_BORDER, background: '#f6f8ff' },
  disabledCard: { opacity: 0.5 },
  pluginName: { flex: '1 1 180px', minWidth: 150, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' },
  pluginDesc: { flex: '1 1 320px', minWidth: 230, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' },
  pluginSource: { margin: 0, fontSize: 13, lineHeight: 1.55, overflowWrap: 'anywhere' },
  pluginActions: { flex: '0 0 auto', display: 'flex', gap: 10, alignItems: 'center' },
  meta: { fontSize: 12, color: MUTED, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  badge: { fontSize: 11, padding: '3px 9px', border: `1px solid ${BORDER}`, color: MUTED, background: '#f6f7f8' },
  hotBadge: { fontSize: 11, padding: '3px 9px', border: `1px solid ${ACCENT_BORDER}`, color: ACCENT, background: ACCENT_BG },
  aiBadge: {
    fontSize: 11, padding: '5px 11px', border: `1px solid ${ACCENT_BORDER}`,
    color: ACCENT, background: ACCENT_BG, whiteSpace: 'nowrap', fontWeight: 850,
  },
  error: { color: '#b33a3a', fontSize: 12, whiteSpace: 'pre-wrap' },
  switch: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
  sectionTitle: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  statusDot: { width: 8, height: 8, flex: 'none', background: '#3fae5a' },
  toggleOn: {
    minWidth: 58, padding: '7px 12px', border: `1px solid ${ACCENT_BORDER}`,
    background: ACCENT_BG, color: ACCENT, fontSize: 13, fontWeight: 750, cursor: 'pointer',
  },
  toggleOff: {
    minWidth: 58, padding: '7px 12px', border: `1px solid ${BORDER}`,
    background: '#e9ebee', color: '#6f747a', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
}
