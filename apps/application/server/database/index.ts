// Import SQLite drizzle for static type inference.
// At runtime the correct driver is selected based on PIWI_DATABASE_URL;
// TypeScript uses the SQLite types as the canonical reference throughout.
import { drizzle as sqliteDrizzle } from 'drizzle-orm/libsql/sqlite3';
import * as sqliteSchema from './schema.sqlite';
import { backfillProjectAssignments } from '#shared/handlers/project-assignments';
import { reclusterFailureFingerprints } from '#shared/handlers/failure-cluster-recluster';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

type DB = ReturnType<typeof sqliteDrizzle<typeof sqliteSchema>>;

/** The resolved database client returned by getDatabase(). Import this instead of re-deriving it locally. */
export type DbClient = Awaited<ReturnType<typeof getDatabase>>;

let db: DB;
let migrationPromise: Promise<void> | null = null;

// Detect which database backend to use
const databaseUrl = process.env.PIWI_DATABASE_URL;

/**
 * Which SQL dialect the runtime database speaks. Use this to guard
 * dialect-specific statements (PRAGMA, VACUUM) — the drizzle client is typed
 * against the SQLite API even when PostgreSQL is the actual backend.
 */
export function getDialect(): 'postgres' | 'sqlite' {
  return databaseUrl ? 'postgres' : 'sqlite';
}

/**
 * Kick off the trace-resource link backfill in the background. Detached on
 * purpose: the first run after upgrade may read many trace manifests, and
 * blocking startup on it would delay the first request. Per-resource cleanup
 * keeps its safe whole-project fallback until a project is fully indexed, so
 * running this lazily never risks a premature delete. Imported dynamically to
 * avoid a module cycle (the util imports this file for `getDatabase`).
 */
function backfillTraceResourceLinks(): void {
  void (async () => {
    try {
      const { backfillTraceBlobResources } = await import('../utils/trace-blobs');
      const indexed = await backfillTraceBlobResources(db);
      if (indexed > 0) console.log(`[Database] Trace-resource backfill indexed ${indexed} blob(s)`);
    } catch (err) {
      console.error('[Database] Trace-resource backfill failed:', err);
    }
  })();
}

/**
 * Compute the daily rollups of the runs already stored, once per instance,
 * without blocking startup. Recomputing is idempotent, so an interrupted
 * backfill simply runs again at the next start.
 */
function backfillAnalyticsRollups(): void {
  void (async () => {
    try {
      const { getAppSetting, setAppSetting } = await import('../utils/app-settings');
      const { backfillDailyRollups, ROLLUPS_BACKFILLED_SETTING } = await import('#shared/handlers/analytics/rollups');
      if (await getAppSetting(db as any, ROLLUPS_BACKFILLED_SETTING)) return;
      const cells = await backfillDailyRollups(db as any);
      await setAppSetting(db as any, ROLLUPS_BACKFILLED_SETTING, new Date().toISOString());
      if (cells > 0) console.log(`[Database] Analytics rollup backfill computed ${cells} cell(s)`);
    } catch (err) {
      console.error('[Database] Analytics rollup backfill failed:', err);
    }
  })();
}

export async function initDatabase() {
  if (!db) {
    if (databaseUrl) {
      // PostgreSQL path
      const { drizzle } = await import('drizzle-orm/postgres-js');
      const { migrate } = await import('drizzle-orm/postgres-js/migrator');
      const { default: postgres } = await import('postgres');

      const client = postgres(databaseUrl);
      const pgDb = drizzle(client);
      // Cast to the canonical SQLite DB type so callers retain typed query results
      db = pgDb as unknown as DB;

      migrationPromise = (async () => {
        try {
          const migrationsFolder = await resolveMigrationsFolder('migrations-pg');
          console.log(`[Database] Running PostgreSQL migrations from ${migrationsFolder}`);
          await migrate(pgDb, { migrationsFolder });
          console.log('[Database] PostgreSQL migrations completed successfully');
          // Backfill project assignments for existing users (idempotent)
          try {
            await backfillProjectAssignments(db as any);
            console.log('[Database] Project assignments backfill completed');
          } catch (bfErr) {
            console.error('[Database] Project assignments backfill failed:', bfErr);
          }
          try {
            const { updated, merged } = await reclusterFailureFingerprints(db as any);
            if (updated || merged) {
              console.log(`[Database] Failure-cluster re-fingerprinting: ${updated} updated, ${merged} merged`);
            }
          } catch (rcErr) {
            console.error('[Database] Failure-cluster re-fingerprinting failed:', rcErr);
          }
          backfillTraceResourceLinks();
          backfillAnalyticsRollups();
        } catch (error) {
          console.error('[Database] Migration error:', error);
          throw error;
        }
      })();
    } else {
      // SQLite path (default)
      const { migrate } = await import('drizzle-orm/libsql/migrator');
      const { pathToFileURL } = await import('url');

      if (!process.env.PIWI_DATABASE_PATH && !existsSync('.data')) {
        mkdirSync('.data');
      }

      const dbPath = process.env.PIWI_DATABASE_PATH || '.data/piwi.db';
      const absolutePath = resolve(dbPath);
      const dbUrl = pathToFileURL(absolutePath).href;
      const isFreshDatabase = !existsSync(absolutePath);

      // Create client with WAL mode for better concurrent read/write performance
      const { createClient } = await import('@libsql/client');
      const client = createClient({ url: dbUrl });
      if (isFreshDatabase) {
        // Must be set before the first table is created (a no-op on existing
        // databases unless a full VACUUM runs) — enables `PRAGMA
        // incremental_vacuum` to reclaim pages after bulk deletes.
        await client.execute('PRAGMA auto_vacuum=INCREMENTAL');
      }
      await client.execute('PRAGMA journal_mode=WAL');
      await client.execute('PRAGMA synchronous=NORMAL');
      // Enforce the ON DELETE actions declared in the schema. Delete paths
      // still remove child rows explicitly (see server/utils/retention.ts) so
      // behavior does not depend on this per-connection pragma.
      await client.execute('PRAGMA foreign_keys=ON');
      db = sqliteDrizzle(client, { schema: sqliteSchema });

      migrationPromise = (async () => {
        try {
          const migrationsFolder = await resolveMigrationsFolder('migrations');
          console.log(`[Database] Running SQLite migrations from ${migrationsFolder}`);
          await migrate(db, { migrationsFolder });
          console.log('[Database] SQLite migrations completed successfully');
          // Backfill project assignments for existing users (idempotent)
          try {
            await backfillProjectAssignments(db);
            console.log('[Database] Project assignments backfill completed');
          } catch (bfErr) {
            console.error('[Database] Project assignments backfill failed:', bfErr);
          }
          try {
            const { updated, merged } = await reclusterFailureFingerprints(db);
            if (updated || merged) {
              console.log(`[Database] Failure-cluster re-fingerprinting: ${updated} updated, ${merged} merged`);
            }
          } catch (rcErr) {
            console.error('[Database] Failure-cluster re-fingerprinting failed:', rcErr);
          }
          backfillTraceResourceLinks();
          backfillAnalyticsRollups();
        } catch (error) {
          console.error('[Database] Migration error:', error);
          throw error;
        }
      })();
    }
  }

  // Wait for migrations to complete before returning
  if (migrationPromise) {
    await migrationPromise;
    migrationPromise = null;
  }

  return db;
}

async function resolveMigrationsFolder(folderName: string): Promise<string> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Nitro sets import.meta.url to the server entry (.output/server/index.mjs),
  // so __dirname is the server output dir — migrations are a direct sibling folder.
  const candidates = [
    resolve(__dirname, `database/${folderName}`),
    // Fallback: when __dirname is the chunks/nitro/ subdirectory
    resolve(__dirname, `../../database/${folderName}`),
    // Development: source tree path (CWD = application/)
    resolve(process.cwd(), `server/database/${folderName}`),
    // Running from app root with .output present
    resolve(process.cwd(), `.output/server/database/${folderName}`),
    // Docker: CWD is /app but the app lives under /app/application/
    resolve(process.cwd(), `application/.output/server/database/${folderName}`),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  console.error(`[Database] Migrations folder not found. Tried:`);
  for (const candidate of candidates) {
    console.error(`  - ${candidate}`);
  }
  console.error(`[Database] __dirname: ${__dirname}`);
  console.error(`[Database] process.cwd(): ${process.cwd()}`);
  throw new Error(`Migrations folder not found: ${candidates[candidates.length - 1]}`);
}

export async function getDatabase() {
  if (!db) {
    return await initDatabase();
  }

  // Wait for migrations to complete if they're still running
  if (migrationPromise) {
    await migrationPromise;
    migrationPromise = null;
  }

  return db;
}
