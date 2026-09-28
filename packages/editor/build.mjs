// Bundle the language server into one file both editor clients ship:
// dist/piwi-language-server.cjs, CommonJS for Node 20 and later.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/piwi-language-server.cjs',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});
