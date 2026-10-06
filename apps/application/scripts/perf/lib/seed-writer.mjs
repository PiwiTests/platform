/**
 * Writes the dataset into a database a build has already migrated. Each insert
 * names only the columns the table has, so one dataset fills the schema of an
 * older build as well as the current one; a column the table lacks is skipped
 * with a warning, and a required column the dataset does not fill fails loudly.
 */

/** SQLite timestamp columns stored in milliseconds (`mode: 'timestamp_ms'`); the others are seconds. */
export const SQLITE_MS_TIMESTAMP_COLUMNS = new Set(['test_runs_cases.created_at']);

const SQLITE_MAX_PARAMS = 30_000;
const PG_MAX_PARAMS = 60_000;

const quote = (name) => `"${name.replaceAll('"', '""')}"`;

function sqliteValue(table, column, value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) {
    return SQLITE_MS_TIMESTAMP_COLUMNS.has(`${table}.${column}`) ? value.getTime() : Math.floor(value.getTime() / 1000);
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function pgValue(value) {
  if (value === undefined || value === null) return null;
  // Drizzle writes a `timestamp` column as an ISO string, which PostgreSQL reads as UTC wall time.
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

/** Group rows into INSERT statements of at most `maxParams` parameters. */
function* chunks(rows, columnCount, maxParams) {
  const size = Math.max(1, Math.floor(maxParams / Math.max(1, columnCount)));
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

function columnFilter(table, rows, existing, warned) {
  const wanted = Object.keys(rows[0]);
  const kept = wanted.filter((c) => existing.has(c));
  for (const c of wanted) {
    if (!existing.has(c) && !warned.has(`${table}.${c}`)) {
      warned.add(`${table}.${c}`);
      console.warn(`[perf] ${table}.${c} does not exist in this schema — skipped`);
    }
  }
  return kept;
}

/** A writer over a SQLite file, inside one transaction. */
export async function openSqliteWriter(path) {
  const { createClient } = await import('@libsql/client');
  const client = createClient({ url: `file:${path}` });
  await client.execute('PRAGMA foreign_keys=ON');
  const tx = await client.transaction('write');
  const columns = new Map();
  const warned = new Set();
  return {
    async insert(table, rows) {
      if (!columns.has(table)) {
        const info = await tx.execute(`PRAGMA table_info(${quote(table)})`);
        if (info.rows.length === 0) throw new Error(`table ${table} does not exist in this schema`);
        columns.set(table, new Set(info.rows.map((r) => String(r.name))));
      }
      const kept = columnFilter(table, rows, columns.get(table), warned);
      for (const batch of chunks(rows, kept.length, SQLITE_MAX_PARAMS)) {
        const placeholders = `(${kept.map(() => '?').join(',')})`;
        await tx.execute({
          sql: `INSERT INTO ${quote(table)} (${kept.map(quote).join(',')}) VALUES ${batch.map(() => placeholders).join(',')}`,
          args: batch.flatMap((row) => kept.map((c) => sqliteValue(table, c, row[c]))),
        });
      }
    },
    async run(statement) {
      await tx.execute(statement);
    },
    async finish() {
      await tx.commit();
      await client.execute('PRAGMA wal_checkpoint(TRUNCATE)');
      client.close();
    },
    abort() {
      tx.close();
      client.close();
    },
  };
}

/** A writer over a PostgreSQL database, inside one transaction; sequences and planner statistics follow. */
export async function openPostgresWriter(url) {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe('BEGIN');
  const columns = new Map();
  const warned = new Set();
  const inserted = new Set();
  return {
    async insert(table, rows) {
      if (!columns.has(table)) {
        const info =
          await sql`select column_name from information_schema.columns where table_schema = current_schema() and table_name = ${table}`;
        if (info.length === 0) throw new Error(`table ${table} does not exist in this schema`);
        columns.set(table, new Set(info.map((r) => r.column_name)));
      }
      const kept = columnFilter(table, rows, columns.get(table), warned);
      for (const batch of chunks(rows, kept.length, PG_MAX_PARAMS)) {
        let n = 0;
        const values = batch.map(() => `(${kept.map(() => `$${++n}`).join(',')})`).join(',');
        await sql.unsafe(
          `INSERT INTO ${quote(table)} (${kept.map(quote).join(',')}) VALUES ${values}`,
          batch.flatMap((row) => kept.map((c) => pgValue(row[c]))),
        );
      }
      inserted.add(table);
    },
    async run(statement) {
      await sql.unsafe(statement);
    },
    async finish() {
      for (const table of inserted) {
        if (!columns.get(table).has('id')) continue;
        await sql.unsafe(
          `SELECT setval(pg_get_serial_sequence('${quote(table)}', 'id'), COALESCE((SELECT MAX(id) FROM ${quote(table)}), 0) + 1, false)`,
        );
      }
      await sql.unsafe('COMMIT');
      // Statistics and a visibility map now, so autovacuum has nothing to do while the suite measures.
      await sql.unsafe('VACUUM (ANALYZE)');
      await sql.end();
    },
    async abort() {
      await sql.unsafe('ROLLBACK').catch(() => {});
      await sql.end();
    },
  };
}

/** Stream every batch of `batches` into `writer`; returns the dataset manifest. */
export async function writeDataset(writer, batches) {
  let manifest = null;
  try {
    for (const item of batches) {
      if (item.manifest) manifest = item.manifest;
      else await writer.insert(item.table, item.rows);
    }
    // A startup backfill recorded on the empty database would never see these runs.
    await writer.run(`DELETE FROM app_settings WHERE key = 'analytics_rollups_backfilled_at'`);
    await writer.finish();
  } catch (error) {
    await writer.abort();
    throw error;
  }
  return manifest;
}
