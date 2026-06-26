import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PIWI_ENV_VARS, type PiwiEnvVarName } from '../../shared/piwi-env-vars';

const ROOT = resolve(__dirname, '../..');

/** Recursively collect files under a dir, skipping build/dep folders. */
function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.data', '.output', 'dist', '.nuxt', '.test-temp'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectFiles(full, out);
    else if (/\.(ts|mjs|js|vue|example)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every PIWI_* name literally referenced in the application source. */
function referencedEnvVars(): Set<string> {
  const files = [
    ...collectFiles(join(ROOT, 'shared')),
    ...collectFiles(join(ROOT, 'server')),
    ...collectFiles(join(ROOT, 'app')),
    join(ROOT, 'nuxt.config.ts'),
    join(ROOT, '.env.example'),
  ];
  const re = /\bPIWI_[A-Z0-9]+(?:_[A-Z0-9]+)*\b/g;
  const names = new Set<string>();
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) names.add(m[0]);
  }
  return names;
}

describe('PIWI_ENV_VARS registry', () => {
  test('every entry has a non-empty description and valid category', () => {
    for (const [name, meta] of Object.entries(PIWI_ENV_VARS)) {
      expect(meta.description.length, `${name} description`).toBeGreaterThan(0);
      expect(meta.category.length, `${name} category`).toBeGreaterThan(0);
    }
  });

  test('covers every PIWI_* env var referenced in the application', () => {
    const referenced = referencedEnvVars();
    const registered = new Set(Object.keys(PIWI_ENV_VARS) as PiwiEnvVarName[]);
    // The reporter package owns its own env map; ignore the ingestion vars it
    // also reads (they overlap with AI/auth vars already registered here).
    const missing = [...referenced].filter((v) => !registered.has(v as PiwiEnvVarName));
    // Allow literal prefix strings used in dynamic env construction, plus the
    // registry/identifier names that happen to start with PIWI_ but are not env
    // vars (this registry's own constant, and the reporter's PIWI_ENV_KEYS map
    // referenced in comments).
    const knownFalsePositives = new Set(['PIWI_AI', 'PIWI_AI_MAX', 'PIWI_ENV_VARS', 'PIWI_ENV_KEYS']);
    const realMissing = missing.filter((v) => !knownFalsePositives.has(v));
    expect(realMissing.sort()).toEqual([]);
  });
});
