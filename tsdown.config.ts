/**
 * tsdown preset for @dsh-ext/dsh-package-manager: an ESM node half with two
 * loader rows (`index` core service, `web` route carrier) plus a browser half
 * (lib/client.js) wrapped for the harness client-plugin loader. cordis and
 * schemastery stay unbundled so the harness Loader validates Config against its
 * own instances; React and the client platform modules resolve from the web
 * shell's frozen module table.
 */
import type { UserConfig } from 'tsdown'

const PLUGIN_ID = '@dsh-ext/dsh-package-manager'

const CLIENT_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
]

export default [
  {
    entry: { index: 'src/index.ts', web: 'src/web.ts', tools: 'src/tools.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    deps: {
      neverBundle: [
        '@deepseek-ai/schemastery',
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-agent',
        '@deepseek-ai/dsh-llm',
        '@deepseek-ai/dsh-session',
        '@deepseek-ai/dsh-subprocess',
        '@deepseek-ai/dsh-tools',
        '@deepseek-ai/dsh-workspace',
      ],
    },
  },
  {
    // Browser bundle: lib/client.js, served by the harness at /plugins/<id>/client.js.
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    deps: { neverBundle: [...CLIENT_EXTERNALS] },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: `return module.exports; } });`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
