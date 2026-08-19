/**
 * Standalone build config for the dsh-union-workspace plugin.
 *
 * Self-contained: node-half lib/ (host union store + /api/dsh-union-workspace
 * routes + preset application) plus the browser bundle lib/client.js
 * (closure-factory artifact for the GUI's __ModuleLoader__, CSS Modules
 * inlined with auto-injected <style data-plugin>). The client entry is
 * auto-detected at src/client/index.ts.
 */
import { clientBundle } from './tsdown.client.ts'

export default clientBundle('dsh-union-workspace', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-workspace',
    '@deepseek-ai/dsh-tools',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-scope',
    '@deepseek-ai/dsh-timeout',
  ],
})
