/**
 * Browser runtime capture: the client services the union UI needs, handed in
 * once from apply() and read by every component. Kept module-level (pet
 * precedent) so components stay prop-free; the plugin is single-instance per
 * page by package-name dedup in the client module host.
 */
import type { ISessions, IWorkspaces } from '@deepseek-ai/dsh-client-runtime/client'
import { UnionApi } from './api.ts'

/** Captured browser runtime. */
export interface UnionRuntime {
  api: UnionApi
  workspaces: IWorkspaces | undefined
  sessions: ISessions | undefined
  /* Locale snapshot: reflects the user's language preference. */
  activeLocale: string
}

/** The live runtime (undefined until apply boots). */
export const runtime: UnionRuntime = {
  api: new UnionApi(),
  workspaces: undefined,
  sessions: undefined,
  activeLocale: 'zh',
}

/** Called once from the client apply with the resolved services. */
export function bindRuntime(
  workspaces: IWorkspaces | undefined,
  sessions: ISessions | undefined,
  locale?: { getLocale: () => { active: string }; subscribe: (fn: () => void) => () => void },
): void {
  runtime.workspaces = workspaces
  runtime.sessions = sessions
  if (locale !== undefined) {
    runtime.activeLocale = locale.getLocale().active
    locale.subscribe(() => { runtime.activeLocale = locale.getLocale().active })
  }
}

/** Connect a freshly ensured primary workspace and open its session. */
export async function openMarkedUnion(unionId: string): Promise<boolean> {
  try {
    const r = await runtime.api.ensurePrimary(unionId)
    if (!r?.ok || !r.workspaceId) return false
    if (runtime.workspaces === undefined || runtime.sessions === undefined) return false
    const sid = await runtime.workspaces.connectWorkspace(r.workspaceId as never)
    await runtime.api.mark(unionId, sid)
    runtime.sessions.open(sid)
    return true
  } catch {
    return false
  }
}