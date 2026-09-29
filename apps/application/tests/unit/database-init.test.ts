import { afterAll, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'piwi-database-init-'));
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

test('opens and migrates the database once for callers that arrive together', async () => {
  delete process.env.PIWI_DATABASE_URL;
  process.env.PIWI_DATABASE_PATH = join(dataDir, 'piwi.db');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const { getDatabase } = await import('../../server/database');
    // The startup plugins and the first requests all ask for the database at once.
    const clients = await Promise.all([getDatabase(), getDatabase(), getDatabase()]);
    expect(new Set(clients).size).toBe(1);
    const runs = log.mock.calls.filter(([line]) => String(line).startsWith('[Database] Running SQLite migrations'));
    expect(runs).toHaveLength(1);
  } finally {
    log.mockRestore();
  }
});
