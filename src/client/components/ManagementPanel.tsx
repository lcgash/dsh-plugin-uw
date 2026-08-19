/**
 * Management view for the union workspace, shown in the settings panel.
 * Allows creating new workspaces and managing existing ones (add/remove members,
 * change title, adjust permission preset).
 */
import { createElement as h, useEffect, useState } from 'react'
import type { Union } from '../../protocol.ts'
import { openMarkedUnion, runtime } from '../runtime.ts'
import { findMatchingUnion, memberError, useUnionStore } from '../store.ts'
import { tt } from '../translate.ts'
import css from '../styles/common.module.css'

export interface ManagementPanelProps {
  /** Close the settings panel (provided by the settings section owner). */
  close?: () => void
}

/** Form state for creating/editing a union. */
interface UnionFormState {
  title: string
  members: string[]
  preset: 'workspace-write' | 'danger-full-access'
  manualPath: string
  busy: boolean
  notice: string
  noticeErr: boolean
}

const emptyForm = (): UnionFormState => ({
  title: '',
  members: [],
  preset: 'workspace-write',
  manualPath: '',
  busy: false,
  notice: '',
  noticeErr: false,
})

function baseName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? 'workspace'
}

/** Expandable editor for one union. */
function UnionEditor(props: { union: Union; onUpdate: (u: Union) => void; onDelete: () => void }): ReturnType<typeof h> {
  const u = props.union
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState(u.title)
  const [preset, setPreset] = useState(u.preset)
  const [members, setMembers] = useState(u.members.slice())
  const [manualPath, setManualPath] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeErr, setNoticeErr] = useState(false)
  const [busy, setBusy] = useState(false)

  const api = runtime.api

  const save = async (): Promise<void> => {
    if (members.length < 2) { setNotice(tt('settings.needTwo')); setNoticeErr(true); return }
    setBusy(true); setNotice(''); setNoticeErr(false)
    try {
      const current = await api.list()
      const list: Union[] = (current?.unions ?? []).slice()
      const idx = list.findIndex((x) => x.id === u.id)
      if (idx >= 0) {
        list[idx] = { ...list[idx], title: title.trim() || u.title, members: members.slice(), preset }
      }
      await api.sync({ unions: list })
      props.onUpdate({ ...u, title: title.trim() || u.title, members: members.slice(), preset })
      setNotice(tt('settings.saved', { count: String(list.length) }))
      setNoticeErr(false)
    } catch (err) {
      setNotice(tt('settings.saveFailed', { error: String(err) }))
      setNoticeErr(true)
    }
    setBusy(false)
  }

  const addMemberFromPicker = async (): Promise<void> => {
    if (runtime.workspaces === undefined) { setNotice(tt('settings.pickerFailed', { error: 'no workspaces service' })); setNoticeErr(true); return }
    try {
      const p = await runtime.workspaces.pickDirectory()
      if (!p) return
      const err = memberError(members, p)
      if (err) { setNotice(tt(err.key, err.values)); setNoticeErr(true); return }
      const next = [...members, p]
      setMembers(next)
      setNotice(''); setNoticeErr(false)
      const seg = baseName(p)
      if (seg && !title.includes(seg)) setTitle((t) => t || '') // auto-name not needed for existing
    } catch (err) {
      setNotice(tt('settings.pickerFailed', { error: String(err) })); setNoticeErr(true)
    }
  }

  const addMemberManual = (): void => {
    const p = manualPath.trim()
    if (!p) return
    const err = memberError(members, p)
    if (err) { setNotice(tt(err.key, err.values)); setNoticeErr(true); return }
    setMembers([...members, p])
    setManualPath('')
    setNotice(''); setNoticeErr(false)
  }

  const removeMember = (i: number): void => {
    if (members.length <= 2) { setNotice(tt('settings.minTwo')); setNoticeErr(true); return }
    setMembers(members.filter((_, k) => k !== i))
  }

  const setPrimary = (i: number): void => {
    if (i === 0) return
    const next = [...members]
    const [x] = next.splice(i, 1)
    setMembers([x, ...next])
  }

  return h('div', { style: { border: '1px solid var(--dsw-alias-border-l2, #e0e0e0)', borderRadius: '12px', overflow: 'hidden' } },
    // Header / summary row
    h('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', cursor: 'pointer', background: 'var(--dsw-alias-bg-layer-3, #f5f5f5)' },
      onClick: () => setExpanded(!expanded),
    },
      h('div', {},
        h('div', { style: { fontWeight: 600, fontSize: '15px', color: 'var(--dsw-alias-label-primary)' } }, u.title),
        h('div', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', marginTop: '2px' } },
          u.members[0] + (u.members.length > 1 ? ' + ' + (u.members.length - 1) + ' ' + tt('settings.list.members') : '')),
      ),
      h('span', {
          style: {
            fontSize: '22px',
            color: 'var(--dsw-alias-label-secondary, #888)',
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.25s ease',
            lineHeight: '1',
            padding: '2px 4px',
            userSelect: 'none',
          },
        }, '▾'),
    ),
    // Expanded editor
    expanded ? h('div', { style: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' } },
      h('div', { className: css.field },
        h('label', { className: css.fieldLabel }, tt('overlay.name')),
        h('input', { className: css.input, value: title, placeholder: u.title, onChange: (ev: { target: { value: string } }) => setTitle(ev.target.value) }),
      ),
      h('div', { className: css.field },
        h('label', { className: css.fieldLabel }, tt('overlay.members')),
        // Current members
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          members.map((m, i) => h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', background: 'var(--dsw-alias-bg-layer-2, #f0f0f0)', borderRadius: '6px', fontSize: '12px' } },
            i === 0 ? h('span', { className: css.badgeOk }, tt('settings.list.primary')) : null,
            h('span', { style: { flex: 1, fontFamily: 'var(--dsw-font-mono, monospace)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m),
            i !== 0 ? h('button', { type: 'button', className: css.btn, style: { padding: '2px 6px', fontSize: '11px' }, onClick: () => setPrimary(i) }, tt('settings.list.setPrimary')) : null,
            i !== 0 ? h('button', { type: 'button', className: css.btnDanger, style: { padding: '2px 6px', fontSize: '11px' }, onClick: () => removeMember(i) }, tt('settings.list.remove')) : null,
          )),
        ),
        // Add member controls
        h('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } },
          h('button', { type: 'button', className: css.btn, style: { fontSize: '12px', padding: '4px 10px' }, onClick: () => void addMemberFromPicker() }, tt('settings.form.pick')),
          h('input', {
            className: css.input,
            style: { flex: 1, fontSize: '12px', padding: '6px 10px' },
            value: manualPath,
            placeholder: tt('settings.form.manualPlaceholder'),
            onChange: (ev: { target: { value: string } }) => setManualPath(ev.target.value),
            onKeyDown: (ev: { key: string; preventDefault: () => void }) => { if (ev.key === 'Enter') { ev.preventDefault(); addMemberManual() } },
          }),
          h('button', { type: 'button', className: css.btn, style: { fontSize: '12px', padding: '4px 10px' }, onClick: addMemberManual }, tt('settings.form.add')),
        ),
      ),
      h('div', { className: css.field },
        h('label', { className: css.fieldLabel }, tt('overlay.preset')),
        h('select', {
          className: css.select, value: preset,
          onChange: (ev: { target: { value: string } }) => setPreset(ev.target.value as 'workspace-write' | 'danger-full-access'),
        },
        h('option', { value: 'workspace-write' }, tt('settings.form.preset.write')),
        h('option', { value: 'danger-full-access' }, tt('settings.form.preset.full'))),
      ),
      // Actions
      h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
        h('button', { type: 'button', className: css.btnDanger, disabled: busy, onClick: () => props.onDelete() }, tt('settings.list.delete')),
        h('button', { type: 'button', className: css.btnPrimary, disabled: busy, onClick: () => void save() }, busy ? tt('overlay.busy') : '保存'),
      ),
      notice ? h('div', { className: noticeErr ? css.noticeErr : css.notice }, notice) : null,
    ) : null,
  )
}

export function ManagementPanel(props: ManagementPanelProps): ReturnType<typeof h> | null {
  useUnionStore()
  const api = runtime.api
  const [unions, setUnions] = useState<Union[]>([])
  const [loaded, setLoaded] = useState(false)

  // Create form state
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<UnionFormState>(emptyForm())
  const patchForm = (p: Partial<UnionFormState>): void => setForm((f) => ({ ...f, ...p }))

  // Load unions
  const load = () => {
    api.list().then((r) => {
      if (Array.isArray(r.unions)) setUnions(r.unions)
    }).catch(() => {}).finally(() => setLoaded(true))
  }
  useEffect(() => { load() }, [api])

  // Refresh union list when the workspace list changes (e.g. a workspace was
  // deleted from the sidebar). The list route also prunes orphaned unions, so
  // this keeps the settings page in sync.
  useEffect(() => {
    const ws = runtime.workspaces
    if (ws === undefined) return
    const unsub = ws.list.subscribe(() => { load() })
    return () => { unsub() }
  }, [api])

  // Create new union
  const createUnion = async (): Promise<void> => {
    if (form.members.length < 2) { patchForm({ notice: tt('overlay.minTwo'), noticeErr: true }); return }
    patchForm({ busy: true, notice: '', noticeErr: false })
    try {
      const current = await api.list()
      const list: Union[] = current?.unions ?? []
      const existing = findMatchingUnion(list, form.members)
      if (existing) {
        // Matching union found: open it instead of creating a duplicate.
        setShowCreate(false)
        setForm(emptyForm())
        patchForm({ notice: '', noticeErr: false, busy: false })
        openMarkedUnion(existing.id)
        return
      }
      const autoName = form.title.trim() || form.members.map(baseName).join('+')
      const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      const next: Union[] = [...list, { id, title: autoName, members: form.members.slice(), preset: form.preset }]
      await api.sync({ unions: next })
      // Also create the workspace so it appears in the sidebar immediately.
      try { await api.ensurePrimary(id) } catch { /* workspace may already exist */ }
      setUnions(next)
      setShowCreate(false)
      setForm(emptyForm())
      patchForm({ notice: tt('settings.createDone', { title: autoName }), noticeErr: false })
    } catch (err) {
      patchForm({ notice: tt('overlay.createFailed', { error: String(err) }), noticeErr: true, busy: false })
    }
    patchForm({ busy: false })
  }

  const addMemberFromPicker = async (): Promise<void> => {
    if (runtime.workspaces === undefined) { patchForm({ notice: tt('settings.pickerFailed', { error: 'no workspaces service' }), noticeErr: true }); return }
    try {
      const p = await runtime.workspaces.pickDirectory()
      if (!p) return
      const err = memberError(form.members, p)
      if (err) { patchForm({ notice: tt(err.key, err.values), noticeErr: true }); return }
      patchForm({ members: [...form.members, p], notice: '', noticeErr: false })
      const seg = baseName(p)
      if (seg && !form.title.includes(seg)) patchForm({ title: (form.title || '') + '+' + seg })
    } catch (err) {
      patchForm({ notice: tt('settings.pickerFailed', { error: String(err) }), noticeErr: true })
    }
  }

  const addMemberManual = (): void => {
    const p = form.manualPath.trim()
    if (!p) return
    const err = memberError(form.members, p)
    if (err) { patchForm({ notice: tt(err.key, err.values), noticeErr: true }); return }
    patchForm({ members: [...form.members, p], manualPath: '', notice: '', noticeErr: false })
    const seg = baseName(p)
    if (seg && !form.title.includes(seg)) patchForm({ title: (form.title || '') + '+' + seg })
  }

  const removeMember = (i: number): void => {
    if (form.members.length <= 2) { patchForm({ notice: tt('settings.minTwo'), noticeErr: true }); return }
    patchForm({ members: form.members.filter((_, k) => k !== i) })
  }

  const setPrimaryMember = (i: number): void => {
    if (i === 0) return
    const next = [...form.members]
    const [x] = next.splice(i, 1)
    patchForm({ members: [x, ...next] })
  }

  // Delete a union
  const deleteUnion = async (u: Union): Promise<void> => {
    try {
      const next = unions.filter((x) => x.id !== u.id)
      await api.sync({ unions: next })
      setUnions(next)
    } catch { /* ignore */ }
  }

  // Update a union (from editor save)
  const updateUnion = (updated: Union): void => {
    setUnions(unions.map((u) => u.id === updated.id ? updated : u))
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' } },
    // Content
    h('div', { style: { padding: '16px 20px', flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' } },
      // Create button
      !showCreate ? h('button', {
        type: 'button', className: css.btnPrimary,
        style: { width: '100%', padding: '10px' },
        onClick: () => { setShowCreate(true); setForm(emptyForm()) },
      }, '+ ' + tt('settings.form.title')) : null,

      // Create form
      showCreate ? h('div', { style: { border: '1px solid var(--dsw-alias-border-l2, #e0e0e0)', borderRadius: '12px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--dsw-alias-bg-layer-3, #f5f5f5)' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('span', { style: { fontWeight: 600, fontSize: '15px', color: 'var(--dsw-alias-label-primary)' } }, tt('settings.form.title')),
          h('button', { type: 'button', className: css.iconBtn, onClick: () => { setShowCreate(false); setForm(emptyForm()) } }, '✕'),
        ),
        h('div', { className: css.field },
          h('label', { className: css.fieldLabel }, tt('overlay.name')),
          h('input', { className: css.input, value: form.title, placeholder: tt('overlay.namePlaceholder'), onChange: (ev: { target: { value: string } }) => patchForm({ title: ev.target.value }) }),
        ),
        h('div', { className: css.field },
          h('label', { className: css.fieldLabel }, tt('overlay.members')),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            form.members.map((m, i) => h('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px', background: 'var(--dsw-alias-bg-layer-2, #f0f0f0)', borderRadius: '6px', fontSize: '12px' } },
              i === 0 ? h('span', { className: css.badgeOk }, tt('settings.list.primary')) : null,
              h('span', { style: { flex: 1, fontFamily: 'var(--dsw-font-mono, monospace)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m),
              i !== 0 ? h('button', { type: 'button', className: css.btn, style: { padding: '2px 6px', fontSize: '11px' }, onClick: () => setPrimaryMember(i) }, tt('settings.list.setPrimary')) : null,
              i !== 0 ? h('button', { type: 'button', className: css.btnDanger, style: { padding: '2px 6px', fontSize: '11px' }, onClick: () => removeMember(i) }, tt('settings.list.remove')) : null,
            )),
          ),
          h('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } },
            h('button', { type: 'button', className: css.btn, style: { fontSize: '12px', padding: '4px 10px' }, onClick: () => void addMemberFromPicker() }, tt('settings.form.pick')),
            h('input', {
              className: css.input,
              style: { flex: 1, fontSize: '12px', padding: '6px 10px' },
              value: form.manualPath,
              placeholder: tt('settings.form.manualPlaceholder'),
              onChange: (ev: { target: { value: string } }) => patchForm({ manualPath: ev.target.value }),
              onKeyDown: (ev: { key: string; preventDefault: () => void }) => { if (ev.key === 'Enter') { ev.preventDefault(); addMemberManual() } },
            }),
            h('button', { type: 'button', className: css.btn, style: { fontSize: '12px', padding: '4px 10px' }, onClick: addMemberManual }, tt('settings.form.add')),
          ),
        ),
        h('div', { className: css.field },
          h('label', { className: css.fieldLabel }, tt('overlay.preset')),
          h('select', {
            className: css.select, value: form.preset,
            onChange: (ev: { target: { value: string } }) => patchForm({ preset: ev.target.value as 'workspace-write' | 'danger-full-access' }),
          },
          h('option', { value: 'workspace-write' }, tt('settings.form.preset.write')),
          h('option', { value: 'danger-full-access' }, tt('settings.form.preset.full'))),
        ),
        h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: css.btn, disabled: form.busy, onClick: () => { setShowCreate(false); setForm(emptyForm()) } }, tt('overlay.cancel')),
          h('button', { type: 'button', className: css.btnPrimary, disabled: form.busy, onClick: () => void createUnion() }, form.busy ? tt('overlay.busy') : tt('overlay.create')),
        ),
        form.notice ? h('div', { className: form.noticeErr ? css.noticeErr : css.notice }, form.notice) : null,
      ) : null,

      // Existing unions
      !loaded ? h('p', { style: { color: 'var(--dsw-alias-label-tertiary, #999)', fontSize: '13px', textAlign: 'center' } }, tt('settings.list.loading')) : null,
      unions.length === 0 && loaded ? h('p', { style: { color: 'var(--dsw-alias-label-tertiary, #999)', fontSize: '13px', textAlign: 'center', padding: '40px 0' } }, tt('settings.list.empty')) : null,
      unions.length > 0 ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        unions.map((u) => h(UnionEditor, { key: u.id, union: u, onUpdate: updateUnion, onDelete: () => void deleteUnion(u) })),
      ) : null,
    ),
  )
}