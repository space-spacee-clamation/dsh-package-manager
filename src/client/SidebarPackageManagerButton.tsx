/**
 * Main-menu package-manager entry beside Settings in the sidebar footer.
 * Clicking it opens a large flat panel with the same package-manager page.
 */

import { useState, type CSSProperties, type ReactElement } from 'react'
import { PackageManagerTab } from './PackageManagerTab.tsx'
import type { LocaleKey } from './locales.ts'

export interface SidebarPackageManagerButtonProps {
  wide: boolean
  t: (key: LocaleKey) => string
}

const buttonStyle: CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '10px 12px',
  border: '1px solid var(--dsw-border, rgba(127,127,127,0.22))',
  borderRadius: 12,
  background: 'var(--dsw-surface, rgba(255,255,255,0.04))',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 700,
  whiteSpace: 'nowrap',
}

const activeButtonStyle: CSSProperties = {
  ...buttonStyle,
  border: '1px solid rgba(88,136,255,0.50)',
  background: 'rgba(88,136,255,0.16)',
  color: '#a8c0ff',
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  background: 'rgba(0,0,0,0.38)',
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'stretch',
}

const panelStyle: CSSProperties = {
  position: 'absolute',
  top: 20,
  right: 20,
  bottom: 20,
  left: 232,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  border: '1px solid var(--dsw-border, rgba(127,127,127,0.22))',
  borderRadius: 14,
  background: 'var(--dsw-background, #171a1f)',
  color: 'inherit',
}

const panelContentStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
}

const closeStyle: CSSProperties = {
  alignSelf: 'flex-end',
  margin: 10,
  padding: '7px 12px',
  border: '1px solid var(--dsw-border, rgba(127,127,127,0.22))',
  borderRadius: 10,
  background: 'var(--dsw-surface, rgba(255,255,255,0.05))',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
}

export function SidebarPackageManagerButton({ wide, t }: SidebarPackageManagerButtonProps): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        style={open ? activeButtonStyle : buttonStyle}
        title={t('sidebarLabel')}
        onClick={() => setOpen(value => !value)}
      >
        <span style={{ fontSize: wide ? 14 : 18 }}>▣</span>
        {wide && <span>{t('sidebarLabel')}</span>}
      </button>
      {open && (
        <div style={overlayStyle} onClick={() => setOpen(false)}>
          <section style={panelStyle} onClick={event => event.stopPropagation()}>
            <button type="button" style={closeStyle} onClick={() => setOpen(false)}>{t('close')}</button>
            <div style={panelContentStyle}>
              <PackageManagerTab t={t} />
            </div>
          </section>
        </div>
      )}
    </>
  )
}
