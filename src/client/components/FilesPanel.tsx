/**
 * The right-hand file listing panel: one tree per union member directory,
 * lazily loaded through /api/dsh-union-workspace/list-files. Toggled by the
 * session-header 📁 button or the /uw "browse files" option. Rendered into
 * the shell.overlay slot (fixed to the right edge, above the conversation).
 */
import { createElement as h, useCallback, useEffect, useState } from 'react'
import type { FileEntry, Union } from '../../protocol.ts'
import { runtime } from '../runtime.ts'
import { formatSize, normPath, unionStore, useUnionStore } from '../store.ts'
import css from '../styles/files-panel.module.css'
import common from '../styles/common.module.css'
import { tt } from '../translate.ts'

/** Props the overlay slot binds. */
export interface FilesPanelProps {
  children?: never
}

export function FilesPanel(_props: FilesPanelProps): ReturnType<typeof h> | null {
  useUnionStore()
  const [union, setUnion] = useState<Union | null>(null)
  const [dirs, setDirs] = useState<Record<string, FileEntry[]>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [error, setError] = useState('')
  const sid = unionStore.filesSessionId

  useEffect(() => {
    if (!sid) {
      setUnion(null); setDirs({}); setExpanded({}); setError('')
      return
    }
    let alive = true
    runtime.api.status(sid).then((r) => {
      if (!alive) return
      if (r?.union) { setUnion(r.union); setDirs({}); setExpanded({}); setError('') }
      else setError(tt('files.notUnion'))
    }).catch(() => { if (alive) setError(tt('files.fetchFailed')) })
    return () => { alive = false }
  }, [sid])

  const loadDir = useCallback(async (p: string): Promise<void> => {
    if (!union) return
    setLoading((l) => ({ ...l, [p]: true }))
    try {
      const r = await runtime.api.listFiles({ unionId: union.id, dir: p })
      if (r?.ok && r.entries) setDirs((d) => ({ ...d, [p]: r.entries! }))
      else if (r?.error) setError(String(r.error))
    } catch (err) {
      setError(String(err))
    }
    setLoading((l) => ({ ...l, [p]: false }))
  }, [union])

  useEffect(() => {
    if (sid && union) {
      for (const m of union.members) void loadDir(m)
    }
  }, [sid, union, loadDir])

  if (!sid) {
    return h('div', { className: css.muted, style: { padding: '16px', textAlign: 'center', color: 'var(--text-tertiary, #999)' } },
      tt('files.noSession'),
    )
  }
  const close = (): void => unionStore.closeFiles()

  const renderEntries = (path: string, entries: FileEntry[], depth: number): ReturnType<typeof h> | null => {
    if (!entries) return null
    const nodes: ReturnType<typeof h>[] = []
    for (const en of entries) {
      const full = normPath(path) + '/' + en.name
      if (en.type === 'directory') {
        const exp = Boolean(expanded[full])
        nodes.push(h('div', {
          key: 'row-' + full,
          className: common.treeHead,
          style: { paddingLeft: depth * 12 + 4 },
          onClick: () => {
            const nextExp = !exp
            setExpanded({ ...expanded, [full]: nextExp })
            if (nextExp && dirs[full] === undefined) void loadDir(full)
          },
        },
          h('span', { className: css.treeArrow }, loading[full] ? '…' : (exp ? '▼' : '▶')),
          h('span', { className: css.treeIcon }, '📂'),
          h('span', { className: css.fileName }, en.name),
        ))
        if (exp) {
          nodes.push(h('div', { key: 'kids-' + full, className: css.treeChildren },
            dirs[full] === undefined
              ? (loading[full]
                ? h('div', { className: common.muted, style: { paddingLeft: (depth + 1) * 12 + 20 } }, tt('files.loading'))
                : null)
              : renderEntries(full, dirs[full], depth + 1)))
        }
      } else {
        nodes.push(h('div', { key: 'row-' + full, className: common.fileRow, style: { paddingLeft: depth * 12 + 20, opacity: 0.75 } },
          h('span', { className: css.treeIcon }, '📄'),
          h('span', { className: css.fileName }, en.name),
          typeof en.size === 'number' ? h('span', { className: common.fileSize }, formatSize(en.size)) : null,
        ))
      }
    }
    return h('div', { key: 'tree-' + path }, nodes)
  }

  return h('div', { className: css.panel },
    h('div', { className: css.header },
      h('span', { className: css.title }, union ? tt('files.title', { title: union.title }) : tt('files.titleEmpty')),
      h('button', { type: 'button', className: common.iconBtn, onClick: close }, '✕'),
    ),
    error ? h('div', { className: common.noticeErr + ' ' + css.error }, error) : null,
    h('div', { className: css.body },
      !union
        ? h('div', { className: common.muted, style: { padding: 8 } }, tt('files.loading'))
        : union.members.map((m, i) => h('div', { key: m, className: css.memberBlock },
          h('div', { className: common.memberHead },
            h('span', { className: css.primaryDot }, i === 0 ? '⛓' : '📂'),
            h('span', { className: css.fileName }, m),
            i === 0 ? h('span', { className: common.badgeOk, style: { padding: '0 6px', lineHeight: '16px' } }, tt('files.version')) : null,
          ),
          h('div', { className: css.treeChildren },
            dirs[m] === undefined
              ? (loading[m]
                ? h('div', { className: common.muted + ' ' + css.loadingHint }, tt('files.loading'))
                : null)
              : renderEntries(m, dirs[m], 0)),
        )),
    ),
  )
}