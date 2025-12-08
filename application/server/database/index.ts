import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import { existsSync, mkdirSync } from 'fs'

let db: ReturnType<typeof drizzle>

export function initDatabase() {
  if (!db) {
    if (!process.env.DATABASE_PATH && !existsSync('.data')) {
      mkdirSync('.data')
    }

    // Use environment variable or default to .data/playwright.db
    const dbPath = process.env.DATABASE_PATH || '.data/playwright.db'
    const sqlite = new Database(dbPath)
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
        flaky_tests INTEGER NOT NULL DEFAULT 0,
        report_path TEXT,
        report_size INTEGER,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      -- Check if old test_cases table exists (for migration)
      CREATE TABLE IF NOT EXISTS test_cases_old (
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

      -- New test_cases table - shared test definitions
      CREATE TABLE IF NOT EXISTS test_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      -- Test runs cases table - junction table with run-specific data
      CREATE TABLE IF NOT EXISTS test_runs_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_run_id INTEGER NOT NULL,
        test_case_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        duration INTEGER,
        error TEXT,
        retries INTEGER DEFAULT 0,
        line INTEGER,
        column INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (test_run_id) REFERENCES test_runs(id),
        FOREIGN KEY (test_case_id) REFERENCES test_cases(id)
      );

      -- Traces table
      CREATE TABLE IF NOT EXISTS traces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        test_runs_case_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (test_runs_case_id) REFERENCES test_runs_cases(id)
      );

      CREATE INDEX IF NOT EXISTS idx_test_runs_project_id ON test_runs(project_id);
      CREATE INDEX IF NOT EXISTS idx_test_cases_project_id ON test_cases(project_id);
      CREATE INDEX IF NOT EXISTS idx_test_cases_file_path_title ON test_cases(file_path, title);
      CREATE INDEX IF NOT EXISTS idx_test_runs_cases_test_run_id ON test_runs_cases(test_run_id);
      CREATE INDEX IF NOT EXISTS idx_test_runs_cases_test_case_id ON test_runs_cases(test_case_id);
      CREATE INDEX IF NOT EXISTS idx_traces_test_runs_case_id ON traces(test_runs_case_id);
    `)

    // Migrate old data if the old table has data and new tables are empty
    try {
      const oldTableCheck = sqlite.prepare('SELECT COUNT(*) as count FROM sqlite_master WHERE type=? AND name=?').get('table', 'test_cases_old') as { count: number }
      const newTableCheck = sqlite.prepare('SELECT COUNT(*) as count FROM test_cases').get() as { count: number }
      
      if (oldTableCheck && oldTableCheck.count > 0 && newTableCheck.count === 0) {
        // Check if old table has data
        const oldDataCheck = sqlite.prepare('SELECT COUNT(*) as count FROM test_cases_old').get() as { count: number }
        
        if (oldDataCheck.count > 0) {
          console.log('[Database] Migrating old test_cases data to new schema...')
          
          // Migration query: extract file path and line/column from location, group by project/file/title
          sqlite.exec(`
            -- First, create shared test cases from old data
            INSERT INTO test_cases (project_id, file_path, title, created_at, updated_at)
            SELECT DISTINCT 
              tr.project_id,
              CASE 
                WHEN tc.location IS NOT NULL THEN 
                  substr(tc.location, 1, instr(tc.location || ':', ':') - 1)
                ELSE 
                  'unknown'
              END as file_path,
              tc.title,
              tc.created_at,
              tc.created_at
            FROM test_cases_old tc
            JOIN test_runs tr ON tc.test_run_id = tr.id
            GROUP BY tr.project_id, file_path, tc.title;

            -- Then, create test_runs_cases linking runs to shared test cases
            INSERT INTO test_runs_cases (test_run_id, test_case_id, status, duration, error, retries, line, column, created_at)
            SELECT 
              tc_old.test_run_id,
              tc_new.id as test_case_id,
              tc_old.status,
              tc_old.duration,
              tc_old.error,
              tc_old.retries,
              CASE 
                WHEN tc_old.location IS NOT NULL AND instr(substr(tc_old.location, instr(tc_old.location, ':') + 1), ':') > 0 THEN
                  CAST(substr(substr(tc_old.location, instr(tc_old.location, ':') + 1), 1, instr(substr(tc_old.location, instr(tc_old.location, ':') + 1), ':') - 1) AS INTEGER)
                ELSE NULL
              END as line,
              CASE 
                WHEN tc_old.location IS NOT NULL AND instr(substr(tc_old.location, instr(tc_old.location, ':') + 1), ':') > 0 THEN
                  CAST(substr(substr(tc_old.location, instr(tc_old.location, ':') + 1), instr(substr(tc_old.location, instr(tc_old.location, ':') + 1), ':') + 1) AS INTEGER)
                ELSE NULL
              END as column,
              tc_old.created_at
            FROM test_cases_old tc_old
            JOIN test_runs tr ON tc_old.test_run_id = tr.id
            JOIN test_cases tc_new ON 
              tc_new.project_id = tr.project_id AND
              tc_new.title = tc_old.title AND
              tc_new.file_path = CASE 
                WHEN tc_old.location IS NOT NULL THEN 
                  substr(tc_old.location, 1, instr(tc_old.location || ':', ':') - 1)
                ELSE 
                  'unknown'
              END;

            -- Drop the old table after migration
            DROP TABLE test_cases_old;
          `)
          
          console.log('[Database] Migration completed successfully')
        }
      }
    } catch (error) {
      console.error('[Database] Migration error:', error)
      // Continue even if migration fails - the app should work with new data
    }
  }

  return db
}

export function getDatabase() {
  if (!db) {
    return initDatabase()
  }
  return db
}
