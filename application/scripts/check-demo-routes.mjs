/**
 * check-demo-routes.mjs
 *
 * Compares the real Nuxt server API routes (derived from file names under
 * server/api/) against the patterns registered in app/demo/api/router.ts.
 *
 * Run from the `application/` directory:
 *   node scripts/check-demo-routes.mjs
 *
 * Exits with code 1 if any server route is missing from the demo router and
 * is not on the INTENTIONALLY_EXCLUDED list below.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// ── Routes that are intentionally absent from the demo router ─────────────
//
// These are server-only write endpoints that don't make sense in a static
// client-side demo (no persistent server, no file system, no SCM access).
const INTENTIONALLY_EXCLUDED = new Set([
  'POST /api/auth/setup', // initial admin setup (server only)
  'POST /api/test-runs/submit', // bulk result submission (no server in demo)
  'POST /api/test-runs/upload', // multipart upload (no server in demo)
  'POST /api/test-runs/start', // alternate streaming start (server only)
  'POST /api/test-runs/:id/case-files', // file upload during live run (server only)
  'DELETE /api/tests/cleanup', // test-suite cleanup hook (server only)
  'POST /api/traces/check', // trace dedup check (server only)
]);

// ── Derive all server routes from the file system ────────────────────────

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      entries.push(...walk(full));
    } else {
      entries.push(full);
    }
  }
  return entries;
}

const serverApiDir = join(root, 'server', 'api');
const serverFiles = walk(serverApiDir);

const METHOD_RE = /\.(get|post|put|patch|delete)\.ts$/i;
const PARAM_RE = /\[([^\]]+)\]/g;

function fileToRoute(absPath) {
  const rel = absPath.slice(serverApiDir.length + 1).replace(/\\/g, '/');
  const methodMatch = rel.match(METHOD_RE);
  if (!methodMatch) return null;
  const method = methodMatch[1].toUpperCase();

  // Strip method suffix and .ts, then remove trailing /index
  let pathPart = rel.replace(METHOD_RE, '').replace(/\/index$/, '');

  // Convert [param] → :param
  pathPart = pathPart.replace(PARAM_RE, ':$1');

  // Convert [...rest] → :rest (catch-all)
  pathPart = pathPart.replace(/:\.\.\./g, ':');

  return `${method} /api/${pathPart}`;
}

const serverRoutes = serverFiles.map(fileToRoute).filter(Boolean).sort();

// ── Extract demo router patterns ──────────────────────────────────────────

const routerSrc = readFileSync(join(root, 'app', 'demo', 'api', 'router.ts'), 'utf-8');

// Pull every pattern literal from the routes array.
// e.g. /^\/api\/failure-clusters\/(\d+)$/ → extract the string between /…/
const PATTERN_RE = /pattern:\s*\/([^/].*?)\/(?:,|\s)/g;
const demoPatterns = [];
let m;
while ((m = PATTERN_RE.exec(routerSrc)) !== null) {
  demoPatterns.push(new RegExp(m[1]));
}

// Also extract methods to pair with patterns.
// We build [{ method, pattern }] by scanning the routes array lines.
// Extract method+pattern pairs.  Use the `s` flag so that `.*?` spans
// newlines — many route entries in the demo router write `method` and
// `pattern` on separate lines and the old single-line regex missed them.
const ROUTE_BLOCK_RE = /\{\s*method:\s*'(GET|POST|PUT|PATCH|DELETE)'.*?pattern:\s*(\/[^,]+\/)/gs;
const demoRoutes = [];
while ((m = ROUTE_BLOCK_RE.exec(routerSrc)) !== null) {
  demoRoutes.push({ method: m[1], pattern: new RegExp(m[2].slice(1, -1)) });
}

// ── Match each server route against the demo router ───────────────────────

// Build a test URL for each server route by substituting :param with 123.
function routeToTestPath(route) {
  return route.replace(/:[\w.]+/g, '123');
}

const missing = [];
const excluded = [];

for (const route of serverRoutes) {
  const [method, path] = route.split(' ');
  const testPath = routeToTestPath(path);
  const key = `${method} ${path}`;

  if (INTENTIONALLY_EXCLUDED.has(key)) {
    excluded.push(key);
    continue;
  }

  const matched = demoRoutes.some((r) => r.method === method && r.pattern.test(testPath));

  if (!matched) {
    missing.push(key);
  }
}

// ── Report ────────────────────────────────────────────────────────────────

console.log(`Server routes:  ${serverRoutes.length}`);
console.log(`Demo patterns:  ${demoRoutes.length}`);
console.log(`Excluded:       ${excluded.length}`);

if (missing.length === 0) {
  console.log('\n✓ All server routes are covered by the demo router.\n');
  process.exit(0);
} else {
  console.log(`\n✗ ${missing.length} server route(s) are missing from the demo router:\n`);
  for (const r of missing) {
    console.log(`  ${r}`);
  }
  console.log(`
Add these routes to app/demo/api/router.ts (and implement the handlers in
the appropriate app/demo/api/*.ts file), or add them to the
INTENTIONALLY_EXCLUDED set at the top of this script if they don't apply
in demo mode.\n`);
  process.exit(1);
}
