import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { existsSync, mkdirSync } from 'fs'

let db: ReturnType<typeof drizzle>

export function initDatabase() {
  if (!db) {
    if (!existsSync('.data')) {
      mkdirSync('.data')
    }

    const sqlite = new Database('.data/playwright.db')
    db = drizzle(sqlite, { schema })

    // Create tables if they don't exist
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS test_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        duration INTEGER,
        total_tests INTEGER NOT NULL DEFAULT 0,
        passed_tests INTEGER NOT NULL DEFAULT 0,
        failed_tests INTEGER NOT NULL DEFAULT 0,
        skipped_tests INTEGER NOT NULL DEFAULT 0,
        report_path TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS test_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_run_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        location TEXT,
        status TEXT NOT NULL,
        duration INTEGER,
        error TEXT,
        retries INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (test_run_id) REFERENCES test_runs(id)
      );

      CREATE TABLE IF NOT EXISTS traces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_case_id INTEGER NOT NULL,
        trace_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (test_case_id) REFERENCES test_cases(id)
      );

      CREATE INDEX IF NOT EXISTS idx_test_runs_project_id ON test_runs(project_id);
      CREATE INDEX IF NOT EXISTS idx_test_cases_test_run_id ON test_cases(test_run_id);
      CREATE INDEX IF NOT EXISTS idx_traces_test_case_id ON traces(test_case_id);
    `)
  }

  return db
}

export function getDatabase() {
  if (!db) {
    return initDatabase()
  }
  return db
}
