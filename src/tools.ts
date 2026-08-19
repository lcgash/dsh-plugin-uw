/**
 * Member-directory filesystem tools for union-workspace sessions.
 *
 * These tools let the agent read and write files inside the member
 * directories of a union workspace, bypassing the DSH sandbox's single-root
 * `workspace-write` boundary. Each tool performs its OWN whitelist check:
 * the target path must resolve inside one of the union's member directories
 * (and, for writes, the preset must allow it), so no unrelated directory
 * outside the members is ever exposed.
 *
 * Security model: the tool is trusted code over a model-controlled path. The
 * whitelist is enforced against the RESOLVED canonical path (symlinks
 * resolved), mirroring the fs-sandbox's canonicalize-then-contain stance.
 * Because the tool already validated containment, it passes a
 * `danger-full-access` sandbox policy to `ctx.fs` for the actual mutation —
 * the tool's own check IS the authorization, and the bare DSH sandbox fence
 * would otherwise deny every write outside the single workspace root.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { realpathSync } from 'node:fs'
import type { FileSystem } from './host-types.ts'
import type { Union } from './protocol.ts'
import type { UnionStoreBackend } from './store.ts'

/** Policy describing which members a union's preset allows writing to. */
interface UnionWritePolicy {
  /** Allowed to write the given member directory index. */
  allowWrite(memberIndex: number): boolean
}

/** The write policy for a union by preset. */
function writePolicyFor(union: Union): UnionWritePolicy {
  if (union.preset === 'danger-full-access') {
    return { allowWrite: () => true }
  }
  // workspace-write: all member directories are writable via uw_write/uw_edit.
  // The tools already validate containment in a member directory, so the
  // sandbox single-root restriction does not apply.
  return { allowWrite: () => true }
}

/** Normalize a path (remove trailing slashes). */
function norm(path: string): string {
  return path.replace(/\/+$/, '')
}

/** Whether `path` is `root` or a descendant of it (lexical, after trailing-slash normalization). */
function isUnder(path: string, root: string): boolean {
  const p = norm(path)
  const r = norm(root)
  if (p === r) return true
  return p.startsWith(r + '/')
}

/** The union attached to the calling session, or null when not a union session. */
function unionFor(store: UnionStoreBackend, exec: ToolRunContext): Union | null {
  const session = exec.agent?.session
  if (session === undefined) return null
  return store.unionOf(String(session.id)) ?? null
}

/** One member of a union whose canonical path is under `path`. */
interface MemberMatch {
  /** The member's index in the union. */
  index: number
  /** The member's absolute path (as configured). */
  path: string
}

/**
 * Find the member directory whose canonical realpath contains `path`'s
 * canonical realpath. Returns null when `path` is outside every member.
 */
function memberForPath(union: Union, path: string): MemberMatch | null {
  // Resolve the requested path's realpath first; the members' configured
  // paths are already assumed canonical (they come from the directory picker
  // or manual entry). Resolving both would be ideal, but the members may not
  // exist yet for a read of a to-be-created file — so we compare the resolved
  // target against the members lexically with canonical containment.
  const resolved = realpathOrRaw(path)
  for (let i = 0; i < union.members.length; i++) {
    const member = union.members[i]
    if (isUnder(resolved, member) || isUnder(resolved, realpathOrRaw(member))) {
      return { index: i, path: member }
    }
  }
  return null
}

/** Resolve a path's canonical realpath, falling back to the raw path when it does not exist yet. */
function realpathOrRaw(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/** Text output block helper. */
function text(parts: string[]): ContentBlock[] {
  return [{ type: 'text', text: parts.join('\n') }]
}

/**
 * Register the union-workspace member filesystem tools.
 * @param ctx - the plugin context; the tools service is read via `ctx.get`.
 * @param store - the persisted union store.
 * @param fs - the host filesystem service.
 */
export function applyUnionTools(ctx: Context, store: UnionStoreBackend, fs: FileSystem): void {
  // Resolve the optional tools service at registration time. We never touch
  // `ctx.tools` directly: `tools` is a lazy optional service in the host
  // profile (provided after this plugin's apply phase), and a static
  // `inject` entry would hard-couple our mount to it. `ctx.get` is the
  // documented non-inject read and returns undefined until the service is
  // provided.
  const tools = ctx.get('tools') as { register: (t: unknown) => () => void } | undefined
  if (tools === undefined) {
    console.warn('[union-workspace] tools service not available yet; skipping uw_read/uw_write/uw_edit registration')
    return
  }

  // Register system-prompt guidance sections for the uw_* tools.
  // The systemPrompt service is injected by ToolRuntime, so it should be
  // available when the tools service is available.
  const systemPrompt = ctx.get('systemPrompt') as { section: (opts: { name: string; order: number; text: string }) => () => void } | undefined
  if (systemPrompt !== undefined) {
    systemPrompt.section({
      name: 'tool:uw_read',
      order: 102,
      text: 'Use the `uw_read` tool to read files from member directories of a union workspace. It works like the standard `read` tool but can access every member directory (not just the primary workspace root). Only use it when the file is outside the primary workspace root — try `read` first, then `uw_read` if the standard tool reports a sandbox denial.',
    })
    systemPrompt.section({
      name: 'tool:uw_write',
      order: 102,
      text: 'Use the `uw_write` tool to write files into member directories of a union workspace. All member directories are writable via `uw_write` under both presets (the tool validates the target is inside a member). Only use `uw_write` when the target path is inside a member directory — for the primary workspace root the standard `write` tool is sufficient.',
    })
    systemPrompt.section({
      name: 'tool:uw_edit',
      order: 102,
      text: 'Use the `uw_edit` tool to edit files inside member directories of a union workspace. All member directories are editable via `uw_edit` under both presets (the tool validates the target is inside a member). Only use `uw_edit` when the target path is inside a member directory — for the primary workspace root the standard `edit` tool is sufficient.',
    })
  }

  // ---- uw_read: read any member directory file ----
  tools.register(defineTool({
    name: 'uw_read',
    description: 'Read a text file inside a member directory of the current union workspace. Use this when the standard `read` tool cannot reach a member directory (it is outside the primary workspace root).',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to read, absolute or relative to the current session cwd.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          content: { type: 'string', required: true },
        },
      },
      render: (args, value) => text([`<path>${value.path}</path>`, value.content]),
    },
    async execute(args: { file_path: string }, exec: ToolRunContext) {
      const union = unionFor(store, exec)
      if (union === null) throw new Error('uw_read: this session is not a union workspace')
      const member = memberForPath(union, args.file_path)
      if (member === null) {
        throw new Error(
          `uw_read: "${args.file_path}" is outside every member directory of union "${union.title}". `
          + `Allowed member directories:\n${union.members.map((m) => `  - ${m}`).join('\n')}`,
        )
      }
      const cwd = exec.agent?.session.header.cwd
      const target = await fs.resolve(args.file_path, cwd === undefined ? undefined : { cwd })
      const content = await fs.readText(target)
      return { path: target.displayPath, content }
    },
  }))

  // ---- uw_write: write a file into a union member ----
  tools.register(defineTool({
    name: 'uw_write',
    description: 'Write a UTF-8 text file into a member directory of the current union workspace. All member directories are writable under both presets. Only use `uw_write` when the target path is inside a member directory — for the primary workspace root the standard `write` tool is sufficient.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to write, absolute or relative to the current session cwd.' },
      content: { type: 'string', required: true, description: 'Full UTF-8 text content to write.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          operation: { type: 'string', required: true, enum: ['create', 'update'] },
        },
      },
      render: (args, value) => text([`<path>${value.path}</path>`, `${value.operation === 'create' ? 'Created' : 'Updated'} file`]),
    },
    async execute(args: { file_path: string; content: string }, exec: ToolRunContext) {
      const union = unionFor(store, exec)
      if (union === null) throw new Error('uw_write: this session is not a union workspace')
      const member = memberForPath(union, args.file_path)
      if (member === null) {
        throw new Error(
          `uw_write: "${args.file_path}" is outside every member directory of union "${union.title}". `
          + `Allowed member directories:\n${union.members.map((m) => `  - ${m}`).join('\n')}`,
        )
      }
      if (!writePolicyFor(union).allowWrite(member.index)) {
        throw new Error(
          `uw_write: "${args.file_path}" is in member directory "${member.path}", which is read-only under the `
          + `"${union.preset}" preset. Switch the union to danger-full-access to enable writes to this member.`,
        )
      }
      const cwd = exec.agent?.session.header.cwd
      const target = await fs.resolve(args.file_path, cwd === undefined ? undefined : { cwd })
      // The tool already validated containment in a member directory, so the
      // mutation bypasses the DSH sandbox fence entirely.
      const outcome = await fs.writeText(target, args.content, undefined, exec.signal, { mode: 'danger-full-access', workspaceRoot: '/' })
      return { path: target.displayPath, operation: outcome.operation }
    },
  }))

  // ---- uw_edit: edit a file into a union member ----
  tools.register(defineTool({
    name: 'uw_edit',
    description: 'Apply a literal text edit to a file inside a member directory of the current union workspace. All member directories are editable under both presets. Only use `uw_edit` when the target path is inside a member directory — for the primary workspace root the standard `edit` tool is sufficient.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to edit, absolute or relative to the current session cwd.' },
      old_string: { type: 'string', required: true, description: 'Literal text to replace. Must match exactly.' },
      new_string: { type: 'string', required: true, description: 'Literal replacement text.' },
      replace_all: { type: 'boolean', description: 'Replace every match instead of requiring exactly one.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          before: { type: 'string', required: true },
          after: { type: 'string', required: true },
        },
      },
      render: (args, value) => text([`<path>${value.path}</path>`, `Edited file (${value.before.length} -> ${value.after.length} chars)`]),
    },
    async execute(args: { file_path: string; old_string: string; new_string: string; replace_all?: boolean }, exec: ToolRunContext) {
      const union = unionFor(store, exec)
      if (union === null) throw new Error('uw_edit: this session is not a union workspace')
      const member = memberForPath(union, args.file_path)
      if (member === null) {
        throw new Error(
          `uw_edit: "${args.file_path}" is outside every member directory of union "${union.title}". `
          + `Allowed member directories:\n${union.members.map((m) => `  - ${m}`).join('\n')}`,
        )
      }
      if (!writePolicyFor(union).allowWrite(member.index)) {
        throw new Error(
          `uw_edit: "${args.file_path}" is in member directory "${member.path}", which is read-only under the `
          + `"${union.preset}" preset. Switch the union to danger-full-access to enable edits to this member.`,
        )
      }
      const cwd = exec.agent?.session.header.cwd
      const target = await fs.resolve(args.file_path, cwd === undefined ? undefined : { cwd })
      const outcome = await fs.editText(
        target,
        { oldString: args.old_string, newString: args.new_string, replaceAll: args.replace_all ?? false },
        undefined,
        exec.signal,
        { mode: 'danger-full-access', workspaceRoot: '/' },
      )
      return { path: target.displayPath, before: outcome.before, after: outcome.after }
    },
  }))
}
