// Bundles the server into one file (dist/server.mjs) that runs on plain Node, without tsx.
import { build } from 'esbuild';

const r = await build({
  entryPoints: ['server/src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/server.mjs',
  sourcemap: true,
  // ws optionally speeds itself up with native add-ons; it works without them
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  metafile: true,
});
console.log(`dist/server.mjs ${(r.metafile.outputs['dist/server.mjs'].bytes / 1024).toFixed(1)} kB`);
