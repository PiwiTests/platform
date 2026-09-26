import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Ad blockers (uBlock Origin, AdGuard, the browsers' own) refuse requests whose address contains
// "analytics": the widgets would fetch nothing and the page would look broken. No route under
// server/api/ may carry the word, and no address the app requests may either.
const BLOCKED = /analytics/i;

// The two such routes 0.38 shipped, kept for scripts, which ad blockers never see.
const FORMER_PATHS = new Set(['analytics/[widget].get.ts', 'projects/[id]/selections/analytics.get.ts']);

const appRoot = fileURLToPath(new URL('../..', import.meta.url));

function walk(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

describe('no address the browser requests contains a word ad blockers refuse', () => {
  test('no API route carries the word, except the former paths kept for scripts', () => {
    const apiDir = join(appRoot, 'server/api');
    const routes = walk(apiDir, (p) => p.endsWith('.ts')).map((p) => relative(apiDir, p));
    const offending = routes.filter((route) => BLOCKED.test(route) && !FORMER_PATHS.has(route));
    expect(offending).toEqual([]);
    // The former paths are aliases: their handler is the new route's.
    for (const route of FORMER_PATHS) expect(readFileSync(join(apiDir, route), 'utf8')).toMatch(/deprecated: true/);
  });

  test('no request the app makes names the word in its address', () => {
    const sources = walk(join(appRoot, 'app'), (p) => /\.(vue|ts)$/.test(p) && !p.includes('/demo/'));
    // An `/api/…` string or template literal, up to its closing quote.
    const requests = /['"`](\/api\/[^'"`]*)['"`]/g;
    const offending: string[] = [];
    for (const file of sources) {
      for (const match of readFileSync(file, 'utf8').matchAll(requests)) {
        if (BLOCKED.test(match[1]!)) offending.push(`${relative(appRoot, file)}: ${match[1]}`);
      }
    }
    expect(offending).toEqual([]);
  });
});
