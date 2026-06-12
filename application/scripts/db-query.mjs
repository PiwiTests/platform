#!/usr/bin/env node
/**
 * Run a SQL query against the local SQLite database.
 * Usage: node scripts/db-query.mjs <sql> [--json]
 *   <sql>   SQL query string (required)
 *   --json  Pretty-print results as JSON (optional)
 *
 * Examples:
 *   node scripts/db-query.mjs "SELECT id, name FROM projects"
 *   node scripts/db-query.mjs "SELECT COUNT(*) AS cnt FROM test_runs_cases" --json
 *   node scripts/db-query.mjs "SELECT browser FROM test_runs_cases WHERE browser LIKE '%Firefox%' LIMIT 3" --json
 */
import { createClient } from '@libsql/client'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = 'file:' + join(__dirname, '..', '.data', 'piwi.db')

const sql = process.argv[2]
const pretty = process.argv.includes('--json')

if (!sql) {
  console.error('Usage: node scripts/db-query.mjs <sql> [--json]')
  process.exit(1)
}

const db = createClient({ url: dbPath })

try {
  const result = await db.execute(sql)
  if (pretty) {
    console.log(JSON.stringify(result.rows, null, 2))
  } else {
    console.table(result.rows)
  }
} catch (e) {
  console.error('Query failed:', e.message)
  process.exit(1)
} finally {
  db.close()
}
