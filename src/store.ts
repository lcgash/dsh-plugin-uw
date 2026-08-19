/**
 * Persistent store for union workspaces: `~/.dsh/union-workspaces.json`.
 *
 * Loads both legacy shapes (a bare union array) and the current
 * `{ unions, marks }` object so pre-0.1.0 data migrates losslessly.
 * Writes run through the host fs service with an explicit
 * `danger-full-access` sandbox policy because the store lives OUTSIDE every
 * session workspace (it is a user-level DSH config file, like other profile
 * state in `~/.dsh/`).
 */
import type { FileSystem } from './host-types.ts'
import type { ShellExecutor } from './host-types.ts'
import type { Union, UnionStore } from './protocol.ts'

/** Trailing-slash normalization for path comparisons. */
function norm(path: string): string {
  return String(path).replace(/\/+$/, '')
}

/** De-duplicate members and reject containment pairs (a member cannot nest another). */
function cleanMembers(members: readonly string[] | undefined): string[] {
  const out: string[] = []
  for (const raw of members ?? []) {
    const p = norm(raw)
    if (!p || out.includes(p)) continue
    if (out.some((m) => p.startsWith(m + '/') || m.startsWith(p + '/'))) continue
    out.push(p)
  }
  return out
}

/** Validate and normalize one union record; `null` when it cannot be a union. */
export function sanitizeUnion(raw: unknown): Union | null {
  if (typeof raw !== 'object' || raw === null) return null
  const u = raw as Record<string, unknown>
  const members = cleanMembers(Array.isArray(u.members) ? u.members as string[] : undefined)
  if (members.length < 2) return null
  const id = String(u.id ?? 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))
  const title = String(u.title ?? members[0].split('/').pop() ?? 'workspace')
  const preset = u.preset === 'workspace-write' || u.preset === 'workspace-write-all' ? u.preset : 'danger-full-access'
  return { id, title, members, preset }
}

/** Backend for the union store. */
export class UnionStoreBackend {
  private storePath: string | null = null
  private data: UnionStore = { unions: [], marks: {} }

  constructor(
    private readonly fs: FileSystem,
    private readonly shell: ShellExecutor,
  ) {}

  /** Resolve `~/.dsh/union-workspaces.json` through the shell (HOME may differ from cwd). */
  async discoverStorePath(): Promise<void> {
    try {
      const spec = this.shell.resolve({ command: 'printf %s "$HOME"' })
      const res = await this.shell.run(spec)
      const home = (res.stdout.text ?? '').trim()
      if (home) this.storePath = home + '/.dsh/union-workspaces.json'
    } catch (error) {
      console.error('[union-workspace] discover store path failed:', String(error))
    }
  }

  /** Read and normalize the store; missing/invalid files start empty. */
  async load(): Promise<void> {
    if (!this.storePath) return
    try {
      const target = await this.fs.resolve(this.storePath)
      const text = await this.fs.readText(target)
      if (!text) return
      const parsed: unknown = JSON.parse(text)
      if (Array.isArray(parsed)) {
        this.data = { unions: parsed.map(sanitizeUnion).filter((u): u is Union => u !== null), marks: {} }
      } else if (typeof parsed === 'object' && parsed !== null) {
        const p = parsed as Record<string, unknown>
        this.data = {
          unions: Array.isArray(p.unions) ? p.unions.map(sanitizeUnion).filter((u): u is Union => u !== null) : [],
          marks: typeof p.marks === 'object' && p.marks !== null ? p.marks as Record<string, string> : {},
        }
      }
      console.log(`[union-workspace] loaded ${this.data.unions.length} unions from ${this.storePath}`)
    } catch (error) {
      console.log(`[union-workspace] no existing store (${String((error as Error)?.message ?? error)})`)
    }
  }

  /** Persist the store under `~/.dsh/` with an explicit full-access policy. */
  async save(): Promise<void> {
    if (!this.storePath) return
    try {
      const target = await this.fs.resolve(this.storePath)
      await this.fs.writeText(
        target,
        JSON.stringify(this.data, null, 2),
        undefined,
        undefined,
        { mode: 'danger-full-access', workspaceRoot: '/' },
      )
    } catch (error) {
      console.error('[union-workspace] save store failed:', String(error))
    }
  }

  get unions(): readonly Union[] {
    return this.data.unions
  }

  /** Replace the full union list (the browser half owns ordering/edits). */
  async replaceUnions(unions: readonly Union[]): Promise<void> {
    this.data.unions = unions.map(sanitizeUnion).filter((u): u is Union => u !== null)
    await this.save()
  }

  union(id: string): Union | undefined {
    return this.data.unions.find((u) => u.id === id)
  }

  mark(sessionId: string, unionId: string): void {
    this.data.marks[sessionId] = unionId
    void this.save()
  }

  unmark(sessionId: string): void {
    delete this.data.marks[sessionId]
    void this.save()
  }

  unionOf(sessionId: string): Union | undefined {
    const id = this.data.marks[sessionId]
    return id ? this.union(id) : undefined
  }
}