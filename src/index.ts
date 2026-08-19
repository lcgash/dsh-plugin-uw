/**
 * Host half of the union-workspace plugin — a standard cordis plugin loaded
 * from the profile composition via the row in `cordis.patch.yml` (id
 * `union-workspace`). Owns the persisted union store, the
 * /api/dsh-union-workspace route family, and preset application on marked
 * sessions. The UI lives in the browser half (exports "./client").
 *
 * Security: every route is loopback-only (mirrors dsh-ssh) because the
 * endpoints read and write files on behalf of a browser page; LAN-exposed
 * deployments must not serve them.
 */
import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-session'
import z from 'schemastery'
import type { Union } from './protocol.ts'
import { buildUnionRoutes } from './routes.ts'
import { UnionStoreBackend } from './store.ts'
import { mountOnce } from './mount-once.ts'
import type { FileSystem, PermissionPresetService, ShellExecutor } from './host-types.ts'

/** Stable cordis plugin name. */
export const name = 'union-workspace'

/** Services required before the union surfaces can mount. */
export const inject = ['webServer', 'workspaceRegistry', 'sessions']

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  announceToAgent?: boolean
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  announceToAgent: z.boolean().default(true),
  enabled: z.boolean().default(true),
})

const DEFAULT_ANNOUNCE = true
const SECTION_ORDER = 400

export const UNION_GUIDANCE = '本机已安装 dsh-union-workspace 插件(联合工作区):在设置页或会话输入 / 选中「uw」可把多个目录合并进一个会话(主目录+成员目录,至少 2 个);已联合的会话会应用所选权限预设,并可在会话头部右侧打开成员目录文件列表面板。用户提到「联合工作区 / 成员目录 / uw」时即指本插件,请据此协作。'

function isLoopbackRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress
  if (remote === undefined) return false
  const address = remote.startsWith('::ffff:') ? remote.slice(7) : remote
  return address === '127.0.0.1' || address === '::1'
}

function applyPresetTo(session: unknown, union: Union, permissionPresets: PermissionPresetService): void {
  try {
    permissionPresets.set(session, union.preset)
  } catch (error) {
    console.error('[union-workspace] apply preset failed:', String(error))
  }
}

export const apply = mountOnce('dsh-union-workspace', applyImpl)

function applyImpl(ctx: Context, config?: Config): void {
  const resolve = (): Config => ({
    announceToAgent: config?.announceToAgent ?? DEFAULT_ANNOUNCE,
    enabled: config?.enabled ?? true,
  })

  // Resolve optional services at runtime (types not published to npm).
  const fs = ctx.get('fs') as FileSystem | undefined
  const shell = ctx.get('shell') as ShellExecutor | undefined
  const permissionPresets = ctx.get('permissionPresets') as PermissionPresetService | undefined

  if (!fs || !shell) {
    console.error('[union-workspace] required services fs/shell not available')
    return
  }

  const store = new UnionStoreBackend(fs, shell)
  void store.discoverStorePath().then(() => store.load()).catch((error) => {
    console.error('[union-workspace] init failed:', String(error))
  })

  let disposeSection: (() => void) | undefined
  let disposeRoutes: (() => void) | undefined

  const sync = (): void => {
    if (disposeSection !== undefined) { disposeSection(); disposeSection = undefined }
    if (disposeRoutes !== undefined) { disposeRoutes(); disposeRoutes = undefined }
    const value = resolve()
    if (!value.enabled) return
    if (value.announceToAgent) {
      const systemPrompt = ctx.get('systemPrompt')
      if (systemPrompt !== undefined) {
        disposeSection = (systemPrompt as { section: (opts: { name: string; order: number; text: string }) => () => void }).section({
          name: 'plugin:union-workspace', order: SECTION_ORDER, text: UNION_GUIDANCE,
        })
      }
    }
    const routes = buildUnionRoutes({
      store,
      fs,
      permissionPresets: permissionPresets ?? { set: () => {} },
      workspaceRegistry: ctx.workspaceRegistry,
      getSession: (sessionId: string) => ctx.sessions.get(sessionId as never),
      isLoopback: isLoopbackRequest,
      applyPreset: (session, union) => {
        if (permissionPresets) applyPresetTo(session, union, permissionPresets)
      },
    })
    disposeRoutes = ctx.effect(
      () => {
        const disposers = routes.map((route) => ctx.webServer.register(route))
        return () => { for (const dispose of disposers.splice(0)) dispose() }
      },
      'union-workspace: routes',
    )
  }
  sync()

  ctx.events.on('agent/session-start', (payload: unknown) => {
    try {
      const p = payload as { agent?: { session?: { id: string } } }
      const session = p?.agent?.session
      if (!session || !permissionPresets) return
      const sid = session.id
      // If already marked, apply the preset and we're done.
      let union = store.unionOf(sid)
      if (!union) {
        // Not marked yet: try to auto-mark by matching the session's workspace
        // title to a union title. This handles sessions opened from the sidebar.
        const ws = ctx.workspaceRegistry.list().find((w) =>
          (w.sessionIds as readonly string[]).includes(sid as never),
        )
        if (ws) {
          const match = (store.unions as readonly Union[]).find((u) => u.title === ws.title)
          if (match) {
            store.mark(sid, match.id)
            union = match
          }
        }
      }
      if (union) applyPresetTo(session, union, permissionPresets)
    } catch (error) {
      console.error('[union-workspace] session-start handler failed:', String(error))
    }
  })
}