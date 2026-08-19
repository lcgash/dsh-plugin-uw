/**
 * Sidebar footer action that opens the union-workspaces management panel.
 * Follows the same pattern as dsh-task-board.
 */
import { createElement as h } from 'react'
import { useEffect, useState } from 'react'
import { unionStore } from '../store.ts'
import { tt } from '../translate.ts'

export interface SidebarActionProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

export function SidebarAction(_props: SidebarActionProps): ReturnType<typeof h> | null {
  const [, setTick] = useState(0)
  useEffect(() => unionStore.subscribe(() => setTick((x) => x + 1)), [])
  return h('button', {
    type: 'button',
    title: tt('sidebar.title'),
    onClick: (ev: { stopPropagation: () => void }) => {
      ev.stopPropagation()
      unionStore.toggleOverlay()
    },
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      padding: _props.wide ? '8px 16px' : '8px',
      gap: '8px',
      cursor: 'pointer',
      background: unionStore.showOverlay ? 'var(--dsw-alias-bg-layer-3, #f0f0f0)' : 'none',
      border: 'none',
      color: 'var(--dsw-alias-label-secondary, #666)',
      fontSize: '14px',
      borderRadius: '8px',
    },
  },
    h('span', { style: { fontSize: '18px' } }, '⛓'),
    _props.wide ? h('span', {}, tt('sidebar.title')) : null,
  )
}