/**
 * Browser-side API client for the /api/dsh-union-workspace route family.
 * The only data access path the browser half uses — plain fetch, same origin.
 */
import {
  UW_API,
  type CurrentPathResult,
  type ListFilesPayload,
  type ListFilesResult,
  type ListResult,
  type MutateResult,
  type StatusResult,
  type SyncPayload,
} from '../protocol.ts'

/** Query-string helper. */
function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text === '' ? '' : '?' + text
}

async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${response.status}`
    throw new Error(message)
  }
  return body as T
}

/** The browser half's only data entry point. */
export class UnionApi {
  async list(): Promise<ListResult> {
    const response = await fetch(UW_API.list)
    return readJson<ListResult>(response)
  }

  async sync(payload: SyncPayload): Promise<MutateResult> {
    const response = await fetch(UW_API.sync, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return readJson<MutateResult>(response)
  }

  async ensurePrimary(unionId: string, sessionId?: string): Promise<MutateResult> {
    const response = await fetch(UW_API.ensurePrimary, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unionId, sessionId }),
    })
    return readJson<MutateResult>(response)
  }

  async mark(unionId: string, sessionId: string): Promise<MutateResult> {
    const response = await fetch(UW_API.mark, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unionId, sessionId }),
    })
    return readJson<MutateResult>(response)
  }

  async status(sessionId: string): Promise<StatusResult> {
    const response = await fetch(UW_API.status + query({ sessionId }))
    return readJson<StatusResult>(response)
  }

  async currentPath(sessionId: string): Promise<CurrentPathResult> {
    const response = await fetch(UW_API.currentPath + query({ sessionId }))
    return readJson<CurrentPathResult>(response)
  }

  async listFiles(payload: ListFilesPayload): Promise<ListFilesResult> {
    const response = await fetch(UW_API.listFiles, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return readJson<ListFilesResult>(response)
  }
}