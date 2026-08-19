/**
 * The /api/dsh-union-workspace route family: the browser half's only data
 * path. Loopback-only trust fence mirrors dsh-ssh — every route reads or
 * writes files on behalf of a browser session, so LAN-exposed dsh web
 * deployments must not serve them.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FileSystem } from './host-types.ts'
import type { PermissionPresetService } from './host-types.ts'
import type { Session } from '@deepseek-ai/dsh-session'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { UW_API, type FileEntry, type Union } from './protocol.ts'
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
        const workspaceTitles = new Set(workspaceRegistry.list().map((w) => w.title))
        const orphans = all.filter((u) => !workspaceTitles.has(u.title))
        if (orphans.length > 0) {
          const kept = all.filter((u) => workspaceTitles.has(u.title))
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
          // Workspace title is unique: if a workspace with the same title
          // already exists, reuse it.
          let ws = workspaceRegistry.list().find((w) => w.title === union.title)
          if (ws === undefined) {
            // Always use the primary member as the workspace root. Never use a
            // common ancestor — that would expose sibling directories outside
            // the union members to the agent.
            ws = await workspaceRegistry.create(union.members[0], union.title)
            if (ws.title !== union.title) await ws.setTitle(union.title)
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