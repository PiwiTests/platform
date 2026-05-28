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

import type { Database as SqlJsDatabase } from 'sql.js'
import * as initSqlJsLib from 'sql.js'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import * as schema from '~~/server/database/schema.sqlite'

const initSqlJs = initSqlJsLib.default || initSqlJsLib

type DemoDB = ReturnType<typeof drizzle<typeof schema>>

// ── IndexedDB helpers ──────────────────────────────────────────────────────
const IDB_NAME = 'playwright-dashboard-demo'
const IDB_STORE = 'state'
const IDB_DB_KEY = 'sqlite'

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = e => resolve((e.target as IDBOpenDBRequest).result)
    req.onerror = () => reject(req.error)
  })
}

function idbGet(idb: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbPut(idb: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function idbDelete(idb: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Module-level singletons ───────────────────────────────────────────────
let sqliteDb: SqlJsDatabase | null = null
let drizzleDb: DemoDB | null = null
let initPromise: Promise<void> | null = null
let idbInstance: IDBDatabase | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Base URL used to locate the WASM binary and seed SQL (without trailing
 * slash).  Defaults to '/' but should be overridden via `configureDemoDb`
 * before the first `getDemoDb()` call.
 */
let demoDbBaseUrl: string = '/'

/**
 * Set the base URL for the demo database assets (WASM binary and seed SQL).
 * Must be called before the first `getDemoDb()`.
 *
 * In the browser main thread, pass `config.app.baseURL` from `useRuntimeConfig()`.
 * In a service worker, pass the directory URL derived from `self.location.href`.
 */
export function configureDemoDb(baseUrl: string): void {
  demoDbBaseUrl = baseUrl
}

async function doPersist(): Promise<void> {
  if (!sqliteDb || !idbInstance) {
    console.warn('[Demo DB] doPersist called but db or IDB not ready – skipping')
    return
  }
  const data = sqliteDb.export()
  await idbPut(idbInstance, IDB_DB_KEY, data)
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(doPersist, 500)
}

async function initialize(): Promise<void> {
  const base = demoDbBaseUrl.replace(/\/$/, '')

  const SQL = await initSqlJs({
    locateFile: (file: string) => `${base}/demo/${file}`
  })

  idbInstance = await openIDB()
  const savedData = await idbGet(idbInstance, IDB_DB_KEY) as Uint8Array | undefined | null

  if (savedData instanceof Uint8Array && savedData.length > 0) {
    // Restore persisted database
    sqliteDb = new SQL.Database(savedData)
  } else {
    // First run: seed from the static SQL dump
    const resp = await fetch(`${base}/demo/seed.sql`)
    if (!resp.ok) {
      throw new Error(`[Demo] Failed to load seed.sql: ${resp.status} ${resp.statusText}`)
    }
    const seedSql = await resp.text()
    sqliteDb = new SQL.Database()
    sqliteDb.run(seedSql)
    await doPersist()
  }

  drizzleDb = drizzle(
    async (sql, params, method) => {
      try {
        if (method === 'run') {
          sqliteDb!.run(sql, params as import('sql.js').BindParams)
          schedulePersist()
          return { rows: [] }
        }

        // 'all' or 'get'
        const stmt = sqliteDb!.prepare(sql)
        stmt.bind(params as import('sql.js').BindParams)
        const rows: unknown[][] = []
        while (stmt.step()) {
          rows.push(stmt.get() as unknown[])
        }
        stmt.free()
        return { rows }
      } catch (e) {
        console.error('[Demo DB] query error', e, '\nSQL:', sql, '\nParams:', params)
        return { rows: [] }
      }
    },
    { schema }
  )
}

/**
 * Returns the singleton in-browser Drizzle instance, initialising it on
 * first call (fetching the seed SQL and opening IndexedDB).
 */
export async function getDemoDb(): Promise<DemoDB> {
  if (!initPromise) {
    initPromise = initialize().catch((e) => {
      initPromise = null
      throw e
    })
  }
  await initPromise
  return drizzleDb!
}

/**
 * Wipes the persisted database from IndexedDB so the next call to
 * getDemoDb() re-seeds from the original seed.sql.
 */
export async function resetDemoDb(): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  sqliteDb?.close()
  sqliteDb = null
  drizzleDb = null
  initPromise = null
  if (idbInstance) {
    await idbDelete(idbInstance, IDB_DB_KEY)
    idbInstance.close()
    idbInstance = null
  }
}
