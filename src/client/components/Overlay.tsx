/**
 * The union-workspace overlay dialog: three flavors driven by store.mode.
 *  - normal: new-workspace (union / plain radio) docked from the header ➕.
 *  - quick: upgrade an existing session to a union, pre-filled with the
 *    current path (/uw quick-upgrade) or the current union's members
 *    (/uw add-member, editUnion set).
 *  - members: read-only member listing (badge click).
 * Rendered into the `shell.overlay` slot so it floats above the shell.
 */
import { createElement as h, useEffect, useState } from 'react'
import type { Union } from '../../protocol.ts'
import { openMarkedUnion, runtime } from '../runtime.ts'
import { findMatchingUnion, memberError, unionStore, useUnionStore, type EditUnion } from '../store.ts'
import css from '../styles/common.module.css'
import { tt } from '../translate.ts'

/** Props the overlay slot binds. */
export interface OverlayProps {
  /** When true, render as a static panel (no dialog wrapper, always visible). */
  embedded?: boolean
  children?: never
}

interface CreateState {
  mode: 'union' | 'plain'
  name: string
  members: string[]
  preset: 'workspace-write' | 'danger-full-access'
  manualPath: string
  plainPath: string
  busy: boolean
  notice: string
  noticeErr: boolean
}

const initialCreate: CreateState = {
  mode: 'union',
  name: '',
  members: [],
  preset: 'workspace-write',
  manualPath: '',
  plainPath: '',
  busy: false,
  notice: '',
  noticeErr: false,
}

function baseName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? 'workspace'
}

export function Overlay(_props: OverlayProps): ReturnType<typeof h> | null {
  useUnionStore()
  const api = runtime.api
  const [create, setCreate] = useState<CreateState>(initialCreate)

  const patch = (part: Partial<CreateState>): void => setCreate((c) => ({ ...c, ...part }))

  // Pre-fill from /uw quick-upgrade when the overlay opens in quick mode.
  useEffect(() => {
    if (unionStore.open && unionStore.mode === 'quick' && unionStore.primaryPath) {
      const p = unionStore.primaryPath
      if (unionStore.editUnion) {
        const u = unionStore.editUnion
        const c = create
        if (c.members.length !== u.members.length || c.members[0] !== u.members[0]) {
          setCreate({ ...initialCreate, mode: 'union', name: u.title, members: u.members.slice() })
        }
      } else if (create.members.length === 0 || create.members[0] !== p) {
        setCreate({ ...initialCreate, mode: 'union', name: baseName(p), members: [p] })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unionStore.open])

  const memberView = unionStore.mode === 'members' ? unionStore.membersView : null

  if (!_props.embedded && !unionStore.open && unionStore.mode !== 'members') return null

  const close = (): void => {
    if (memberView) { unionStore.closeMembers(); return }
    unionStore.setOpen(false)
    setCreate(initialCreate)
    unionStore.mode = 'normal'
    unionStore.primaryPath = ''
    unionStore.editUnion = null
  }

  const addPicked = async (): Promise<void> => {
    if (runtime.workspaces === undefined) { patch({ notice: tt('overlay.pickFailed', { error: 'no workspaces service' }), noticeErr: true }); return }
    try {
      const p = await runtime.workspaces.pickDirectory()
      if (!p) return
      const err = memberError(create.members, p)
      if (err) { patch({ notice: tt(err.key, err.values), noticeErr: true }); return }
      const next = [...create.members, p]
      patch({ members: next, notice: '', noticeErr: false })
      const seg = baseName(p)
      if (seg && !create.name.includes(seg)) patch({ name: (create.name || '') + '+' + seg })
    } catch (err) {
      patch({ notice: tt('overlay.pickFailed', { error: String(err) }), noticeErr: true })
    }
  }

  const addManual = (): void => {
    const p = create.manualPath.trim()
    if (!p) return
    const err = memberError(create.members, p)
    if (err) { patch({ notice: tt(err.key, err.values), noticeErr: true }); return }
    const next = [...create.members, p]
    patch({ members: next, manualPath: '', notice: '', noticeErr: false })
    const seg = baseName(p)
    if (seg && !create.name.includes(seg)) patch({ name: (create.name || '') + '+' + seg })
  }

  const createUnion = async (): Promise<void> => {
    if (create.members.length < 2) { patch({ notice: tt('overlay.minTwo'), noticeErr: true }); return }
    patch({ busy: true, notice: '', noticeErr: false })
    try {
      const current = await api.list()
      let list: Union[] = current?.unions ?? []
      let targetId: string | undefined

      if (unionStore.editUnion) {
        const target = list.find((x) => x.id === unionStore.editUnion?.id)
        if (target) {
          const idx = list.indexOf(target)
          list = list.slice()
          list[idx] = {
            ...target,
            title: create.name.trim() || target.title,
            members: create.members.slice(),
          }
          const sync = await api.sync({ unions: list })
          if (sync?.notice) patch({ notice: sync.notice, noticeErr: false })
          targetId = target.id
        } else {
          // editUnion set but not found in list — create new
          const autoName = create.name.trim() || create.members.map(baseName).join('+')
          const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
          const usePreset = unionStore.mode === 'quick' ? 'workspace-write' : create.preset
          const next = [...list, { id, title: autoName, members: create.members.slice(), preset: usePreset }]
          const sync = await api.sync({ unions: next })
          if (sync?.notice) patch({ notice: sync.notice, noticeErr: false })
          targetId = id
        }
      } else {
        const existing = findMatchingUnion(list, create.members)
        if (existing) {
          // Matching union found: if this is an upgrade flow, just mark the
          // current session with the existing union and close.
          if (unionStore.pendingSessionId) {
            // Ensure the workspace exists and attach the session
            await api.ensurePrimary(existing.id, unionStore.pendingSessionId)
            await api.mark(existing.id, unionStore.pendingSessionId)
            unionStore.pendingSessionId = null
            unionStore.setOpen(false)
            window.location.reload()
            return
          }
          // For non-upgrade (settings creation), close the overlay first,
          // then open the existing union.
          unionStore.setOpen(false)
          await openMarkedUnion(existing.id)
          return
        } else {
          const autoName = create.name.trim() || create.members.map(baseName).join('+')
          const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
          const usePreset = unionStore.mode === 'quick' ? 'workspace-write' : create.preset
          const next = [...list, { id, title: autoName, members: create.members.slice(), preset: usePreset }]
          const sync = await api.sync({ unions: next })
          if (sync?.notice) patch({ notice: sync.notice, noticeErr: false })
          targetId = id
        }
      }

      // If we have a pending session, ensure the primary workspace and mark
      // the current session into the union, then reload so the sidebar reflects
      // the new workspace.
      if (targetId && unionStore.pendingSessionId) {
        await api.ensurePrimary(targetId, unionStore.pendingSessionId)
        await api.mark(targetId, unionStore.pendingSessionId)
        unionStore.pendingSessionId = null
        unionStore.setOpen(false)
        window.location.reload()
        return
      } else if (targetId) {
        await openMarkedUnion(targetId)
      }

      unionStore.setOpen(false)
    } catch (err) {
      patch({ notice: tt('overlay.createFailed', { error: String(err) }), noticeErr: true, busy: false })
    }
  }

  const createPlain = async (): Promise<void> => {
    if (!create.plainPath) { patch({ notice: tt('overlay.chooseFirst'), noticeErr: true }); return }
    if (runtime.workspaces === undefined) { patch({ notice: tt('overlay.createFailed', { error: 'no workspaces service' }), noticeErr: true }); return }
    patch({ busy: true, notice: '', noticeErr: false })
    try {
      await runtime.workspaces.create({ path: create.plainPath })
      patch({ notice: tt('overlay.plainCreated'), noticeErr: false })
      window.setTimeout(() => unionStore.setOpen(false), 600)
    } catch (err) {
      patch({ notice: tt('overlay.createFailed', { error: String(err) }), noticeErr: true, busy: false })
    }
  }

  // ---- members view ----
  if (memberView) {
    return h('div', { className: css.overlay, onClick: close },
      h('div', {
        className: css.dialog,
        style: { width: 'min(460px, 92vw)' },
        onClick: (ev: { stopPropagation: () => void }) => ev.stopPropagation(),
      },
        h('div', { className: css.dialogHeader },
          h('div', { className: css.dialogTitle }, tt('overlay.memberTitle', { title: memberView.title, count: String(memberView.members.length) })),
          h('button', { type: 'button', className: css.iconBtn, onClick: close }, '✕'),
        ),
        h('div', { className: css.desc },
          tt('overlay.permissionDesc', { preset: memberView.preset })
          + (memberView.preset === 'danger-full-access' ? tt('overlay.permissionDescFull')
            : tt('overlay.permissionDescWrite'))),
        h('div', { className: css.card, style: { gap: 8 } },
          memberView.members.map((m, i) => h('div', { key: i, className: css.row },
            i === 0 ? h('span', { className: css.badgeOk }, tt('settings.list.primary')) : null,
            h('span', { className: css.path, style: { flex: 1 } }, m)))),
        h('div', { className: css.row, style: { justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: css.btnPrimary, onClick: close }, tt('overlay.close'))),
      ))
  }

  // ---- create / upgrade form ----
  const memberChips = create.members.length < 2
    ? h('div', { className: css.muted }, tt('overlay.minTwo'))
    : h('div', { className: css.row },
      create.members.map((m, i) => h('div', { key: i, className: css.row, style: { flexWrap: 'nowrap' } },
        h('span', { className: css.path }, (i === 0 ? '⛓ ' : '') + m),
        i !== 0 ? h('button', {
          type: 'button', className: css.btn,
          onClick: () => {
            const next = [...create.members]
            const [x] = next.splice(i, 1)
            patch({ members: [x, ...next] })
          },
        }, tt('settings.list.setPrimary')) : null,
        i !== 0 ? h('button', { type: 'button', className: css.btnDanger, onClick: () => patch({ members: create.members.filter((_, k) => k !== i) }) }, tt('settings.list.remove')) : null)))

  const presetField = unionStore.mode !== 'quick' ? h('div', { className: css.row },
    h('div', { className: css.field, style: { flex: 1, minWidth: 160 } },
      h('label', { className: css.fieldLabel }, tt('overlay.preset')),
      h('select', {
        className: css.select, value: create.preset,
        onChange: (ev: { target: { value: string } }) => patch({ preset: ev.target.value as 'workspace-write' | 'danger-full-access' }),
      },
      h('option', { value: 'workspace-write' }, tt('settings.form.preset.write')),
      h('option', { value: 'danger-full-access' }, tt('settings.form.preset.full'))),
    ),
  ) : null

  const unionForm = h('div', { key: 'union-form', className: css.card, style: { gap: 12 } },
    // Show current workspace directory when upgrading
    unionStore.mode === 'quick' && unionStore.primaryPath ? h('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 10px',
        background: 'var(--dsw-alias-bg-layer-2, #f5f5f5)',
        borderRadius: '8px',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary, #666)',
      },
    },
      h('span', { style: { flex: 'none', fontWeight: 600 } }, '当前工作区:'),
      h('span', { style: { fontFamily: 'var(--dsw-font-mono, monospace)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, unionStore.primaryPath),
    ) : null,
    h('div', { className: css.field },
      h('label', { className: css.fieldLabel }, tt('overlay.name')),
      h('input', {
        className: css.input, value: create.name, placeholder: tt('overlay.namePlaceholder'),
        onChange: (ev: { target: { value: string } }) => patch({ name: ev.target.value }),
      })),
    h('div', { className: css.field },
      h('label', { className: css.fieldLabel }, tt('overlay.members')),
      h('div', { className: css.row },
        h('button', { type: 'button', className: css.btn, onClick: () => void addPicked() }, tt('settings.form.pick')),
        h('input', {
          className: css.input, value: create.manualPath, placeholder: tt('settings.form.manualPlaceholder'),
          onChange: (ev: { target: { value: string } }) => patch({ manualPath: ev.target.value }),
          onKeyDown: (ev: { key: string; preventDefault: () => void }) => { if (ev.key === 'Enter') { ev.preventDefault(); addManual() } },
        }),
        h('button', { type: 'button', className: css.btn, onClick: addManual }, tt('settings.form.add')),
      ),
      memberChips),
    presetField,
  )

  const plainForm = h('div', { key: 'plain-form', className: css.card },
    h('div', { className: css.field },
      h('label', { className: css.fieldLabel }, tt('overlay.plainDir')),
      h('div', { className: css.row },
        h('button', {
          type: 'button', className: css.btn,
          onClick: () => void (async () => {
            if (runtime.workspaces === undefined) return
            try {
              const p = await runtime.workspaces.pickDirectory()
              if (p) patch({ plainPath: p })
            } catch (err) { patch({ notice: tt('overlay.pickFailed', { error: String(err) }), noticeErr: true }) }
          })(),
        }, create.plainPath ? tt('overlay.plainRechoose') : tt('overlay.plainChoose')),
        create.plainPath ? h('span', { className: css.path }, create.plainPath) : h('span', { className: css.muted }, tt('overlay.plainNotChosen')))))

  const title = unionStore.mode === 'quick' ? tt('overlay.title.upgrade') : tt('overlay.title.new')
  const submitLabel = unionStore.mode === 'quick' ? tt('overlay.upgrade') : tt('overlay.create')

  return h('div', { className: css.overlay, onClick: close },
    h('div', { className: css.dialog, onClick: (ev: { stopPropagation: () => void }) => ev.stopPropagation() },
      h('div', { className: css.dialogHeader },
        h('div', { className: css.dialogTitle }, title),
        h('button', { type: 'button', className: css.iconBtn, onClick: close }, '✕'),
      ),
      unionStore.mode !== 'quick' ? h('div', { className: css.row },
        h('label', { className: css.check },
          h('input', { type: 'radio', name: 'uw-mode', checked: create.mode === 'union', onChange: () => patch({ mode: 'union' }) }),
          ' ' + tt('overlay.mode.union')),
        h('label', { className: css.check },
          h('input', { type: 'radio', name: 'uw-mode', checked: create.mode === 'plain', onChange: () => patch({ mode: 'plain' }) }),
          ' ' + tt('overlay.mode.plain')),
      ) : null,
      create.mode === 'union' || unionStore.mode === 'quick' ? unionForm : plainForm,
      create.notice ? h('div', { className: create.noticeErr ? css.noticeErr : css.notice }, create.notice) : null,
      h('div', { className: css.row, style: { justifyContent: 'flex-end' } },
        h('button', { type: 'button', className: css.btn, onClick: close, disabled: create.busy }, tt('overlay.cancel')),
        h('button', {
          type: 'button', className: css.btnPrimary, disabled: create.busy,
          onClick: create.mode === 'union' || unionStore.mode === 'quick' ? () => void createUnion() : () => void createPlain(),
        }, create.busy ? tt('overlay.busy') : submitLabel),
      ),
    ))
}