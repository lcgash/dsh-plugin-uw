/**
 * Active-dictionary pick (document-language based, dsh-ssh precedent) bound
 * to the union-workspace interpolator. All copy lives in the locale
 * dictionaries.
 */
import { en, t, zh, type UnionKey } from './locales.ts'

/** Template values accepted by the interpolator. */
export type TranslateValues = Record<string, string | number>

/** Active dictionary, picked by the document language at call time. */
export function dictionary(): Record<string, string> {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? { ...en } : { ...zh }
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