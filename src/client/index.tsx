/**
 * @dsh-ext/dsh-package-manager — browser half. Contributes the "包管理"
 * tab to the Plugins settings section. All host data flows through the
 * /pm-api JSON route; this half has no other business state.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings shell's SlotMap declaration for 'settings.plugins.tab'.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { en, zh, type LocaleKey } from './locales.ts'
import { PackageManagerTab } from './PackageManagerTab.tsx'
import { SidebarPackageManagerButton } from './SidebarPackageManagerButton.tsx'

export const name = 'dsh-package-manager'

export const inject = ['slots', 'locale']

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.packageManager'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Actions beside Settings at the sidebar foot. */
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: { wide: boolean } }
  }
  interface LocaleNamespaceMap {
    /** Package manager settings tab copy. */
    'settings.packageManager': LocaleKey
  }
}

/**
 * Register the package-manager tab. Waiting on the slot declaration mirrors
 * the official registrants: a direct register racing the declaration fails.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'package-manager: dictionaries')

  const t = ctx.locale.bind(NS)
  const injectT = (): { t: (key: keyof typeof zh) => string } => ({ t: ctx.locale.bind(NS) })

  // Keep the Plugins-section tab for discoverability.
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'package-manager',
    order: 5,
    label: () => t('tab'),
    locale: NS,
    inject: injectT,
  }, PackageManagerTab))

  // Main-menu entry beside Settings: a large package-manager panel opens
  // from the sidebar footer action seat.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'package-manager',
    order: 0,
    label: () => t('sidebarLabel'),
    locale: NS,
    inject: injectT,
  }, SidebarPackageManagerButton))
}
