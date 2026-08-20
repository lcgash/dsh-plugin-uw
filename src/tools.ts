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
import { rename, unlink } from 'node:fs/promises'
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
      text: 'UNION WORKSPACE: The primary directory (index 0) is your normal workspace root — use the standard `read` tool for it. For ADDITIONAL MEMBER directories (index > 0, the ones you added as extra members) use `uw_read`. Only use `uw_read` when the target is inside a member directory and the standard `read` tool cannot reach it.',
    })
    systemPrompt.section({
      name: 'tool:uw_write',
      order: 102,
      text: 'UNION WORKSPACE: The primary directory (index 0) is your normal workspace root — use the standard `write` tool for it. For ADDITIONAL MEMBER directories (index > 0) use `uw_write`. Only use `uw_write` when the target is inside a member directory — for the primary root the standard `write` tool is sufficient.',
    })
    systemPrompt.section({
      name: 'tool:uw_edit',
      order: 102,
      text: 'UNION WORKSPACE: The primary directory (index 0) is your normal workspace root — use the standard `edit` tool for it. For ADDITIONAL MEMBER directories (index > 0) use `uw_edit`. Only use `uw_edit` when the target is inside a member directory — for the primary root the standard `edit` tool is sufficient.',
    })
    systemPrompt.section({
      name: 'tool:uw_delete',
      order: 102,
      text: 'UNION WORKSPACE: The primary directory (index 0) is your normal workspace root — use standard shell commands (`rm`, `mv`) for it. For ADDITIONAL MEMBER directories (index > 0) use `uw_delete`. Only use `uw_delete` when the target is inside a member directory.',
    })
    systemPrompt.section({
      name: 'tool:uw_move',
      order: 102,
      text: 'UNION WORKSPACE: The primary directory (index 0) is your normal workspace root — use standard shell commands (`mv`) for it. For ADDITIONAL MEMBER directories (index > 0) use `uw_move`. Only use `uw_move` when the target is inside a member directory.',
    })
  }

  // ---- uw_read: read any member directory file ----
  tools.register(defineTool({
    name: 'uw_read',
    description: 'Read a file inside an ADDITIONAL MEMBER DIRECTORY of a union workspace. The primary directory (index 0) is your normal workspace root — use the standard `read` tool for it. Only use this when the file is inside a member directory (index > 0) that the standard `read` tool cannot reach.',
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
    description: 'Write a file into an ADDITIONAL MEMBER DIRECTORY of a union workspace. The primary directory (index 0) is your normal workspace root — use the standard `write` tool for it. Only use this when the target is inside a member directory (index > 0) that the standard `write` tool cannot reach.',
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
    description: 'Edit a file inside an ADDITIONAL MEMBER DIRECTORY of a union workspace. The primary directory (index 0) is your normal workspace root — use the standard `edit` tool for it. Only use this when the target is inside a member directory (index > 0) that the standard `edit` tool cannot reach.',
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

  // ---- uw_delete: delete a file inside a member directory ----
  tools.register(defineTool({
    name: 'uw_delete',
    description: 'Delete a file inside an ADDITIONAL MEMBER DIRECTORY of a union workspace. The primary directory (index 0) is your normal workspace root — use standard shell commands (`rm`) for it. Only use this when the target is inside a member directory (index > 0) that standard tools cannot reach.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to delete, absolute or relative to the current session cwd.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
        },
      },
      render: (args, value) => text([`Deleted file: ${value.path}`]),
    },
    async execute(args: { file_path: string }, exec: ToolRunContext) {
      const union = unionFor(store, exec)
      if (union === null) throw new Error('uw_delete: this session is not a union workspace')
      const member = memberForPath(union, args.file_path)
      if (member === null) {
        throw new Error(
          `uw_delete: "${args.file_path}" is outside every member directory of union "${union.title}". `
          + `Allowed member directories:\n${union.members.map((m) => `  - ${m}`).join('\n')}`,
        )
      }
      if (!writePolicyFor(union).allowWrite(member.index)) {
        throw new Error(
          `uw_delete: "${args.file_path}" is in member directory "${member.path}", which is read-only under the `
          + `"${union.preset}" preset. Switch the union to danger-full-access to enable deletes in this member.`,
        )
      }
      const cwd = exec.agent?.session.header.cwd
      const target = await fs.resolve(args.file_path, cwd === undefined ? undefined : { cwd })
      // The tool already validated containment in a member directory, so the
      // mutation bypasses the DSH sandbox fence entirely.
      await unlink(fs.processPath(target))
      return { path: target.displayPath }
    },
  }))

  // ---- uw_move: move or rename a file inside member directories ----
  tools.register(defineTool({
    name: 'uw_move',
    description: 'Move or rename a file inside an ADDITIONAL MEMBER DIRECTORY of a union workspace. The primary directory (index 0) is your normal workspace root — use standard shell commands (`mv`) for it. Only use this when the target is inside a member directory (index > 0) that standard tools cannot reach.',
    parameters: {
      source: { type: 'string', required: true, description: 'Current path to move from, absolute or relative to the current session cwd.' },
      destination: { type: 'string', required: true, description: 'Target path to move to, absolute or relative to the current session cwd.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          destination: { type: 'string', required: true },
        },
      },
      render: (args, value) => text([`Moved: ${value.source} -> ${value.destination}`]),
    },
    async execute(args: { source: string; destination: string }, exec: ToolRunContext) {
      const union = unionFor(store, exec)
      if (union === null) throw new Error('uw_move: this session is not a union workspace')
      const cwd = exec.agent?.session.header.cwd
      const srcTarget = await fs.resolve(args.source, cwd === undefined ? undefined : { cwd })
      const dstTarget = await fs.resolve(args.destination, cwd === undefined ? undefined : { cwd })

      const srcMember = memberForPath(union, fs.processPath(srcTarget))
      if (srcMember === null) {
        throw new Error(
          `uw_move: source "${args.source}" is outside every member directory of union "${union.title}". `
          + `Allowed member directories:\n${union.members.map((m) => `  - ${m}`).join('\n')}`,
        )
      }
      const dstMember = memberForPath(union, fs.processPath(dstTarget))
      if (dstMember === null) {
        throw new Error(
          `uw_move: destination "${args.destination}" is outside every member directory of union "${union.title}". `
          + `Allowed member directories:\n${union.members.map((m) => `  - ${m}`).join('\n')}`,
        )
      }
      if (!writePolicyFor(union).allowWrite(srcMember.index)) {
        throw new Error(
          `uw_move: source "${args.source}" is in member directory "${srcMember.path}", which is read-only under the `
          + `"${union.preset}" preset. Switch the union to danger-full-access to enable moves in this member.`,
        )
      }
      if (!writePolicyFor(union).allowWrite(dstMember.index)) {
        throw new Error(
          `uw_move: destination "${args.destination}" is in member directory "${dstMember.path}", which is read-only under the `
          + `"${union.preset}" preset. Switch the union to danger-full-access to enable moves in this member.`,
        )
      }
      // The tool already validated containment in a member directory, so the
      // mutation bypasses the DSH sandbox fence entirely.
      await rename(fs.processPath(srcTarget), fs.processPath(dstTarget))
      return { source: srcTarget.displayPath, destination: dstTarget.displayPath }
    },
  }))
}
