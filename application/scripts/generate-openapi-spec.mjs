/**
 * Generate _openapi.json static spec file.
 *
 * Starts a temporary dev server, fetches the auto-generated OpenAPI 3.1 spec
 * at /_openapi.json (built by Nitro from server handler meta annotations),
 * and saves it to public/_openapi.json so the demo SPA build has a static
 * copy to serve.
 *
 * Usage: node scripts/generate-openapi-spec.mjs
 */

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outputPath = resolve(root, 'public/_openapi.json');

const PORT = 3099;
const MAX_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = 500;

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

const server = spawn('npx.cmd', ['nuxt', 'dev', '--port', String(PORT)], {
  cwd: root,
  stdio: 'pipe',
  shell: true,
  env: { ...process.env, PIWI_BUILD_DIR: '.nuxt-spec-gen' },
});

try {
  console.log('[gen-spec] Starting dev server...');

  let output = '';
  server.stdout.on('data', (d) => {
    output += d.toString();
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('Local:') && line.includes(String(PORT))) {
        // Signal readiness via output
      }
    }
  });
  server.stderr.on('data', (d) => {
    output += d.toString();
  });

  await waitForServer(`http://localhost:${PORT}/_openapi.json`, MAX_WAIT_MS);

  console.log('[gen-spec] Server ready, fetching spec...');
  const res = await fetch(`http://localhost:${PORT}/_openapi.json`);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

  const spec = await res.json();
  writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf-8');
  console.log(`[gen-spec] Wrote ${outputPath} (${Object.keys(spec.paths).length} paths)`);
} finally {
  server.kill();
  console.log('[gen-spec] Done');
}
