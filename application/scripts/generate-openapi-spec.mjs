/**
 * Extract the OpenAPI spec from the built Nitro server using localCall.
 *
 * After `nuxt generate` builds the server to .output/server/index.mjs,
 * this script imports it and calls the internal /_openapi.json handler
 * directly — no HTTP server needed.
 *
 * Usage: node scripts/generate-openapi-spec.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outputDir = resolve(root, '.output');
const serverPath = resolve(outputDir, 'server/index.mjs');
const specOut = resolve(outputDir, 'public/_openapi.json');

let mod;
try {
  mod = await import(serverPath);
} catch (e) {
  console.error(`[gen-spec] Failed to import server bundle at ${serverPath}`);
  console.error(`[gen-spec] Make sure 'npm run app:generate:demo' has been run first.`);
  process.exit(1);
}

if (typeof mod.localCall !== 'function') {
  console.error(`[gen-spec] Server bundle does not export 'localCall'`);
  process.exit(1);
}

const res = await mod.localCall({ url: '/_openapi.json', method: 'GET' });
if (res.status !== 200) {
  console.error(`[gen-spec] Handler returned status ${res.status}`);
  process.exit(1);
}

const spec = JSON.parse(res.body);
writeFileSync(specOut, JSON.stringify(spec, null, 2), 'utf-8');
console.log(`[gen-spec] Wrote ${specOut} (${Object.keys(spec.paths).length} paths)`);
