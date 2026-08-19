/**
 * Local type declarations for host services that are available at runtime
 * but not published to npm (dsh-fs, dsh-shell, dsh-permission-presets).
 * These are used in the host half of the plugin.
 */

/** Minimal FileSystem interface. */
export interface FileSystem {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>
  processPath(target: FsTarget): string
  contains(parent: FsTarget, child: FsTarget): boolean
  readText(target: FsTarget, signal?: AbortSignal): Promise<string>
  writeText(target: FsTarget, content: string, expected?: unknown, signal?: AbortSignal, sandboxPolicy?: { mode: string; workspaceRoot: string }): Promise<FsWriteOutcome>
  editText(target: FsTarget, edit: FsEditRequest, expected?: unknown, signal?: AbortSignal, sandboxPolicy?: { mode: string; workspaceRoot: string }): Promise<FsEditOutcome>
  listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>
  stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>
}

export interface FsTarget {
  readonly targetKey: string
  readonly displayPath: string
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

export interface FsWriteOutcome {
  operation: 'create' | 'update'
  version: string
  before: string | null
  after: string
}

export interface FsEditRequest {
  oldString: string
  newString: string
  replaceAll: boolean
}

export interface FsEditOutcome {
  operation: 'create' | 'update'
  version: string
  before: string
  after: string
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