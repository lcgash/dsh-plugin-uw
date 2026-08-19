/**
 * Session-header surfaces: the chain-link icon button.
 * Renders inside the conversation session header action row via the
 * `conversation.session.header.actions` slot — every slot consumer is
 * registered per conversation session, so each props carries a `sessionId`.
 *
 * The ⛓ button shows a hover popover with the member directory list, and
 * clicking it toggles the right file panel.
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import type { Union } from '../../protocol.ts'
import { runtime } from '../runtime.ts'
import { unionStore, useUnionStore } from '../store.ts'
import css from '../styles/header.module.css'
import { tt } from '../translate.ts'

/** Props of every conversation session header slot entry. */
export interface SessionHeaderProps {
  sessionId: string
}

/** The chain button: toggle the right file panel for a union session.
 * On hover, shows a popover with the member directory list. */
export function FilesHeaderAction(props: SessionHeaderProps): ReturnType<typeof h> | null {
  useUnionStore()
  const [union, setUnion] = useState<Union | null>(null)
  const [showPopover, setShowPopover] = useState(false)
  const { sessionId } = props
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    let alive = true
    runtime.api.status(sessionId).then((r) => {
      if (alive) setUnion(r?.union ?? null)
    }).catch(() => { if (alive) setUnion(null) })
    return () => { alive = false }
  }, [sessionId])

  const handleMouseEnter = (): void => {
    clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setShowPopover(true), 300)
  }

  const handleMouseLeave = (): void => {
    clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setShowPopover(false), 200)
  }

  if (!union) return null

  return h('div', {
    style: {
      position: 'relative',
      display: 'inline-flex',
    },
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
  },
    h('button', {
      type: 'button',
      className: css.button,
      'aria-label': tt('header.files'),
      title: tt('header.files'),
      onClick: (ev: { stopPropagation: () => void }) => {
        ev.stopPropagation()
        setShowPopover(false)
        if (unionStore.panelVisible) unionStore.closeFiles()
        else unionStore.setFiles(sessionId)
      },
    }, '⛓'),
    // Hover popover
    showPopover ? h('div', {
      ref: popoverRef,
      style: {
        position: 'absolute',
        top: '100%',
        left: 0,
        marginTop: '4px',
        background: 'var(--dsw-alias-bg-layer-3, #fff)',
        border: '1px solid var(--dsw-alias-border-l2, #e0e0e0)',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        padding: '8px 0',
        minWidth: '200px',
        maxWidth: '400px',
        zIndex: 900,
        fontSize: '12px',
        color: 'var(--dsw-alias-label-primary, #333)',
      },
    },
      // Title
      h('div', {
        style: {
          padding: '4px 12px 6px',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--dsw-alias-label-primary, #333)',
          borderBottom: '1px solid var(--dsw-alias-border-l1, #eee)',
          marginBottom: '4px',
        },
      }, `⛓ ${union.title} (${union.members.length})`),
      // Member list
      ...union.members.map((m, i) =>
        h('div', {
          key: m,
          title: m,
          style: {
            padding: '4px 12px',
            fontSize: '11px',
            color: 'var(--dsw-alias-label-secondary, #666)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        }, (i === 0 ? '● ' : '  ') + m),
      ),
      // Hint
      h('div', {
        style: {
          padding: '6px 12px 2px',
          fontSize: '10px',
          color: 'var(--dsw-alias-label-tertiary, #999)',
          borderTop: '1px solid var(--dsw-alias-border-l1, #eee)',
          marginTop: '4px',
        },
      }, '点击切换文件浏览面板'),
    ) : null,
  )
}