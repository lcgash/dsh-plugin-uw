/**
 * Platform-agnostic path helpers for union membership checks.
 *
 * Union member directories may be authored with either `/` (POSIX) or `\`
 * (Windows) separators, and the same is true for the paths being compared
 * against them. Comparing raw strings is therefore unreliable: on Windows the
 * old `path.startsWith(root + '/')` check can never match because paths use
 * `\`. To make containment checks correct on every platform, we canonicalize
 * both sides to a single separator before comparing.
 */

/** Collapse repeated separators and strip any trailing separator. */
function normalizePath(path: string): string {
  // Unify Windows and POSIX separators onto `/`.
  const unify = String(path).replace(/\\/g, '/')
  // Collapse duplicate separators (e.g. `a//b` or `a\\/b`) and drop trailing
  // separators so `D:\data` and `D:\data\` compare equal.
  return unify.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
}

/**
 * Whether `path` is `root` or a descendant of it (lexical, after separator
 * and trailing-slash normalization). Works for both `/` and `\` separators.
 */
export function isUnderPath(path: string, root: string): boolean {
  const p = normalizePath(path)
  const r = normalizePath(root)
  if (p === r) return true
  return p.startsWith(r + '/')
}

/** Basename of a path (works for both `/` and `\` separators). */
export function baseName(path: string): string {
  const p = normalizePath(path)
  const idx = p.lastIndexOf('/')
  return idx >= 0 ? p.slice(idx + 1) : p
}

/** Dirname of a path (works for both `/` and `\` separators). */
export function dirName(path: string): string {
  const p = normalizePath(path)
  const idx = p.lastIndexOf('/')
  return idx >= 0 ? p.slice(0, idx) : ''
}
