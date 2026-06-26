#!/usr/bin/env node
/**
 * Seeds the local dev SQLite database from the demo seed SQL.
 *
 * Usage (from application/):
 *   node scripts/seed-dev-from-demo.mjs
 *
 * The dev server must NOT be running while this script runs (DB lock).
 * The script is idempotent: existing rows are skipped on conflict.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createClient } = require('/home/user/platform/node_modules/@libsql/client');

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '../public/demo/seed.sql');
const dbPath = join(__dirname, '../.data/piwi.db');

const sql = readFileSync(sqlPath, 'utf8');
const db = createClient({ url: `file:${dbPath}` });

const statements = sql
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.startsWith('INSERT INTO'));

console.log(`Seeding ${statements.length} INSERT statements into ${dbPath}...`);
let ok = 0,
  skip = 0;
for (const stmt of statements) {
  // Use OR IGNORE to be idempotent
  const idempotent = stmt.replace(/^INSERT INTO/, 'INSERT OR IGNORE INTO');
  await db
    .execute(idempotent)
    .then(() => ok++)
    .catch((e) => {
      skip++;
      console.error(' skip:', e.message);
    });
}
console.log(`Done. ${ok} inserted, ${skip} skipped.`);
