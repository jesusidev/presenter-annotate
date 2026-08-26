import { build } from 'esbuild';

/**
 * Three outputs, one core.
 *
 *   core.js         ESM, for anything that wants the framework-free API
 *   react.js        ESM, React peer-dep left external
 *   embed.global.js IIFE, everything inlined, for a <script> tag on any page
 *
 * The embed is the only one that bundles its dependencies, because it lands on
 * a page that will not be running a bundler.
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

console.log('\n  built: dist/core.js, dist/react.js, dist/embed.global.js\n');
