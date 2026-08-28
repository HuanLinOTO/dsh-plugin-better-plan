/**
 * tsdown build for @huanlin/dsh-plugin-better-plan: the host half
 * (lib/index.js, ESM node) plus one browser client bundle (lib/client.js, CJS
 * closure factory).
 *
 * The client bundle replicates the official DSH client-bundle preset (mirror
 * of dsh-better-sidebar's tsdown config): externals resolve through the loader
 * module table at runtime (react + cordis + ui-primitives), everything else
 * inlines into the single bundle. The artifact registers itself via
 * window.__ModuleLoader__.load({id, factory}) with the (require) => exports
 * CJS closure shape.
 *
 * Types ship from `tsc -p` (tsconfig.json / tsconfig.client.json), not from
 * tsdown.
 */
import type { UserConfig } from 'tsdown'

/** Bundle id (= package name; the client-modules compose keys on it). */
const CLIENT_ID = '@huanlin/dsh-plugin-better-plan'

/** Module specifiers the web shell shares into the frozen module table. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-primitives/client',
]

/** The host-half build (lib/index.js, ESM node). */
const hostConfig: UserConfig = {
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: true,
}

/** The client bundle build (lib/client.js, CJS closure factory). */
const clientConfig: UserConfig = {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_ID)}, factory: (require) => {`,
    footer: `return module.exports; } });`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    // The CJS wrapper factory's `require` only resolves module-table entries;
    // disable code splitting so the single factory chunk stays self-contained.
    codeSplitting: false,
  },
}

export default [hostConfig, clientConfig] satisfies UserConfig[]
