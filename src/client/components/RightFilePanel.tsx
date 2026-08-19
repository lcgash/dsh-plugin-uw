/**
 * Right-side file explorer for union-workspace sessions. Shows the member
 * directories and files of the union workspace the current session belongs to.
 *
 * Auto-follows the active session — when the user switches to a union workspace
 * session, the panel appears on the right showing that union's member files.
 * When the active session is not a union, the panel hides.
 *
 * Tree view with expand/collapse for directories. Toggle visibility via the
 * 📁 button in the session header.
 *
 * Mounted via DOM injection in index.ts.
 */
import { createElement as h } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileEntry, Union } from '../../protocol.ts'
import { runtime } from '../runtime.ts'
import { unionStore, useUnionStore } from '../store.ts'

/** One tree node: a directory that can be expanded to show its children. */
interface TreeNode {
  path: string
  name: string
  children: FileEntry[]
  expanded: boolean
  loading: boolean
  error: string | null
}

/** Get the current active session id from the sessions list store. */
function activeSessionId(): string | undefined {
  const list = runtime.sessions?.list
  if (list === undefined) return undefined
  const snapshot = list.getSnapshot()
  return snapshot.current
}

/** Normalize a path (remove trailing slash). */
function normPath(p: string): string {
  return p.replace(/\/+$/, '')
}

/** Get the basename of a path. */
function baseName(p: string): string {
  return normPath(p).split('/').pop() ?? p
}

export function RightFilePanel(): ReturnType<typeof h> | null {
  useUnionStore()

  // Track the active session.
  const [sessionId, setSessionId] = useState<string | undefined>(activeSessionId)
  useEffect(() => {
    const list = runtime.sessions?.list
    if (list === undefined) return
    const fn = () => {
      const snapshot = list.getSnapshot()
      setSessionId(snapshot.current)
    }
    return list.subscribe(fn)
  }, [])

  const [info, setInfo] = useState<Union | null>(null)
  const [roots, setRoots] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  // Subdirectory expansion state: path -> { children, expanded, loading }
  const [subdirs, setSubdirs] = useState<Record<string, { children: FileEntry[]; expanded: boolean; loading: boolean; error: string | null }>>({})
  // Style tag for adjusting the conversation column width.
  const styleRef = useRef<HTMLStyleElement | null>(null)

  // Add/remove a CSS rule that shrinks the conversation column when the panel is visible.
  const handleLayout = useCallback((visible: boolean) => {
    const styleId = 'union-workspace-layout'
    if (visible) {
      if (styleRef.current) return
      const style = document.createElement('style')
      style.id = styleId
      style.textContent = `
        [data-pane="conversation"], [class*="centerCol"] {
          margin-right: 300px !important;
          transition: margin-right 0.2s ease;
        }
      `
      document.head.appendChild(style)
      styleRef.current = style
    } else {
      if (styleRef.current) {
        styleRef.current.remove()
        styleRef.current = null
      }
    }
  }, [])

  // Sync layout when panelVisible changes.
  useEffect(() => {
    handleLayout(unionStore.panelVisible)
  }, [unionStore.panelVisible, handleLayout])

  // Fetch union info when sessionId changes.
  useEffect(() => {
    if (!sessionId) {
      setInfo(null)
      setRoots([])
      setFetchError(null)
      return
    }
    let alive = true
    setLoading(true)
    setFetchError(null)
    runtime.api.status(sessionId).then((r) => {
      if (!alive) return
      if (r?.union) {
        setInfo(r.union)
        // Auto-show panel: set panelVisible when a union session is detected
        unionStore.setFiles(sessionId)
        setRoots(r.union.members.map((mp) => ({
          path: mp,
          name: baseName(mp),
          children: [],
          expanded: false,
          loading: false,
          error: null,
        })))
        setLoading(false)
      } else {
        setInfo(null)
        setRoots([])
        setLoading(false)
        unionStore.closeFiles() // hide panel for non-union sessions
      }
    }).catch(() => {
      if (alive) {
        setInfo(null)
        setRoots([])
        setFetchError('Failed to fetch union info')
        setLoading(false)
      }
    })
    return () => { alive = false }
  }, [sessionId])

  // Toggle expand/collapse for a tree node.
  const toggleNode = useCallback((path: string) => {
    if (!info) return
    const existing = roots.find((r) => r.path === path)
    if (existing?.expanded) {
      setRoots((prev) => prev.map((n) => n.path === path ? { ...n, expanded: false } : n))
      return
    }
    setRoots((prev) => prev.map((n) => n.path === path ? { ...n, loading: true, expanded: true, error: null } : n))
    runtime.api.listFiles({ unionId: info.id, dir: path }).then((listing) => {
      setRoots((prev) => prev.map((n) =>
        n.path === path
          ? {
              ...n,
              children: listing.ok && listing.entries ? listing.entries : [],
              loading: false,
              error: listing.ok ? null : (listing.error ?? 'Failed to list'),
            }
          : n,
      ))
    }).catch((err) => {
      setRoots((prev) => prev.map((n) => n.path === path ? { ...n, loading: false, error: String(err) } : n))
    })
  }, [info, roots])

  // Expand/collapse a subdirectory within a parent's children.
  const toggleSubdir = useCallback((parentPath: string, dirName: string) => {
    if (!info) return
    const fullPath = normPath(parentPath) + '/' + dirName
    const existing = subdirs[fullPath]
    if (existing?.expanded) {
      setSubdirs((prev) => ({ ...prev, [fullPath]: { ...prev[fullPath], expanded: false } }))
      return
    }
    if (existing) {
      // Already loaded, just expand
      setSubdirs((prev) => ({ ...prev, [fullPath]: { ...prev[fullPath], expanded: true } }))
      return
    }
    // Mark as loading and fetch
    setSubdirs((prev) => ({ ...prev, [fullPath]: { children: [], expanded: true, loading: true, error: null } }))
    runtime.api.listFiles({ unionId: info.id, dir: fullPath }).then((listing) => {
      setSubdirs((prev) => ({
        ...prev,
        [fullPath]: {
          children: listing.ok && listing.entries ? listing.entries : [],
          expanded: true,
          loading: false,
          error: listing.ok ? null : (listing.error ?? 'Failed to list'),
        },
      }))
    }).catch((err) => {
      setSubdirs((prev) => ({ ...prev, [fullPath]: { children: [], expanded: true, loading: false, error: String(err) } }))
    })
  }, [info, subdirs])

  // Recursively render a file/directory entry inside a parent directory.
  const renderChild = useCallback((parentPath: string, entry: FileEntry): ReturnType<typeof h> => {
    if (entry.type === 'directory') {
      const fullPath = normPath(parentPath) + '/' + entry.name
      const sub = subdirs[fullPath]
      return h('div', { key: entry.name },
        h('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '5px 8px',
            fontSize: '13px',
            color: 'var(--dsw-alias-label-primary, #333)',
            cursor: 'pointer',
            borderRadius: '6px',
            whiteSpace: 'nowrap',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-2, #f5f5f5)'
          },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => {
            e.currentTarget.style.background = 'transparent'
          },
          onClick: (e: MouseEvent) => {
            e.stopPropagation()
            toggleSubdir(parentPath, entry.name)
          },
          title: entry.name,
        },
          h('span', { style: { flex: 'none', width: '14px', fontSize: '10px', color: 'var(--dsw-alias-label-tertiary, #999)', textAlign: 'center', display: 'inline-block', lineHeight: '14px' } }, sub?.loading ? '⟳' : (sub?.expanded ? '▼' : '▶')),
          h('span', { style: { flex: 1, minWidth: 0 } }, entry.name),
        ),
        // Expanded children
        sub?.expanded && !sub.loading ? h('div', { style: { marginLeft: '16px' } },
          sub.children.length === 0 ? h('div', { style: { padding: '4px 8px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #999)' } }, '(empty)') : null,
          sub.children.map((subChild) => renderChild(fullPath, subChild)),
        ) : null,
        sub?.loading ? h('div', { style: { padding: '4px 8px 4px 22px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #999)' } }, 'Loading...') : null,
        sub?.error ? h('div', { style: { padding: '4px 8px 4px 22px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #e44)' } }, sub.error) : null,
      )
    }
    // File entry
    return h('div', {
      key: entry.name,
      style: {
        padding: '4px 8px 4px 22px',
        fontSize: '13px',
        color: 'var(--dsw-alias-label-secondary, #666)',
        borderRadius: '6px',
        whiteSpace: 'nowrap',
      },
      title: entry.name + (entry.size !== undefined ? ` (${formatBytes(entry.size)})` : ''),
    },
      h('span', { style: { flex: 1, minWidth: 0 } }, entry.name),
      entry.size !== undefined ? h('span', { style: { flex: 'none', fontSize: '11px', opacity: 0.4, marginLeft: 'auto', paddingLeft: '8px' } }, formatBytes(entry.size)) : null,
    )
  }, [subdirs, toggleSubdir])

  if (!sessionId || !info || !unionStore.panelVisible) return null

  return h('div', {
    style: {
      position: 'fixed',
      top: 0, right: 0, bottom: 0,
      width: '300px',
      zIndex: 800,
      background: 'var(--dsw-alias-bg-base, #fff)',
      borderLeft: '1px solid var(--dsw-alias-border-l2, #e0e0e0)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxShadow: '-4px 0 12px rgba(0,0,0,0.08)',
    },
  },
    // Header row with title and close button
    h('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '12px 14px',
        borderBottom: '1px solid var(--dsw-alias-border-l1, #e0e0e0)',
        flex: 'none',
      },
    },
      h('span', {
        style: {
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--dsw-alias-label-primary, #333)',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      }, `⛓ ${info.title}`),
      h('button', {
        type: 'button',
        style: {
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--dsw-alias-label-secondary, #666)',
          fontSize: '16px',
          padding: '2px 8px',
          borderRadius: '4px',
          flex: 'none',
          lineHeight: 1,
          opacity: 0.6,
        },
        onClick: () => unionStore.closeFiles(),
        title: 'Close',
      }, '✕'),
    ),
    // File tree content
    h('div', {
      style: {
        flex: 1,
        overflow: 'auto',
        padding: '8px 6px',
        fontSize: '13px',
        color: 'var(--dsw-alias-label-primary, #333)',
      },
    },
      loading ? h('div', { style: { padding: '16px', color: 'var(--dsw-alias-label-tertiary, #999)' } }, 'Loading...') : null,
      fetchError ? h('div', { style: { padding: '16px', color: 'var(--dsw-alias-state-error-primary, #e44)' } }, fetchError) : null,
      !loading && !fetchError && roots.length === 0 ? h('div', { style: { padding: '16px', color: 'var(--dsw-alias-label-tertiary, #999)' } }, 'No files') : null,
      !loading ? roots.map((root) =>
        h('div', { key: root.path, style: { marginBottom: '2px' } },
          // Root node (member directory)
          h('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '6px 8px',
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--dsw-alias-label-primary, #333)',
              cursor: 'pointer',
              borderRadius: '6px',
              whiteSpace: 'nowrap',
            },
            onMouseEnter: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-2, #f5f5f5)'
            },
            onMouseLeave: (e: { currentTarget: HTMLElement }) => {
              e.currentTarget.style.background = 'transparent'
            },
            onClick: () => toggleNode(root.path),
            title: root.path,
          },
            // Expand/collapse arrow
            h('span', {
              style: {
                flex: 'none',
                width: '14px',
                fontSize: '10px',
                color: 'var(--dsw-alias-label-tertiary, #999)',
                textAlign: 'center',
                display: 'inline-block',
                lineHeight: '14px',
              },
            }, root.loading ? '⟳' : (root.expanded ? '▼' : '▶')),
            // Name
            h('span', { style: { flex: 1, minWidth: 0 } }, root.name),
          ),
          // Children (expanded)
          root.expanded && !root.loading ? h('div', { style: { marginLeft: '16px' } },
            root.children.length === 0 ? h('div', { style: { padding: '4px 8px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #999)' } }, '(empty)') : null,
            root.children.map((child) => renderChild(root.path, child)),
          ) : null,
          root.expanded && root.loading ? h('div', { style: { padding: '4px 8px 4px 22px', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #999)' } }, 'Loading...') : null,
          root.expanded && root.error ? h('div', { style: { padding: '4px 8px 4px 22px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #e44)' } }, root.error) : null,
        ),
      ) : null,
    ),
  )
}

/** Human-readable byte size. */
function formatBytes(n: number): string {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + 'M'
    : n >= 1024 ? Math.round(n / 1024) + 'K'
    : String(n) + 'B'
}