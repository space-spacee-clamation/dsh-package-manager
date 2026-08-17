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
  border: '1px solid #cfd3d8',
  background: '#ffffff',
  color: '#1c2024',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 700,
  whiteSpace: 'nowrap',
}

const activeButtonStyle: CSSProperties = {
  ...buttonStyle,
  border: '1px solid #b9c8f0',
  background: '#eaf0ff',
  color: '#274b9f',
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  background: 'rgba(17,20,23,0.30)',
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'stretch',
}

const panelStyle: CSSProperties = {
  position: 'absolute',
  top: 20,
  right: 20,
  bottom: 20,
  left: 240,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  border: '1px solid #d5d8dc',
  background: '#f2f3f5',
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
  border: '1px solid #cfd3d8',
  background: '#ffffff',
  color: '#1c2024',
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
