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
  border: '1px solid #D6D9E6',
  borderRadius: 14,
  background: '#ffffff',
  color: 'hsl(227, 75%, 14%)',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 700,
  whiteSpace: 'nowrap',
}

const activeButtonStyle: CSSProperties = {
  ...buttonStyle,
  border: '1px solid #C7D4FA',
  background: '#EDF2FF',
  color: '#4f6ef7',
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  background: 'rgba(15,20,35,0.28)',
  display: 'flex',
  alignItems: 'stretch',
  justifyContent: 'stretch',
}

const panelStyle: CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: 'min(1360px, calc(100vw - 36px))',
  height: 'min(860px, calc(100vh - 36px))',
  transform: 'translate(-50%, -50%)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  border: '1px solid #D6D9E6',
  borderRadius: 20,
  background: 'linear-gradient(180deg, #F5F6F8 0%, #ECEEF1 100%)',
  color: 'hsl(227, 75%, 14%)',
}

const panelContentStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
}

const closeStyle: CSSProperties = {
  alignSelf: 'flex-end',
  margin: 10,
  padding: '7px 12px',
  border: '1px solid #D6D9E6',
  borderRadius: 12,
  background: '#ffffff',
  color: 'hsl(227, 75%, 14%)',
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
