/**
 * Active-dictionary pick bound to the union-workspace interpolator. The
 * active locale comes from the dsh locale service (via the runtime capture),
 * which reflects the user's language preference — NOT the document lang,
 * which the dsh shell does not set. All copy lives in the locale dictionaries.
 */
import { runtime } from './runtime.ts'
import { en, t, zh, type UnionKey } from './locales.ts'

/** Template values accepted by the interpolator. */
export type TranslateValues = Record<string, string | number>

/** Active dictionary, picked by the dsh locale service at call time. */
export function dictionary(): Record<string, string> {
  const active = runtime.activeLocale?.toLowerCase() ?? 'zh'
  return active.startsWith('en') ? { ...en } : { ...zh }
}

/** Translate a key with optional {name} template params (current language). */
export function tt(key: UnionKey, values?: TranslateValues): string {
  return t(dictionary(), key, values)
}

/** Human-readable error text from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Alias used by components (props-less translate). */
export type Translate = (key: UnionKey, values?: TranslateValues) => string