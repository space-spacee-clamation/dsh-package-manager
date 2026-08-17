/**
 * Package-manager settings styles.
 * Visual reference: Dannimations/Browser-extensions-manager-ui (Frontend
 * Mentor challenge). Light blue gradient canvas, white rounded cards, a
 * neutral border, red active switches, and a stable three-column plugin grid.
 * Output and notices are overlays and never reflow the core content.
 */

import type { CSSProperties } from 'react'

const NEUTRAL_900 = 'hsl(227, 75%, 14%)'
const NEUTRAL_600 = 'hsl(226, 11%, 37%)'
const NEUTRAL_300 = 'hsl(0, 0%, 78%)'
const NEUTRAL_200 = 'hsl(217, 61%, 90%)'
const NEUTRAL_100 = 'hsl(0, 0%, 93%)'
const NEUTRAL_0 = 'hsl(200, 60%, 99%)'
const RED_500 = 'hsl(3, 71%, 56%)'
const RED_400 = 'hsl(3, 86%, 64%)'
const CANVAS = 'linear-gradient(180deg, #F5F6F8 0%, #ECEEF1 100%)'
const BORDER = '#D6D9E6'
const TEXT = NEUTRAL_900
const MUTED = 'rgba(39, 49, 86, 0.62)'
const ACCENT = '#4f6ef7'
const ACCENT_BG = '#EDF2FF'
const ACCENT_BORDER = '#C7D4FA'

export const styles: Record<string, CSSProperties> = {
  workspaceRoot: {
    boxSizing: 'border-box', position: 'relative', display: 'flex', flexDirection: 'column', height: '100%',
    minHeight: 0, maxWidth: 1320, width: '100%', margin: '0 auto', gap: 16,
    padding: '20px 24px 22px', overflow: 'hidden', background: CANVAS, color: TEXT,
    fontFamily: "'Noto Sans', 'Segoe UI', sans-serif",
  },
  settingsRoot: {
    boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960, width: '100%',
    margin: '0 auto', padding: '0 0 40px', background: 'transparent', color: TEXT,
    fontFamily: "'Noto Sans', 'Segoe UI', sans-serif",
  },
  header: {
    flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 14, flexWrap: 'wrap', padding: '4px 6px',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
  logo: {
    width: 44, height: 44, flex: 'none', display: 'grid', placeItems: 'center',
    fontSize: 17, fontWeight: 850, color: '#ffffff', background: ACCENT, borderRadius: 14,
  },
  pageTitle: { margin: 0, fontSize: 20, fontWeight: 780, letterSpacing: -0.2 },
  pageSubtitle: { margin: '4px 0 0', fontSize: 13, color: MUTED, lineHeight: 1.55 },
  intro: { color: MUTED, lineHeight: 1.7, margin: 0, fontSize: 13 },
  pathCard: {
    flex: 'none', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    padding: '16px 20px', border: `1px solid ${BORDER}`, borderRadius: 20,
    background: NEUTRAL_0, boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
  },
  pathArea: { display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 560px', minWidth: 340, flexWrap: 'wrap' },
  topLabel: { fontSize: 12, color: MUTED, whiteSpace: 'nowrap', fontWeight: 700 },
  tabs: {
    display: 'flex', gap: 6, padding: 5, border: `1px solid ${BORDER}`,
    borderRadius: 16, background: NEUTRAL_100,
  },
  tab: {
    padding: '8px 16px', border: '1px solid transparent', borderRadius: 12,
    background: 'transparent', color: MUTED, cursor: 'pointer', whiteSpace: 'nowrap',
    fontSize: 13, fontWeight: 700,
  },
  tabActive: { background: '#ffffff', color: TEXT, borderColor: BORDER },
  select: {
    flex: '1 1 260px', minWidth: 200, padding: '10px 12px',
    border: `1px solid ${BORDER}`, borderRadius: 12, background: '#ffffff',
    color: TEXT, textOverflow: 'ellipsis',
  },
  input: {
    padding: '10px 12px', border: `1px solid ${BORDER}`, borderRadius: 12,
    background: '#ffffff', color: TEXT, minWidth: 0,
  },
  button: {
    padding: '9px 15px', border: `1px solid ${BORDER}`, borderRadius: 12,
    background: '#ffffff', color: TEXT, cursor: 'pointer', whiteSpace: 'nowrap',
    fontSize: 13, fontWeight: 700,
  },
  primary: { borderColor: ACCENT_BORDER, color: ACCENT, background: ACCENT_BG },
  ghost: { opacity: 0.8 },
  danger: { borderColor: '#F1B7B2', color: '#B3342B', background: '#FFF3F2' },
  dangerArmed: { borderColor: '#B3342B', color: '#ffffff', background: '#B3342B' },
  scroller: {
    flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column',
    gap: 16, padding: '2px 6px 16px', scrollbarGutter: 'stable',
  },
  footer: {
    flex: 'none', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
    padding: '16px 18px', border: `1px solid ${ACCENT_BORDER}`, borderRadius: 20,
    background: '#ffffff',
  },
  footerInputWrap: { flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 5, minWidth: 230 },
  card: {
    border: `1px solid ${BORDER}`, borderRadius: 20, padding: 20,
    display: 'flex', flexDirection: 'column', gap: 14, background: NEUTRAL_0,
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
  },
  title: { margin: 0, fontSize: 16, fontWeight: 780 },
  titleRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  field: { display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 240px', minWidth: 200 },
  label: { fontSize: 12, color: MUTED, fontWeight: 700 },
  banner: {
    border: `1px solid #E8C98B`, borderRadius: 14, padding: '12px 14px',
    display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between',
    flexWrap: 'wrap', background: '#FFF8E9',
  },
  logPanel: { maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 },
  log: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 },
  mono: {
    fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, padding: '4px 9px',
    border: `1px solid ${BORDER}`, borderRadius: 999, color: MUTED, overflowWrap: 'anywhere',
  },
  localGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 12, alignItems: 'stretch',
  },
  localRow: {
    display: 'flex', flexDirection: 'column', alignItems: 'stretch',
    justifyContent: 'space-between', gap: 10, minHeight: 116,
    padding: '12px 12px', border: `1px solid ${BORDER}`, borderRadius: 14,
    background: NEUTRAL_0,
  },
  localTop: { display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 },
  localName: { minWidth: 0, fontWeight: 750, fontSize: 13, overflowWrap: 'anywhere' },
  pluginGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 18, alignItems: 'stretch',
  },
  list: { display: 'flex', flexDirection: 'column', gap: 10 },
  pluginCard: {
    border: `1px solid ${BORDER}`, borderRadius: 20, padding: '16px 16px 14px',
    display: 'flex', flexDirection: 'column', gap: 14, minHeight: 184,
    background: '#ffffff', boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
  },
  hotCard: { borderColor: ACCENT_BORDER },
  disabledCard: { opacity: 0.55, background: NEUTRAL_100 },
  pluginTop: { display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 },
  pluginLogo: {
    width: 40, height: 40, flex: 'none', display: 'grid', placeItems: 'center',
    borderRadius: 12, background: ACCENT_BG, color: ACCENT, fontSize: 15, fontWeight: 850,
  },
  pluginName: { display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start', minWidth: 0 },
  pluginTitle: { margin: 0, fontSize: 15, fontWeight: 780 },
  pluginDesc: { flex: 1, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', minWidth: 0 },
  pluginSource: {
    margin: 0, fontSize: 12, lineHeight: 1.5, overflowWrap: 'anywhere', color: MUTED,
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  pluginBottom: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 'auto' },
  pluginActions: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  meta: { fontSize: 12, color: MUTED, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  badge: { fontSize: 11, padding: '3px 9px', borderRadius: 999, border: `1px solid ${BORDER}`, color: MUTED, background: '#F7F8FA' },
  hotBadge: { fontSize: 11, padding: '3px 9px', borderRadius: 999, border: `1px solid ${ACCENT_BORDER}`, color: ACCENT, background: ACCENT_BG },
  aiBadge: {
    fontSize: 11, padding: '5px 11px', borderRadius: 999, border: `1px solid ${ACCENT_BORDER}`,
    color: '#ffffff', background: ACCENT, whiteSpace: 'nowrap', fontWeight: 850,
  },
  error: { color: '#B3342B', fontSize: 12, whiteSpace: 'pre-wrap' },
  switch: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
  sectionTitle: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  statusDot: { width: 8, height: 8, borderRadius: 999, flex: 'none', background: '#3fae5a' },
  switchTrack: { position: 'relative', display: 'inline-block', width: 50, height: 28, cursor: 'pointer' },
  switchInput: { opacity: 0, width: 0, height: 0 },
  switchSlider: {
    position: 'absolute', inset: 0, background: NEUTRAL_300, borderRadius: 28, transition: '0.3s',
  },
  switchSliderOn: { background: RED_500 },
  switchKnob: {
    position: 'absolute', height: 20, width: 20, left: 4, bottom: 4,
    background: '#ffffff', borderRadius: '50%', transition: '0.3s',
  },
  switchKnobOn: { transform: 'translateX(22px)' },
  toggleOn: {
    minWidth: 58, padding: '7px 12px', borderRadius: 12, border: `1px solid ${ACCENT_BORDER}`,
    background: ACCENT_BG, color: ACCENT, fontSize: 13, fontWeight: 750, cursor: 'pointer',
  },
  toggleOff: {
    minWidth: 58, padding: '7px 12px', borderRadius: 12, border: `1px solid ${BORDER}`,
    background: NEUTRAL_200, color: NEUTRAL_600, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  resultOverlay: {
    position: 'absolute', right: 16, bottom: 90, width: 390, maxWidth: 'calc(100% - 32px)',
    zIndex: 30, border: `1px solid ${ACCENT_BORDER}`, borderRadius: 18,
    background: '#ffffff', color: TEXT, padding: 14,
    display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflow: 'hidden',
    boxShadow: '0 6px 18px rgba(30,50,100,0.12)',
  },
}
