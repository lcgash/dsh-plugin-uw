/**
 * The /api/dsh-union-workspace route family: the browser half's only data
 * path. Loopback-only trust fence mirrors dsh-ssh — every route reads or
 * writes files on behalf of a browser session, so LAN-exposed dsh web
 * deployments must not serve them.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, opendir } from 'node:fs/promises'
import type { FileSystem } from './host-types.ts'
import type { PermissionPresetService } from './host-types.ts'
import type { Session } from '@deepseek-ai/dsh-session'
import type { Workspace, WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { UW_API, type FileEntry, type SearchFileEntry, type SearchFilesResult, type Union } from './protocol.ts'
import type { UnionStoreBackend } from './store.ts'

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > 64 * 1024) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** URL query helper (first value, decoded). */
function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/** Route family dependencies. */
export interface UnionRoutesDeps {
  store: UnionStoreBackend
  fs: FileSystem
  permissionPresets: PermissionPresetService
  workspaceRegistry: WorkspaceRegistry
  /** Resolve one live session by id (for preset application and cwd). */
  getSession: (sessionId: string) => Session | undefined
  /** True when the request arrived over the loopback interface. */
  isLoopback: (req: IncomingMessage) => boolean
  /** Apply the union's preset to a session (wrapped so routes stay testable). */
  applyPreset: (session: Session, union: Union) => void
}

/** Trailing-slash normalization (must match store.ts). */
function norm(path: string): string {
  return String(path).replace(/\/+$/, '')
}

/** Resolve one union inside a request; writes 404 and returns null on mismatch. */
async function resolveUnion(deps: UnionRoutesDeps, res: ServerResponse, body: Record<string, unknown> | undefined): Promise<Union | null> {
  const unionId = typeof body?.unionId === 'string' ? body.unionId : ''
  const union = unionId ? deps.store.union(unionId) : undefined
  if (!union) writeJson(res, 404, { ok: false, error: '联合工作区不存在' })
  return union ?? null
}

/**
 * Build the route table.
 */
export function buildUnionRoutes(deps: UnionRoutesDeps): WebRoute[] {
  const { store, fs, workspaceRegistry } = deps

  const guard = (req: IncomingMessage): boolean => {
    if (deps.isLoopback(req)) return true
    return false
  }

  const routes: WebRoute[] = [
    {
      kind: 'exact',
      path: UW_API.list,
      handler: async (req, res) => {
        if (!guard(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: loopback only' })
        // Prune orphaned unions whose workspace was deleted from the sidebar.
        const all = store.unions as readonly Union[]
        const workspaceIds = new Set<string>(workspaceRegistry.list().map((w) => w.id as string))
        const titleIndex = new Map(workspaceRegistry.list().map((w) => [w.title, w.id] as const))
        const orphans = all.filter((u) => {
          if (u.workspaceId) return !workspaceIds.has(u.workspaceId)
          // Legacy: no workspaceId stored, fall back to title check.
          return !titleIndex.has(u.title)
        })
        if (orphans.length > 0) {
          const kept = all.filter((u) => {
            if (u.workspaceId) return workspaceIds.has(u.workspaceId)
            return titleIndex.has(u.title)
          })
          await store.replaceUnions(kept as Union[])
        }
        writeJson(res, 200, { unions: store.unions })
      },
    },
    {
      kind: 'exact',
      path: UW_API.sync,
      handler: async (req, res) => {
        if (!guard(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: loopback only' })
        const body = await readJsonBody(req)
        const next = Array.isArray(body?.unions) ? body.unions as Union[] : []
        // Delete workspaces whose unions were removed from the settings page.
        const prev = store.unions as readonly Union[]
        const prevIds = new Set(prev.map((u) => u.id))
        const nextIds = new Set(next.map((u) => u.id))
        const removed = prev.filter((u) => !nextIds.has(u.id))
        for (const u of removed) {
          if (!u.workspaceId) continue
          for (const ws of workspaceRegistry.list()) {
            if (ws.id === u.workspaceId) {
              try { await workspaceRegistry.delete(ws.id) } catch { /* ignore */ }
              break
            }
          }
        }
        await store.replaceUnions(next)
        writeJson(res, 200, { ok: true, notice: `已保存 ${store.unions.length} 个联合工作区` })
      },
    },
    {
      kind: 'exact',
      path: UW_API.ensurePrimary,
      handler: async (req, res) => {
        if (!guard(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: loopback only' })
        const body = await readJsonBody(req)
        const union = await resolveUnion(deps, res, body)
        if (!union) return
        try {
          // Look up the union's dedicated workspace by id, or create one.
          let ws: Workspace | undefined
          if (union.workspaceId) {
            ws = workspaceRegistry.list().find((w) => w.id === union.workspaceId)
          }
          if (ws === undefined) {
            // Each union gets its own workspace at a unique synthetic path
            // under the primary member. This avoids path collisions with
            // regular workspaces and with other unions sharing a primary.
            const syntheticPath = union.members[0].replace(/\/+$/, '') + '/.dsh-union-' + union.id
            // Ensure the directory exists.
            try { await mkdir(syntheticPath, { recursive: true }) } catch { /* already exists */ }
            ws = await workspaceRegistry.create(syntheticPath, union.title)
            if (ws.title !== union.title) await ws.setTitle(union.title)
            // Persist the workspace id so subsequent lookups go by id.
            await store.setUnionWorkspace(union.id, ws.id)
          }
          // Move the session: detach from its original workspace (if any) and
          // attach to the union workspace, so other sessions in the original
          // workspace are unaffected.
          const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
          if (sessionId) {
            // Detach from any existing workspace
            for (const w of workspaceRegistry.list()) {
              if (w.id !== ws.id && (w.sessionIds as readonly string[]).includes(sessionId)) {
                try { await w.detachSession(sessionId as never) } catch { /* ignore */ }
                break
              }
            }
            // Attach to the union workspace
            try { await ws.attachSession(sessionId as never) } catch { /* ignore if already attached or cwd mismatch */ }
            // Mark the session so the client-side UI can show the file panel
            store.mark(sessionId, union.id)
          }
          writeJson(res, 200, { ok: true, workspaceId: ws.id })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: String((error as Error)?.message ?? error) })
        }
      },
    },
    {
      kind: 'exact',
      path: UW_API.mark,
      handler: async (req, res) => {
        if (!guard(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: loopback only' })
        const body = await readJsonBody(req)
        const unionId = typeof body?.unionId === 'string' ? body.unionId : ''
        const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
        if (!unionId || !sessionId) return writeJson(res, 400, { ok: false, error: '缺少参数' })
        store.mark(sessionId, unionId)
        const union = store.union(unionId)
        const session = deps.getSession(sessionId)
        if (union && session) deps.applyPreset(session, union)
        writeJson(res, 200, { ok: true })
      },
    },
    {
      kind: 'exact',
      path: UW_API.status,
      handler: async (req, res) => {
        if (!guard(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: loopback only' })
        const url = new URL(req.url ?? '/', 'http://localhost')
        const sessionId = queryParam(url, 'sessionId')
        const union = sessionId ? store.unionOf(sessionId) : undefined
        writeJson(res, 200, { union: union ?? null })
      },
    },
    {
      kind: 'exact',
      path: UW_API.currentPath,
      handler: async (req, res) => {
        if (!guard(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: loopback only' })
        const url = new URL(req.url ?? '/', 'http://localhost')
        const sessionId = queryParam(url, 'sessionId')
        const session = sessionId ? deps.getSession(sessionId) : undefined
        const cwd = session?.header?.cwd ?? null
        writeJson(res, 200, { path: cwd })
      },
    },
    {
      kind: 'exact',
      path: UW_API.listFiles,
      handler: async (req, res) => {
        if (!guard(req)) return writeJson(res, 403, { ok: false, error: 'forbidden: loopback only' })
        const body = await readJsonBody(req)
        const union = await resolveUnion(deps, res, body)
        if (!union) return
        const dir = typeof body?.dir === 'string' ? body.dir : ''

        // When recurse is true, walk the directory tree and return all files
        if (body?.recurse === true) {
          const maxFiles = typeof body?.maxFiles === 'number' ? body.maxFiles : 5000
          const ignoreDirs = Array.isArray(body?.ignoreDirs)
            ? new Set(body.ignoreDirs as string[])
            : new Set(['node_modules', '.git', '.svn', '.hg', '.DS_Store', '__pycache__', '.dsh-union'])
          const files: SearchFileEntry[] = []
          const queue: { path: string; relative: string; memberIndex: number; memberPath: string }[] = []
          let truncated = false

          if (dir) {
            // Walk from a specific directory
            const nd = norm(dir)
            let memberIndex = -1
            let memberPath = ''
            for (let i = 0; i < union.members.length; i++) {
              if (nd === union.members[i] || nd.startsWith(union.members[i] + '/')) {
                memberIndex = i
                memberPath = union.members[i]
                break
              }
            }
            if (memberIndex < 0) {
              return writeJson(res, 400, { ok: false, error: '目录不在任何成员目录内' })
            }
            const relativeBase = nd === memberPath ? '' : nd.slice(memberPath.length + 1)
            queue.push({ path: nd, relative: relativeBase, memberIndex, memberPath })
          } else {
            // Walk from all member directories
            for (let i = 0; i < union.members.length; i++) {
              queue.push({ path: union.members[i], relative: '', memberIndex: i, memberPath: union.members[i] })
            }
          }

          // Shared walk loop using task-level memberIndex/memberPath
          try {
            while (queue.length > 0 && !truncated) {
              const task = queue.shift()!
              let handle
              try {
                handle = await opendir(task.path)
              } catch {
                continue
              }
              try {
                for await (const dirent of handle) {
                  if (files.length >= maxFiles) { truncated = true; break }
                  const child = task.path + '/' + dirent.name
                  const childRelative = task.relative === '' ? dirent.name : task.relative + '/' + dirent.name
                  if (dirent.isDirectory()) {
                    if (ignoreDirs.has(dirent.name)) continue
                    files.push({ path: child, relative: childRelative, memberIndex: task.memberIndex, memberPath: task.memberPath, kind: 'dir' })
                    queue.push({ path: child, relative: childRelative, memberIndex: task.memberIndex, memberPath: task.memberPath })
                  } else if (dirent.isFile()) {
                    files.push({ path: child, relative: childRelative, memberIndex: task.memberIndex, memberPath: task.memberPath, kind: 'file' })
                  }
                }
              } finally {
                handle.close().catch(() => {})
              }
            }
            writeJson(res, 200, { ok: true, files, truncated } satisfies SearchFilesResult)
          } catch (error) {
            writeJson(res, 500, { ok: false, error: String((error as Error)?.message ?? error) })
          }
          return
        }

        // Original behavior: list files in a single directory
        if (!dir) return writeJson(res, 400, { ok: false, error: '缺少目录参数' })
        const nd = norm(dir)
        if (!union.members.some((m) => nd === m || nd.startsWith(m + '/'))) {
          return writeJson(res, 400, { ok: false, error: '目录不在任何成员目录内' })
        }
        try {
          const target = await fs.resolve(nd)
          const entries = await fs.listDir(target)
          const out: FileEntry[] = entries.map((en) => ({
            name: en.name,
            type: en.type,
            size: typeof en.size === 'number' ? en.size : undefined,
          }))
          writeJson(res, 200, { ok: true, root: nd, entries: out })
        } catch (error) {
          writeJson(res, 500, { ok: false, error: String((error as Error)?.message ?? error) })
        }
      },
    },
  ]

  return routes
}