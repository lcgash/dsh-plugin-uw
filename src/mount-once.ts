/**
 * Host single-instance guard for union-workspace. The loader accepts a
 * standalone install of the package side by side with other plugin sources;
 * without this guard a second install would re-register the same webserver
 * routes and system-prompt sections and fail the boot. mountOnce makes the
 * second host apply a no-op for the lifetime of the first instance (the
 * browser half is already deduped by package name in the client module host).
 *
 * The registry rides a global symbol so two module instances of the same
 * package (npm copy vs repository link) still share one verdict. cordis
 * `ctx.effect` runs its callback immediately and treats the callback's
 * return value as the fiber disposer, so the unmarker is returned, not run.
 */

const MOUNTED = Symbol.for('dsh-union-workspace.mounted')

interface MountRegistry {
  [MOUNTED]?: Set<string>
}

function mountedSet(): Set<string> {
  const registry = globalThis as MountRegistry
  return (registry[MOUNTED] ??= new Set())
}

/**
 * Wrap a cordis plugin apply so the package runs at most once per process.
 * @param packageName - npm package identity shared by every install source.
 * @param fn - the original plugin apply.
 * @returns an apply of the same shape.
 */
export function mountOnce<T extends (...args: any[]) => unknown>(packageName: string, fn: T): T {
  return ((...args: unknown[]) => {
    const mounted = mountedSet()
    if (mounted.has(packageName)) return
    mounted.add(packageName)
    const ctx = args[0] as { effect?: (effect: () => unknown) => unknown } | undefined
    ctx?.effect?.(() => () => {
      mounted.delete(packageName)
    })
    return fn(...args)
  }) as T
}