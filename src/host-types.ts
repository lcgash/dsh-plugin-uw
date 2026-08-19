/**
 * Local type declarations for host services that are available at runtime
 * but not published to npm (dsh-fs, dsh-shell, dsh-permission-presets).
 * These are used in the host half of the plugin.
 */

/** Minimal FileSystem interface. */
export interface FileSystem {
  resolve(path: string, opts?: { cwd?: string }): Promise<FsTarget>
  readText(target: FsTarget, signal?: AbortSignal): Promise<string>
  writeText(target: FsTarget, content: string, expected?: unknown, signal?: AbortSignal, sandboxPolicy?: { mode: string; workspaceRoot: string }): Promise<unknown>
  listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>
  stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>
}

export interface FsTarget {
  readonly path: string
}

export interface FsDirEntry {
  name: string
  type: 'file' | 'directory' | 'other'
  size?: number
}

export interface FsInfo {
  type: 'file' | 'directory' | 'symlink' | 'other'
  size?: number
}

/** Minimal ShellExecutor interface. */
export interface ShellExecutor {
  resolve(request: { command: string }): ShellExecSpec
  run(spec: ShellExecSpec): Promise<ShellRunResult>
}

export interface ShellExecSpec {
  command: string
  workdir: string
  timeoutMs: number
  stdoutMaxBytes: number
  sandboxPolicy: unknown
}

export interface CollectedOutput {
  text: string
  truncated: boolean
  spillPath?: string
}

export interface ShellRunResult {
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  aborted: boolean
  timeoutMs: number
  stdout: CollectedOutput
  stderr: CollectedOutput
}

/** Minimal PermissionPresetService interface. */
export interface PermissionPresetService {
  set(session: unknown, name: string): void
}