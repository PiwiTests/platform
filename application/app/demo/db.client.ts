/**
 * In-browser SQLite database for demo mode.
 *
 * Uses sql.js (SQLite compiled to WASM) and exposes a Drizzle ORM instance
 * via the sqlite-proxy driver so the same query code used on the server can
 * run unmodified in the browser.
 *
 * The SQLite database is kept in memory during the session and persisted to
 * IndexedDB so that changes survive page reloads.  On first load the database
 * is seeded from `public/demo/seed.sql`.
 *
 * This module is designed to work in both the browser main thread and in a
 * service worker context.  Call `configureDemoDb(baseUrl)` before the first
 * `getDemoDb()` call to set the base URL used to locate the WASM binary and
 * the seed SQL file.
 */

import type { Database as SqlJsDatabase } from 'sql.js';
import * as initSqlJsLib from 'sql.js';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import * as schema from '~~/server/database/schema.sqlite';

const initSqlJs = initSqlJsLib.default || initSqlJsLib;

type DemoDB = ReturnType<typeof drizzle<typeof schema>>;

// ── IndexedDB helpers ──────────────────────────────────────────────────────
const IDB_NAME = 'piwi-dashboard-demo';
const IDB_STORE = 'state';
const IDB_DB_KEY = 'sqlite';
const IDB_VERSION_KEY = 'seed-version';

function adoptConnection(db: IDBDatabase): IDBDatabase {
  // Auto-close when another context (window vs service worker) runs an
  // upgrade, otherwise its open request would stay blocked forever.
  db.onversionchange = () => {
    db.close();
    if (idbInstance === db) idbInstance = null;
  };
  return db;
}

function createStoreOnUpgrade(req: IDBOpenDBRequest): void {
  req.onupgradeneeded = () => {
    if (!req.result.objectStoreNames.contains(IDB_STORE)) {
      req.result.createObjectStore(IDB_STORE);
    }
  };
}

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // No explicit version: creates the DB at version 1 on first run and
    // opens whatever version exists otherwise.
    const req = indexedDB.open(IDB_NAME);
    createStoreOnUpgrade(req);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(IDB_STORE)) {
        resolve(adoptConnection(db));
        return;
      }
      // The DB exists but the store is missing: Firefox can leave an empty
      // database behind when the initial upgrade transaction is interrupted.
      // Re-open with a bumped version so onupgradeneeded fires and heals it.
      const retry = indexedDB.open(IDB_NAME, db.version + 1);
      db.close();
      createStoreOnUpgrade(retry);
      retry.onblocked = () => console.warn('[Demo DB] store repair blocked by another open connection');
      retry.onerror = () => reject(retry.error);
      retry.onsuccess = () => resolve(adoptConnection(retry.result));
    };
  });
}

function idbGet(idb: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(idb: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(idb: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Module-level singletons ───────────────────────────────────────────────
let sqliteDb: SqlJsDatabase | null = null;
let drizzleDb: DemoDB | null = null;
let initPromise: Promise<void> | null = null;
let idbInstance: IDBDatabase | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let cachedStoredVersion: string | null = null;

/**
 * Base URL used to locate the WASM binary and seed SQL (without trailing
 * slash).  Defaults to '/' but should be overridden via `configureDemoDb`
 * before the first `getDemoDb()` call.
 */
let demoDbBaseUrl: string = '/';

/**
 * Set the base URL for the demo database assets (WASM binary and seed SQL).
 * Must be called before the first `getDemoDb()`.
 *
 * In the browser main thread, pass `config.app.baseURL` from `useRuntimeConfig()`.
 * In a service worker, pass the directory URL derived from `self.location.href`.
 */
export function configureDemoDb(baseUrl: string): void {
  demoDbBaseUrl = baseUrl;
}

async function doPersist(): Promise<void> {
  if (!sqliteDb) {
    console.warn('[Demo DB] doPersist called but db not ready – skipping');
    return;
  }
  const data = sqliteDb.export();
  // The connection may have been closed by a versionchange from another
  // context; reopen on demand.
  idbInstance ??= await openIDB();
  await idbPut(idbInstance, IDB_DB_KEY, data);
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(doPersist, 500);
}

async function initialize(): Promise<void> {
  const base = demoDbBaseUrl.replace(/\/$/, '');

  const SQL = await initSqlJs({
    locateFile: (file: string) => `${base}/demo/${file}`,
  });

  idbInstance = await openIDB();
  const savedData = (await idbGet(idbInstance, IDB_DB_KEY)) as Uint8Array | undefined | null;

  if (savedData instanceof Uint8Array && savedData.length > 0) {
    // Restore persisted database
    sqliteDb = new SQL.Database(savedData);
    // Read previously stored seed version
    const v = await idbGet(idbInstance, IDB_VERSION_KEY);
    cachedStoredVersion = typeof v === 'string' ? v : null;
  } else {
    // First run: seed from the static SQL dump
    const resp = await fetch(`${base}/demo/seed.sql`);
    if (!resp.ok) {
      throw new Error(`[Demo] Failed to load seed.sql: ${resp.status} ${resp.statusText}`);
    }
    const seedSql = await resp.text();
    sqliteDb = new SQL.Database();
    sqliteDb.run(seedSql);
    await doPersist();

    // Fetch the seed version hash and persist it alongside the database
    const versionResp = await fetch(`${base}/demo/seed.version.json`);
    if (versionResp.ok) {
      const versionInfo = (await versionResp.json()) as { hash?: string };
      if (versionInfo.hash) {
        cachedStoredVersion = versionInfo.hash;
        await idbPut(idbInstance, IDB_VERSION_KEY, cachedStoredVersion);
      }
    }
  }

  drizzleDb = drizzle(
    async (sql, params, method) => {
      try {
        if (method === 'run') {
          sqliteDb!.run(sql, params as import('sql.js').BindParams);
          schedulePersist();
          return { rows: [] };
        }

        // 'all' or 'get'
        const stmt = sqliteDb!.prepare(sql);
        stmt.bind(params as import('sql.js').BindParams);
        const rows: unknown[][] = [];
        while (stmt.step()) {
          rows.push(stmt.get() as unknown[]);
        }
        stmt.free();
        return { rows };
      } catch (e) {
        console.error('[Demo DB] query error', e, '\nSQL:', sql, '\nParams:', params);
        throw e;
      }
    },
    { schema },
  );
}

/**
 * Returns the singleton in-browser Drizzle instance, initialising it on
 * first call (fetching the seed SQL and opening IndexedDB).
 */
export async function getDemoDb(): Promise<DemoDB> {
  if (!initPromise) {
    initPromise = initialize().catch((e) => {
      initPromise = null;
      throw e;
    });
  }
  await initPromise;
  return drizzleDb!;
}

/**
 * Returns the seed version hash stored alongside the demo database in
 * IndexedDB.  Returns `null` if no version has been persisted yet (e.g.
 * first load or legacy data from before version tracking was added).
 *
 * Callers can compare this value against the current build's version
 * (e.g. `runtimeConfig.public.demoDataVersion`) to detect stale data.
 */
export async function getStoredDemoVersion(): Promise<string | null> {
  if (cachedStoredVersion !== null) return cachedStoredVersion;
  // Open IDB independently if not yet initialized
  idbInstance ??= await openIDB();
  const v = await idbGet(idbInstance, IDB_VERSION_KEY);
  cachedStoredVersion = typeof v === 'string' ? v : null;
  return cachedStoredVersion;
}

/**
 * Wipes the persisted database from IndexedDB so the next call to
 * getDemoDb() re-seeds from the original seed.sql.
 */
export async function resetDemoDb(): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  sqliteDb?.close();
  sqliteDb = null;
  drizzleDb = null;
  initPromise = null;
  cachedStoredVersion = null;
  if (idbInstance) {
    await idbDelete(idbInstance, IDB_DB_KEY);
    await idbDelete(idbInstance, IDB_VERSION_KEY);
    idbInstance.close();
    idbInstance = null;
  }
}
