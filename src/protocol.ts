/**
 * Shared wire contracts between the host half and the browser half of the
 * union-workspace plugin. Both faces import from this module; the client
 * bundle inlines it. Every payload is lossless JSON.
 */

/** One union: a primary directory plus one or more member directories. */
export interface Union {
  /** Stable id (host-assigned); survives renames. */
  id: string
  /** Display title. */
  title: string
  /** Member directory paths; index 0 is the primary. De-duplicated, no containment pairs, >= 2. */
  members: string[]
  /** Sandbox preset applied to every session marked with this union. */
  preset: 'workspace-write' | 'danger-full-access'
  /**
   * DSH workspace id for this union's dedicated workspace. The workspace
   * lives at a unique synthetic path under the primary member, so it never
   * collides with a regular workspace on the same directory or with another
   * union that shares a primary member. Set lazily by `ensurePrimary`.
   */
  workspaceId?: string
}

/** The persisted store: unions plus per-session marks. */
export interface UnionStore {
  unions: Union[]
  /** sessionId -> unionId. */
  marks: Record<string, string>
}

/** REST API path family (same-origin JSON; served by the host half). */
export const UW_API = {
  /** GET -> { unions } */
  list: '/api/dsh-union-workspace/list',
  /** POST { unions } -> { ok, notice } */
  sync: '/api/dsh-union-workspace/sync',
  /** POST { unionId } -> { ok, workspaceId } */
  ensurePrimary: '/api/dsh-union-workspace/ensure-primary',
  /** POST { unionId, sessionId } -> { ok } */
  mark: '/api/dsh-union-workspace/mark',
  /** GET ?sessionId -> { union | null } */
  status: '/api/dsh-union-workspace/status',
  /** GET ?sessionId -> { path | null } */
  currentPath: '/api/dsh-union-workspace/current-path',
  /** POST { unionId, dir } -> { ok, root, entries } */
  listFiles: '/api/dsh-union-workspace/list-files',
  /** POST { unionId, maxFiles?, ignoreDirs? } -> { ok, files } */
  searchFiles: '/api/dsh-union-workspace/search-files',
} as const

/** One file-system listing entry (browser-safe projection of FsDirEntry). */
export interface FileEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  size?: number
}

/** Payloads. */
export interface ListResult {
  unions: Union[]
}
export interface SyncPayload {
  unions: Union[]
}
export interface MutateResult {
  ok: boolean
  notice?: string
  error?: string
  workspaceId?: string
}
export interface StatusResult {
  union: Union | null
}
export interface CurrentPathResult {
  path: string | null
}
export interface ListFilesPayload {
  unionId: string
  dir: string
}
export interface ListFilesResult {
  ok: boolean
  root?: string
  entries?: FileEntry[]
  error?: string
}

/** One search result entry (browser-safe projection of a found file). */
export interface SearchFileEntry {
  /** Absolute path on disk. */
  path: string
  /** Display path relative to the member directory (e.g. "src/index.ts"). */
  relative: string
  /** The member directory index this file belongs to. */
  memberIndex: number
  /** The member directory this file belongs to. */
  memberPath: string
  kind: 'file' | 'dir'
}

export interface SearchFilesPayload {
  unionId: string
  maxFiles?: number
  ignoreDirs?: string[]
}

export interface SearchFilesResult {
  ok: boolean
  files?: SearchFileEntry[]
  truncated?: boolean
  error?: string
}