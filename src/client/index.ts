/**
 * Browser-half entry for the union-workspace plugin — runs inside the dsh
 * web GUI. Registers locale dictionaries, a right-side file explorer for
 * union-workspace sessions, and the /uw command.
 *
 * When a session belongs to a union workspace, the right side of the
 * conversation shows the member directories and files. A collapse/expand
 * button on the right edge toggles the panel.
 *
 * All data flows through same-origin /api/dsh-union-workspace/* routes
 * served by the host half.
 */
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and its
// LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-slots register surface and the SlotMap/Locale
// namespace merge tables.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the conversation-surface SlotMap merge (header slots).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ctx.commandUi service merge.
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import { FilesHeaderAction } from './components/Header.tsx'
import { ManagementPanel } from './components/ManagementPanel.tsx'
import { Overlay } from './components/Overlay.tsx'
import { RightFilePanel } from './components/RightFilePanel.tsx'
import { en, zh, type UnionKey } from './locales.ts'
import { bindRuntime, runtime } from './runtime.ts'
import { unionStore } from './store.ts'
import { tt } from './translate.ts'

/** Locale namespace this plugin owns. */
const NS = 'union-workspace'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'union-workspace': UnionKey
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'sessions', 'workspaces', 'locale']

/**
 * Mount the union-workspace browser half.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  console.log('union-workspace: apply() called')
  ctx.effect(() => {
    const locale = ctx.get('locale') as { register: (ns: string, dicts: Record<string, Record<string, string>>) => () => void } | undefined
    if (locale !== undefined) return locale.register(NS, { zh, en })
    return () => {}
  }, 'union-workspace: dictionaries')

  bindRuntime(ctx.workspaces, ctx.sessions as never, ctx.locale as never)

  // Settings section for union workspace management.
  ctx.slots.inject('settings.section' as never, () => {
    const unregister = ctx.slots.register({
      name: 'settings.section',
      id: 'union-workspace',
      order: 90,
      label: () => tt('sidebar.title'),
    } as never, ((props: { close: () => void }) => {
      return h(ManagementPanel, { close: props.close })
    }) as never)
    return () => { unregister() }
  })

  // Conversation session header actions.
  ctx.slots.inject('conversation.session.header.actions', () => {
    const unregisterFiles = ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'union-files-button',
      order: 10,
      label: () => tt('header.files'),
    }, ((props: { sessionId: string }) => FilesHeaderAction({ sessionId: props.sessionId })) as never)
    return () => { unregisterFiles() }
  })

  // Mount the overlay dialog (create/edit union / members view) via DOM
  // injection — shows when unionStore.open is true or mode is 'members'.
  ctx.effect(() => {
    const el = document.createElement('div')
    el.id = 'union-workspace-overlay'
    document.body.appendChild(el)
    const root = createRoot(el)
    root.render(h(Overlay))
    return () => {
      root.unmount()
      el.remove()
    }
  }, 'union-workspace: overlay')

  // Mount the RightFilePanel via DOM injection — fixed right side.
  ctx.effect(() => {
    const el = document.createElement('div')
    el.id = 'union-workspace-right-panel'
    document.body.appendChild(el)
    const root = createRoot(el)
    root.render(h(RightFilePanel))
    return () => {
      root.unmount()
      el.remove()
    }
  }, 'union-workspace: right file panel')

  // The /uw command (client contribution, popupSelect shell).
  const commandUi = ctx.get('commandUi') as { register: (c: unknown) => () => void } | undefined
  if (commandUi !== undefined) {
    ctx.effect(() => commandUi.register({
      name: 'uw',
      description: tt('cmd.description'),
      available: () => true,
      ui: {
        kind: 'popupSelect',
        options: async (session: unknown) => {
          const sessionId = (session as { sessionId?: string }).sessionId ?? ''
          let st: { union?: { id: string; title: string; members: string[] } | null } | null = null
          try { st = await runtime.api.status(sessionId) } catch { /* ignore */ }
          if (st?.union) {
            const u = st.union
            const memberList = u.members.map((m, i) => (i === 0 ? '(主) ' + m : m)).join('  ')
            return [
              { id: 'add-member', label: tt('cmd.addMember'), detail: tt('cmd.addMemberDetail') },
            ]
          }
          let path: string | null = null
          try {
            const r = await runtime.api.currentPath(sessionId)
            if (r?.path) path = r.path
          } catch { /* ignore */ }
          return [{
            id: 'quick-upgrade',
            label: tt('cmd.upgrade'),
            detail: path ? tt('cmd.upgradeDetail', { path }) : tt('cmd.upgradeDetailEmpty'),
          }]
        },
        onSelect: async (option: { id: string }, session: unknown) => {
          const sessionId = (session as { sessionId?: string }).sessionId ?? ''
          if (option.id === 'add-member') {
            try {
              const r = await runtime.api.status(sessionId)
              if (r?.union) {
                const u = r.union as { id: string; title: string; members: string[]; preset: 'workspace-write' | 'danger-full-access' }
                unionStore.mode = 'quick'
                unionStore.primaryPath = u.members[0]
                unionStore.editUnion = u as never
                unionStore.pendingSessionId = sessionId
                unionStore.setOpen(true)
                return
              }
            } catch (error) { console.error('union-workspace: status failed', String(error)) }
          }
          try {
            const r = await runtime.api.currentPath(sessionId)
            if (r?.path) { unionStore.primaryPath = r.path; unionStore.mode = 'quick' }
          } catch (error) { console.error('union-workspace: failed to get current path', String(error)) }
          unionStore.pendingSessionId = sessionId
          unionStore.setOpen(true)
        },
      },
    }), 'union-workspace: /uw command')
  }
}