/**
 * Browser runtime capture: the client services the union UI needs, handed in
 * once from apply() and read by every component. Kept module-level (pet
 * precedent) so components stay prop-free; the plugin is single-instance per
 * page by package-name dedup in the client module host.
 */
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { UnionApi } from './api.ts'

/** Captured browser runtime. */
export interface UnionRuntime {
  api: UnionApi
  workspaces: IWorkspaces | undefined
  /**
   * Cross-controller Workspace navigation and directory UI. DSH 0.1.7 moved
   * `connectWorkspace`/`pickDirectory` off `IWorkspaces` onto this service and
   * deleted the sessions service's `open`; selection is a view-owner concern.
   */
  uiWorkspace: UiWorkspace | undefined
  /* Locale snapshot: reflects the user's language preference. */
  activeLocale: string
}

/** The live runtime (undefined until apply boots). */
export const runtime: UnionRuntime = {
  api: new UnionApi(),
  workspaces: undefined,
  uiWorkspace: undefined,
  activeLocale: 'zh',
}

/** Called once from the client apply with the resolved services. */
export function bindRuntime(
  workspaces: IWorkspaces | undefined,
  uiWorkspace: UiWorkspace | undefined,
  locale?: { getLocale: () => { active: string }; subscribe: (fn: () => void) => () => void },
): void {
  runtime.workspaces = workspaces
  runtime.uiWorkspace = uiWorkspace
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
    const ui = runtime.uiWorkspace
    if (ui === undefined) return false
    const sid = await ui.connectWorkspace(r.workspaceId as never)
    await runtime.api.mark(unionId, sid)
    ui.openSession(sid)
    return true
  } catch {
    return false
  }
}