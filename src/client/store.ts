/**
 * Browser-side store for the union-workspace UI: open state, dialog mode,
 * the session-scoped file panel, and the union being edited. One instance
 * per plugin apply; components subscribe via {@link useUnionStore}.
 */
import { useEffect, useState } from 'react'
import type { Union } from '../protocol.ts'

export type OverlayMode = 'normal' | 'quick' | 'members'

/** One union open in the create/edit dialog. */
export interface EditUnion extends Union {
}

export class UnionStore {
  /** Overlay dialog open (create/edit union). */
  open = false
  /** Management page overlay open (sidebar button). */
  showOverlay = false
  /** Active tab in the management page: 'unions' | 'files'. */
  overlayTab: 'unions' | 'files' = 'unions'
  /** Dialog flavor: normal (header ➕), quick (/uw upgrade), members (view-only). */
  mode: OverlayMode = 'normal'
  /** Primary path pre-filled by /uw upgrade. */
  primaryPath = ''
  /** The union shown in members view. */
  membersView: Union | null = null
  /** Session whose file panel is open. */
  filesSessionId: string | null = null
  /** Union being edited (add member via /uw). */
  editUnion: EditUnion | null = null
  /** Whether the right file panel is visible (manual toggle). */
  panelVisible = false
  /** Session ID to mark with the union after creation/update (upgrade flow). */
  pendingSessionId: string | null = null

  private readonly listeners = new Set<() => void>()

  /** Force a re-render of all subscribers. */
  emit(): void {
    for (const fn of this.listeners) fn()
  }

  setOpen(open: boolean): void {
    if (this.open !== open) { this.open = open; this.emit() }
  }

  toggleOverlay(): void {
    this.showOverlay = !this.showOverlay
    this.emit()
  }

  setOverlayTab(tab: 'unions' | 'files'): void {
    if (this.overlayTab !== tab) { this.overlayTab = tab; this.emit() }
  }

  openMembers(union: Union): void {
    this.membersView = union
    this.mode = 'members'
    this.emit()
  }

  closeMembers(): void {
    this.membersView = null
    if (this.mode === 'members') this.mode = 'normal'
    this.emit()
  }

  setFiles(sessionId: string): void {
    this.filesSessionId = sessionId
    this.panelVisible = true
    this.emit()
  }

  closeFiles(): void {
    this.filesSessionId = null
    this.panelVisible = false
    this.emit()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
}

export const unionStore = new UnionStore()

/** Re-render current component when the store changes. */
export function useUnionStore(): void {
  const [, setTick] = useState(0)
  useEffect(() => unionStore.subscribe(() => setTick((x) => x + 1)), [])
}

/** Human-readable file size (B / K / M). */
export function formatSize(n: number): string {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + 'M' : n >= 1024 ? Math.round(n / 1024) + 'K' : String(n) + 'B'
}

/** Trailing-slash normalization for path comparisons. */
export function normPath(path: string): string {
  return String(path).replace(/\/+$/, '')
}

/** Validate a member directory against the existing member list; returns an error descriptor or null. */
export interface MemberError {
  /** Locale key in the `union-workspace` namespace. */
  key: 'settings.memberInvalid' | 'settings.memberDup' | 'settings.memberNestedOf' | 'settings.memberParentOf'
  /** Interpolation values for the locale string. */
  values?: Record<string, string>
}

export function memberError(existing: readonly string[], path: string): MemberError | null {
  const p = normPath(path)
  if (!p) return { key: 'settings.memberInvalid' }
  for (const m of existing) {
    const nm = normPath(m)
    if (nm === p) return { key: 'settings.memberDup', values: { path: p } }
    if (p.startsWith(nm + '/')) return { key: 'settings.memberNestedOf', values: { path: p, other: nm } }
    if (nm.startsWith(p + '/')) return { key: 'settings.memberParentOf', values: { path: p, other: nm } }
  }
  return null
}

/** Find an existing union with exactly the same member set (order-insensitive). */
export function findMatchingUnion(unions: readonly Union[], members: readonly string[]): Union | null {
  if (!Array.isArray(unions) || members.length < 2) return null
  const sorted = members.map(normPath).sort()
  for (const u of unions) {
    const us = (u.members ?? []).map(normPath).sort()
    if (us.length === sorted.length && us.every((m: string, i: number) => m === sorted[i])) return u
  }
  return null
}