/**
 * Self-contained tsdown preset for the dsh-union-workspace client bundle —
 * extracted from the dsh-web-ui monorepo's shared/tsdown.client.ts so this
 * package builds standalone. Emits a closure-factory artifact: the bundle
 * calls window.__ModuleLoader__.load ({id, factory}) and resolves externals
 * through the injected require (loader module table — cordis DI entities, no
 * globals, no import map). CSS Modules are compiled by lightningcss inside
 * the bundle: importing `x.module.css` yields the hashed class map, and the
 * css text auto-injects a <style data-plugin="<id>"> tag at factory
 * execution. The platform module list mirrors the shell's seed table.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** The module specifiers the shell shares into the frozen module table. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/**
 * Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline
 * (which requires @tsdown/css). The suffix matters: tsdown's guard matches ids
 * ending in `.css`, so the virtual id must not.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Wire/type layers a client bundle may inline (no shared runtime identity). */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/

/** Generated descriptor/codec contribution with no shared runtime identity. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/** Externals resolved from the loader module table. */
const CLIENT_EXTERNALS: readonly string[] = [
  ...PLATFORM_MODULES,
  '@deepseek-ai/dsh-client-runtime/client',
]

/** Package root (this file lives at the package root). */
const PACKAGE_ROOT = fileURLToPath(new URL('.', import.meta.url))

/** Rebase a physical path onto a package-relative id when it lives under the package. */
function packageRelativePath(physical: string): string {
  if (!isAbsolute(physical)) return physical
  const relativePath = relative(PACKAGE_ROOT, physical).split(sep).join('/')
  return relativePath.startsWith('../') ? physical : relativePath
}

/** Rebase a physical lib-relative source onto a browser URL mirroring the src tree. */
function browserSourcePath(source: string, sourcemapPath: string): string {
  if (!source.startsWith('.')) return source
  const physicalSource = resolvePath(dirname(sourcemapPath), source)
  return relative(PACKAGE_ROOT, physicalSource).split(sep).join('/')
}

interface ClientBundleOptions {
  /** Additional Node-side configs emitted alongside the package library. */
  readonly companions?: readonly UserConfig[]
  /** Overrides for the primary Node-side library config. */
  readonly lib?: UserConfig
  /** Extra Node-side externals (in addition to the default cordis entry). */
  readonly libExternal?: readonly (string | RegExp)[]
}

/**
 * Build the tsdown config for this plugin package: the node-half lib build
 * plus the browser client bundle.
 * @param id - plugin id (package name), stamped into the __ModuleLoader__.load
 * handoff and onto the injected style tags.
 * @param libEntry - node-half entries.
 * @param options - lib overrides and companion Node configs.
 * @returns the tsdown config for the current build face.
 */
export function clientBundle(
  id: string,
  libEntry: readonly string[],
  options: ClientBundleOptions = {},
): (inlineConfig: { env?: Record<string, string | undefined> }) => UserConfig[] {
  const lib = clientLibraryConfig(id, libEntry, options.lib, options.libExternal)
  return ({ env }) => {
    const face = env?.DSH_BUILD_FACE
    // Host-only plugins (no src/client entry) skip the browser face entirely.
    const hasClient = existsSync(resolvePath(process.cwd(), 'src/client/index.ts'))
    const client = hasClient ? clientConfig(id, 'src/client/index.ts') : undefined
    const node = [lib, ...(options.companions ?? [])]
    if (face === 'host') return node
    if (face === 'client') return client ? [client] : []
    return client ? [...node, client] : node
  }
}

function clientLibraryConfig(
  id: string,
  libEntry: readonly string[],
  overrides: UserConfig = {},
  extraExternal: readonly (string | RegExp)[] = [],
): UserConfig {
  return {
    name: id,
    entry: [...libEntry],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // The cordis framework resolves at runtime from the dsh profile tree.
    external: ['@deepseek-ai/cordis', ...extraExternal],
    ...overrides,
  }
}

function clientConfig(id: string, entry: string): UserConfig {
  return {
    name: `${id}/client`,
    entry: { client: entry },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    noExternal: (candidate: string) => (CLIENT_EXTERNALS.includes(candidate) ? undefined : true),
    plugins: [{
      // Bundle purity gate: platform seed entries stay external, inline-safe
      // wire layers inline, every other @deepseek-ai value import is an error.
      name: 'dsh-client-bundle-purity',
      resolveId(source: string) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (CLIENT_EXTERNALS.includes(source)) return null
        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null
        throw new Error(
          `client bundle purity: "${source}" is not a platform module, an inline-safe wire layer, or a generated /remote contribution — `
          + 'collaborate through cordis services (type-only imports are erased and never reach this gate)',
        )
      },
    }, {
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
        return CSS_VIRTUAL_PREFIX + packageRelativePath(abs) + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        const physical = isAbsolute(fileId) ? fileId : resolvePath(PACKAGE_ROOT, fileId)
        this.addWatchFile(physical)
        const source = await readFile(physical)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
          classMap[local] = exp.name
        }
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
          'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
          '  const tag = document.createElement(\'style\');',
          `  tag.dataset.plugin = ${JSON.stringify(id)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapPathTransform: browserSourcePath,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

/** Resolve an emitted JS asset import against its source-tree counterpart. */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = `${sep}lib${sep}types${sep}`
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}