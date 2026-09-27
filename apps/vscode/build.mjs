// Bundle the extension into dist/extension.cjs and ship the editor service's
// language server beside it, so nothing is installed in the user's project.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  outfile: 'dist/extension.cjs',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

mkdirSync('dist', { recursive: true });
copyFileSync(
  createRequire(import.meta.url).resolve('@piwitests/editor/server'),
  join('dist', 'piwi-language-server.cjs'),
);
