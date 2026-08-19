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
import { applyUnionTools } from './tools.ts'
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

export const UNION_GUIDANCE = '本机已安装 dsh-union-workspace 插件(联合工作区):在设置页或会话输入 / 选中「uw」可把多个目录合并进一个会话(主目录+成员目录,至少 2 个);已联合的会话会应用所选权限预设,并可在会话头部右侧打开成员目录文件列表面板。读/写成员目录时请使用 uw_read / uw_write / uw_edit 工具(标准 read/write/edit 工具受沙箱限制只能访问主目录);其中 uw_write / uw_edit 在 workspace-write 预设下只允许写主目录,写成员目录需切到 danger-full-access。用户提到「联合工作区 / 成员目录 / uw」时即指本插件,请据此协作。'

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
        disposeSection = (systemPrompt as { section: (opts: { name: string; order: number; text: string | ((context: unknown) => string) }) => () => void }).section({
          name: 'plugin:union-workspace',
          order: SECTION_ORDER,
          text: (context: unknown) => {
            // When the assembly context has an agent (augmented by dsh-agent),
            // check if the session belongs to a union and inject the member
            // directory list so the model knows which paths are available.
            const agent = (context as { agent?: { session?: { id: string } } }).agent
            if (agent) {
              const sessionId = agent.session?.id
              if (sessionId) {
                const union = store.unionOf(sessionId)
                if (union) {
                  return '本机已安装 dsh-union-workspace 插件(联合工作区)，当前会话已启用联合工作区「'
                    + union.title + '」。成员目录:\n'
                    + union.members.map((m, i) => `  ${i === 0 ? '[主目录]' : '[成员]'} ${m}`).join('\n')
                    + '\n\n读/写成员目录时请使用 uw_read / uw_write / uw_edit 工具'
                    + '(标准 read/write/edit 工具受沙箱限制只能访问主目录);'
                    + '其中 uw_write / uw_edit 在 workspace-write 预设下只允许写主目录,'
                    + '写成员目录需切到 danger-full-access。'
                    + '用户提到「联合工作区 / 成员目录 / uw」时即指本插件,请据此协作。'
                }
              }
            }
            return UNION_GUIDANCE
          },
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

    // Register member-directory filesystem tools (uw_read, uw_write, uw_edit)
    // when the tools service is available.
    const toolsService = ctx.get('tools') as { register: (t: unknown) => () => void } | undefined
    if (toolsService !== undefined && fs) {
      ctx.effect(
        () => {
          applyUnionTools(ctx, store, fs)
          return () => {}
        },
        'union-workspace: tools',
      )
    }
  }
  sync()

  ctx.events.on('agent/session-start', (payload: unknown) => {
    try {
      const p = payload as { agent?: { session?: { id: string; header?: { cwd?: string } } } }
      const agentSession = p?.agent?.session
      if (!agentSession || !permissionPresets) return
      const sid = agentSession.id
      // If already marked, apply the preset and we're done.
      let union = store.unionOf(sid)
      if (!union) {
        // Not marked yet: try to auto-mark by matching the session's cwd to a
        // workspace path, then matching the workspace title to a union title.
        // We match by cwd rather than by sessionIds because the
        // agent/session-start event fires BEFORE the session is attached to the
        // workspace (the API proxy calls attachSession after ensureSession).
        const cwd = agentSession.header?.cwd
        if (cwd) {
          const ws = ctx.workspaceRegistry.list().find((w) => w.path === cwd)
          if (ws) {
            const match = (store.unions as readonly Union[]).find((u) => u.title === ws.title)
            if (match) {
              store.mark(sid, match.id)
              union = match
            }
          }
        }
      }
      if (union) applyPresetTo(agentSession, union, permissionPresets)
    } catch (error) {
      console.error('[union-workspace] session-start handler failed:', String(error))
    }
  })
}
