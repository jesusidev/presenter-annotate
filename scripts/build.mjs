import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

/**
 * Three outputs, one core, plus types.
 *
 *   core.js         ESM, for anything that wants the framework-free API
 *   react.js        ESM, React peer-dep left external
 *   embed.global.js IIFE, everything inlined, for a <script> tag on any page
 *   types/          .d.ts, emitted by tsc — esbuild strips types, it cannot emit them
 *
 * The embed is the only one that bundles its dependencies, because it lands on
 * a page that will not be running a bundler.
 *
 * This runs as `prepare`, which means npm also runs it when someone installs
 * the package straight from the git URL. That is the only reason a git install
 * works at all: dist/ is not committed, so without this the package would
 * arrive with every one of its export paths pointing at nothing.
 */

const shared = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  logLevel: 'info',
};

await build({
  ...shared,
  entryPoints: ['src/core/index.ts'],
  outfile: 'dist/core.js',
});

await build({
  ...shared,
  entryPoints: ['src/bindings/react.tsx'],
  outfile: 'dist/react.js',
  // The host app brings its own React; bundling a second copy breaks hooks.
  external: ['react', 'react-dom'],
  jsx: 'automatic',
});

await build({
  ...shared,
  entryPoints: ['src/bindings/embed.ts'],
  outfile: 'dist/embed.global.js',
  format: 'iife',
  sourcemap: false,
  minify: true,
});

// tsconfig sets noEmit for the type-check script, so declarations are a
// separate pass with that turned back off.
execFileSync(
  'npx',
  [
    'tsc',
    '--declaration',
    '--emitDeclarationOnly',
    '--noEmit',
    'false',
    '--outDir',
    'dist/types',
    '--rootDir',
    'src',
  ],
  { stdio: 'inherit' }
);

console.log('\n  built: dist/core.js, dist/react.js, dist/embed.global.js, dist/types\n');
