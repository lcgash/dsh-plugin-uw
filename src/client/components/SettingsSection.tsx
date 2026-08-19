/**
 * Settings-section card: the union-workspace management page (create,
 * rename, open, delete, member add/remove/reorder, preset switch). Renders
 * inside the dsh settings panel via the `settings.section` slot.
 */
import {createElement as h, useEffect, useState} from 'react'
import type {Union} from '../../protocol.ts'
import {openMarkedUnion, runtime} from '../runtime.ts'
import {memberError, useUnionStore} from '../store.ts'
import css from '../styles/common.module.css'
import {tt} from '../translate.ts'

/** Props the settings section binds (no injected face needed). */
export interface SettingsSectionProps {
    /** Marker: the section supplies no owner props. */
    children?: never
}

/** One union row's open busy state (id). */
type BusyKey = string

export function SettingsSection(_props: SettingsSectionProps): ReturnType<typeof h> {
    useUnionStore()
    const api = runtime.api

    const [unions, setUnions] = useState<Union[]>([])
    const [loaded, setLoaded] = useState(false)
    const [title, setTitle] = useState('')
    const [members, setMembers] = useState<string[]>([])
    const [preset, setPreset] = useState<'workspace-write' | 'danger-full-access'>('workspace-write')
    const [manualPath, setManualPath] = useState('')
    const [notice, setNotice] = useState('')
    const [noticeErr, setNoticeErr] = useState(false)
    const [busyId, setBusyId] = useState<BusyKey>('')

    useEffect(() => {
        let alive = true
        api.list().then((r) => {
            if (alive && Array.isArray(r.unions)) setUnions(r.unions)
        }).catch(() => {
        }).finally(() => {
            if (alive) setLoaded(true)
        })
        return () => {
            alive = false
        }
    }, [api])

    const persist = async (next: Union[]): Promise<void> => {
        setUnions(next)
        try {
            const r = await api.sync({unions: next})
            if (r?.notice) {
                setNotice(r.notice);
                setNoticeErr(false)
            }
        } catch (err) {
            setNotice(tt('settings.saveFailed', {error: String(err)}));
            setNoticeErr(true)
        }
    }

    const addPicked = async (): Promise<void> => {
        if (runtime.workspaces === undefined) {
            setNotice(tt('settings.pickerFailed', {error: 'no workspaces service'}));
            setNoticeErr(true);
            return
        }
        try {
            const p = await runtime.workspaces.pickDirectory()
            if (!p) return
            const err = memberError(members, p)
            if (err) {
                setNotice(tt(err.key, err.values));
                setNoticeErr(true);
                return
            }
            setMembers([...members, p])
        } catch (err) {
            setNotice(tt('settings.pickerFailed', {error: String(err)}));
            setNoticeErr(true)
        }
    }

    const addManual = (): void => {
        const p = manualPath.trim()
        if (!p) return
        const err = memberError(members, p)
        if (err) {
            setNotice(tt(err.key, err.values));
            setNoticeErr(true);
            return
        }
        setMembers([...members, p])
        setManualPath('')
    }

    const createUnion = async (): Promise<void> => {
        if (!title.trim()) {
            setNotice(tt('settings.needTitle'));
            setNoticeErr(true);
            return
        }
        if (members.length < 2) {
            setNotice(tt('settings.needTwo'));
            setNoticeErr(true);
            return
        }
        const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
        const u: Union = {id, title: title.trim(), members: members.slice(), preset}
        await persist([...unions, u])
        // Also create the workspace so it appears in the sidebar immediately.
        try { await api.ensurePrimary(id) } catch { /* workspace may already exist */ }
        setTitle('');
        setMembers([]);
        setPreset('workspace-write')
        setNotice(tt('settings.createDone', {title: title.trim()}));
        setNoticeErr(false)
    }

    const openUnion = async (u: Union): Promise<void> => {
        setBusyId(u.id);
        setNotice('')
        try {
            const ok = await openMarkedUnion(u.id)
            if (!ok) setNotice(tt('settings.openFailed', {error: 'ensure-primary failed'}));
            setNoticeErr(true)
        } catch (err) {
            setNotice(tt('settings.openFailed', {error: String(err)}));
            setNoticeErr(true)
        } finally {
            setBusyId('')
        }
    }

    const removeUnion = async (u: Union): Promise<void> => {
        await persist(unions.filter((x) => x.id !== u.id))
    }
    const renameUnion = async (u: Union, v: string): Promise<void> => {
        const n = v.trim()
        if (!n) return
        await persist(unions.map((x) => (x.id === u.id ? {...x, title: n} : x)))
    }
    const setUnionPreset = async (u: Union, v: 'workspace-write' | 'danger-full-access'): Promise<void> => {
        await persist(unions.map((x) => (x.id === u.id ? {...x, preset: v} : x)))
    }

    const addUnionMember = async (u: Union): Promise<void> => {
        if (runtime.workspaces === undefined) {
            setNotice(tt('settings.pickerFailed', {error: 'no workspaces service'}));
            setNoticeErr(true);
            return
        }
        try {
            const p = await runtime.workspaces.pickDirectory()
            if (!p) return
            const err = memberError(u.members, p)
            if (err) {
                setNotice(tt(err.key, err.values));
                setNoticeErr(true);
                return
            }
            await persist(unions.map((x) => (x.id === u.id ? {...x, members: [...x.members, p]} : x)))
        } catch (err) {
            setNotice(tt('settings.pickerFailed', {error: String(err)}));
            setNoticeErr(true)
        }
    }

    const removeUnionMember = async (u: Union, i: number): Promise<void> => {
        const next = u.members.filter((_, k) => k !== i)
        if (next.length < 2) {
            setNotice(tt('settings.minTwo'));
            setNoticeErr(true);
            return
        }
        await persist(unions.map((x) => (x.id === u.id ? {...x, members: next} : x)))
    }

    const setUnionPrimary = async (u: Union, i: number): Promise<void> => {
        const next = [...u.members]
        const [m] = next.splice(i, 1)
        await persist(unions.map((x) => (x.id === u.id ? {...x, members: [m, ...next]} : x)))
    }

    return h('div', {className: css.page},
        h('h2', {className: css.title}, tt('settings.title')),
        h('p', {className: css.intro}, tt('settings.intro')),
        notice ? h('div', {className: noticeErr ? css.noticeErr : css.notice}, notice) : null,

        // ---- create form ----
        h('div', {className: css.card},
            h('div', {className: css.cardName}, tt('settings.form.title')),
            h('div', {className: css.desc}, tt('settings.form.desc')),
            h('div', {className: css.field},
                h('label', {className: css.fieldLabel}, tt('settings.form.name')),
                h('input', {
                    className: css.input, value: title, placeholder: tt('settings.form.namePlaceholder'),
                    onChange: (ev: { target: { value: string } }) => setTitle(ev.target.value),
                }),
            ),
            h('div', {className: css.field},
                h('label', {className: css.fieldLabel}, tt('settings.form.members')),
                h('div', {className: css.row},
                    h('button', {
                        type: 'button',
                        className: css.btn,
                        onClick: () => void addPicked()
                    }, tt('settings.form.pick')),
                    h('input', {
                        className: css.input, value: manualPath, placeholder: tt('settings.form.manualPlaceholder'),
                        onChange: (ev: { target: { value: string } }) => setManualPath(ev.target.value),
                        onKeyDown: (ev: { key: string; preventDefault: () => void }) => {
                            if (ev.key === 'Enter') {
                                ev.preventDefault();
                                addManual()
                            }
                        },
                    }),
                    h('button', {type: 'button', className: css.btn, onClick: addManual}, tt('settings.form.add')),
                ),
                members.length < 2
                    ? h('div', {className: css.muted}, tt('settings.needTwo'))
                    : h('div', {className: css.row}, members.map((m, i) => h('span', {key: i, className: css.path},
                        m + (i === 0 ? ` (${tt('settings.list.primary')})` : ''),
                        h('button', {
                            key: 'rm' + i,
                            className: css.btn,
                            onClick: () => setMembers(members.filter((_, k) => k !== i))
                        }, tt('settings.list.remove')))),
                    ),
                h('div', {className: css.row},
                    h('div', {className: css.field},
                        h('label', {className: css.fieldLabel}, tt('settings.form.preset')),
                        h('select', {
                                className: css.select, value: preset,
                                onChange: (ev: {
                                    target: { value: string }
                                }) => setPreset(ev.target.value as 'workspace-write' | 'danger-full-access'),
                            },
                            h('option', {value: 'workspace-write'}, tt('settings.form.preset.write')),
                            h('option', {value: 'danger-full-access'}, tt('settings.form.preset.full'))),
                    ),
                    h('button', {
                        type: 'button',
                        className: css.btnPrimary,
                        onClick: () => void createUnion()
                    }, tt('settings.form.create')),
                ),
            ),

            // ---- existing union list ----
            h('div', {},
                h('div', {className: css.cardName}, tt('settings.list.title', {count: String(unions.length)})),
                !loaded ? h('div', {className: css.muted}, tt('settings.list.loading')) : null,
                unions.length === 0 && loaded ? h('div', {className: css.muted}, tt('settings.list.empty')) : null,
                unions.map((u) => h('div', {key: u.id, className: css.card},
                    h('div', {className: css.row},
                        h('input', {
                            className: css.input, value: u.title,
                            onChange: (ev: { target: { value: string } }) => void renameUnion(u, ev.target.value),
                        }),
                        h('button', {
                            type: 'button', className: css.btn, disabled: busyId === u.id,
                            onClick: () => void openUnion(u),
                        }, busyId === u.id ? tt('settings.list.opening') : tt('settings.list.open')),
                        h('button', {
                            type: 'button',
                            className: css.btnDanger,
                            onClick: () => void removeUnion(u)
                        }, tt('settings.list.delete')),
                    ),
                    h('div', {className: css.row},
                        h('span', {className: css.badge}, tt('settings.list.dirCount', {count: String(u.members.length)})),
                        h('span', {className: u.preset === 'danger-full-access' ? css.badge : css.badgeOk}, u.preset),
                        h('label', {className: css.fieldLabel}, tt('settings.list.preset')),
                        h('select', {
                                className: css.select, value: u.preset,
                                onChange: (ev: {
                                    target: { value: string }
                                }) => void setUnionPreset(u, ev.target.value as 'workspace-write' | 'danger-full-access'),
                            },
                            h('option', {value: 'workspace-write'}, 'workspace-write'),
                            h('option', {value: 'danger-full-access'}, 'danger-full-access')),
                        h('button', {
                            type: 'button',
                            className: css.btn,
                            onClick: () => void addUnionMember(u)
                        }, tt('settings.list.addMember')),
                    ),
                    h('div', {className: css.row},
                        h('span', {className: css.path}, '⛓ ' + u.members[0] + ` (${tt('settings.list.primary')})`),
                    ),
                    h('div', {className: css.row},
                        u.members.slice(1).map((m, i) => h('span', {key: 'member' + i, className: css.row},
                            h('span', {className: css.path}, m),
                            h('button', {
                                type: 'button',
                                className: css.btn,
                                onClick: () => void setUnionPrimary(u, i + 1)
                            }, tt('settings.list.setPrimary')),
                            h('button', {
                                type: 'button',
                                className: css.btnDanger,
                                onClick: () => void removeUnionMember(u, i + 1)
                            }, tt('settings.list.remove')),
                        )),
                    ),
                )),
            ),
        ))
}
