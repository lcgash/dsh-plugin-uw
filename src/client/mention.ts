/**
 * Union workspace @mention source: provides files from all member directories
 * when the user types `@` in the chat input. This works alongside the
 * dsh-at-file `@` source (which covers the primary workspace), offering
 * candidates from every member directory of a union workspace.
 *
 * The inserted text is `@/absolute/path/to/file` — the AI agent can
 * then use `uw_read`/`uw_write`/`uw_edit` to access the file.
 */
import type { InputTriggerCandidate, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SessionId, ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { runtime } from './runtime.ts'
import type { SearchFileEntry } from '../protocol.ts'

/** Extend the candidate type with a stable value for onPick lookup. */
declare module '@deepseek-ai/dsh-client-ui-input-trigger/client' {
  interface InputTriggerCandidate {
    readonly value?: string
  }
}

/** Owner source name (menu group label). */
const SOURCE_NAME = 'union-workspace'

/** Design cap on visible picker rows. */
const MAX_CANDIDATES = 12

/** How long one session's index stays hot before the next menu open refetches. */
const INDEX_TTL_MS = 30_000

/** Per-session index cache. */
interface IndexCache {
  readonly promise: Promise<readonly SearchFileEntry[]>
  readonly at: number
  settled?: readonly SearchFileEntry[]
}

/** A picker row with a stable value. */
interface UWCandidate extends InputTriggerCandidate {
  readonly value: string
}

/** Escape XML-like chars for the file name display. */
function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** Basename of a /-separated path. */
function basenameOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx >= 0 ? path.slice(idx + 1) : path
}

/** Dirname of a /-separated path. */
function dirnameOf(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx >= 0 ? path.slice(0, idx) : ''
}

/** Rank files by query relevance (prefix match > substring match > alphabetical). */
function rankFiles(files: readonly SearchFileEntry[], query: string): readonly SearchFileEntry[] {
  if (query === '') return files
  const q = query.toLowerCase()
  const scored: { file: SearchFileEntry; score: number }[] = []
  for (const file of files) {
    const abs = file.path.toLowerCase()
    const rel = file.relative.toLowerCase()
    // Prefix match on absolute path
    if (abs === q) { scored.push({ file, score: 0 }); continue }
    if (abs.startsWith(q)) { scored.push({ file, score: 1 }); continue }
    // Prefix match on the member-relative path
    if (rel === q) { scored.push({ file, score: 2 }); continue }
    if (rel.startsWith(q)) { scored.push({ file, score: 3 }); continue }
    // Basename prefix match
    const base = basenameOf(rel).toLowerCase()
    if (base.startsWith(q)) { scored.push({ file, score: 4 }); continue }
    // Substring match on absolute path
    if (abs.includes(q)) { scored.push({ file, score: 5 }); continue }
    // Substring match on relative path
    if (rel.includes(q)) { scored.push({ file, score: 6 }); continue }
  }
  scored.sort((a, b) => a.score - b.score || a.file.relative.localeCompare(b.file.relative))
  return scored.map(s => s.file)
}

/** Build display path: absolute path for the candidate. */
function displayPath(entry: SearchFileEntry): string {
  return entry.path
}

/** Build the candidate rows from search results. */
function candidateRows(files: readonly SearchFileEntry[]): readonly UWCandidate[] {
  return files.map(file => {
    const display = displayPath(file)
    const base = basenameOf(file.relative)
    // Show the absolute path as the primary name, with basename as fallback
    const name = display.length > 80 ? '...' + display.slice(-77) : display
    return {
      name,
      value: display,
      description: file.kind === 'dir' ? '📁 directory' : '📄 ' + base,
    }
  })
}

/**
 * Create the union workspace @mention source.
 * @param ctx - client root context (for the API calls).
 * @returns the source to register with `inputTriggers.registerSource`.
 */
export function createUnionMentionSource(ctx: ClientContext): InputTriggerSource {
  const fetches = new Map<SessionId, IndexCache>()

  const fetchIndex = async (sessionId: SessionId): Promise<readonly SearchFileEntry[]> => {
    const existing = fetches.get(sessionId)
    const fresh = existing !== undefined && Date.now() - existing.at < INDEX_TTL_MS
    if (fresh && existing.settled !== undefined) return existing.settled
    if (fresh && existing !== undefined) return existing.promise

    if (existing !== undefined) {
      fetches.delete(sessionId)
    }

    const promise = (async () => {
      // Check if this session is a union workspace
      const status = await runtime.api.status(sessionId).catch(() => null)
      if (!status?.union) return []

      const result = await runtime.api.searchFiles(status.union.id).catch(() => null)
      if (!result?.ok || !result.files) return []
      return result.files
    })()

    const entry: IndexCache = { promise, at: Date.now() }
    fetches.set(sessionId, entry)
    promise.then(
      files => { entry.settled = files },
      () => { if (fetches.get(sessionId) === entry) fetches.delete(sessionId) },
    )
    return promise
  }

  const findEntry = (sessionId: SessionId, value: string): SearchFileEntry | undefined => {
    const cache = fetches.get(sessionId)
    if (!cache?.settled) return undefined
    // value is the absolute path
    return cache.settled.find(e => e.path === value)
  }

  return {
    trigger: '@',
    name: SOURCE_NAME,
    async candidates(session, { query, signal }) {
      const files = await fetchIndex(session.sessionId)
      if (signal.aborted) return []
      return candidateRows(rankFiles(files, query).slice(0, MAX_CANDIDATES))
    },
    warm(session) {
      fetchIndex(session.sessionId).catch(() => {})
    },
    onPick({ candidate, session }) {
      const file = candidate.value === undefined ? undefined : findEntry(session.sessionId, candidate.value)
      if (file === undefined) return undefined
      const suffix = file.kind === 'dir' ? '/' : ''
      return { text: `@${file.path}${suffix} ` }
    },
    lexicon(session) {
      const cache = fetches.get(session.sessionId)
      return cache?.settled?.map(file => file.path)
    },
    subscribeLexicon(session, listener) {
      const key = session.sessionId
      // Poll for lexicon changes
      const interval = setInterval(() => {
        const cache = fetches.get(key)
        if (cache?.settled) listener()
      }, 5000)
      return () => clearInterval(interval)
    },
  }
}