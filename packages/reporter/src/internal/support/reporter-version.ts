import * as fs from 'node:fs';
import * as path from 'node:path';

let cachedVersion: string | null = null;

/**
 * Candidate locations of this package's own `package.json`, relative to a
 * directory inside the package. One level up covers the published, bundled
 * `dist/index.js` (tsup inlines this module flat under `dist/`); three levels
 * up covers running straight from `src/internal/support/` in dev/tests.
 */
const CANDIDATE_OFFSETS = ['..', '../../..'];

/**
 * Find this package's own `package.json` starting from `fromDir`, verifying
 * identity by name — not just presence — so a candidate offset that happens
 * to land on an unrelated `package.json` (e.g. a monorepo root) is never
 * mistaken for this package's. `root` is the directory holding it.
 */
export function findOwnPackageJson(fromDir: string): { version: string; root: string } | undefined {
  for (const offset of CANDIDATE_OFFSETS) {
    try {
      const pkgPath = path.resolve(fromDir, offset, 'package.json');
      const pkg: unknown = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const { name, version } = pkg as { name?: unknown; version?: unknown };
      if (name === '@piwitests/reporter' && typeof version === 'string')
        return { version, root: path.dirname(pkgPath) };
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

/** Read the reporter package's own version from `package.json`, memoized. Falls back to `'unknown'` if it can't be read (e.g. an unusual install layout). */
export function getReporterVersion(): string {
  if (cachedVersion) return cachedVersion;
  cachedVersion = findOwnPackageJson(__dirname)?.version ?? 'unknown';
  return cachedVersion;
}
