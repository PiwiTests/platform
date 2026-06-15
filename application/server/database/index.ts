// Import SQLite drizzle for static type inference.
// At runtime the correct driver is selected based on PIWI_DATABASE_URL;
// TypeScript uses the SQLite types as the canonical reference throughout.
import { drizzle as sqliteDrizzle } from 'drizzle-orm/libsql/sqlite3';
import * as sqliteSchema from './schema.sqlite';
import { existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

type DB = ReturnType<typeof sqliteDrizzle<typeof sqliteSchema>>;

let db: DB;
let migrationPromise: Promise<void> | null = null;

// Detect which database backend to use
const databaseUrl = process.env.PIWI_DATABASE_URL;

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

      // Create client with WAL mode for better concurrent read/write performance
      const { createClient } = await import('@libsql/client');
      const client = createClient({ url: dbUrl });
      await client.execute('PRAGMA journal_mode=WAL');
      await client.execute('PRAGMA synchronous=NORMAL');
      db = sqliteDrizzle(client, { schema: sqliteSchema });

      migrationPromise = (async () => {
        try {
          const migrationsFolder = await resolveMigrationsFolder('migrations');
          console.log(`[Database] Running SQLite migrations from ${migrationsFolder}`);
          await migrate(db, { migrationsFolder });
          console.log('[Database] SQLite migrations completed successfully');
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
