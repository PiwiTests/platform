import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';

const dataDir = mkdtempSync(join(tmpdir(), 'piwi-sqlite-connections-'));
delete process.env.PIWI_DATABASE_URL;
process.env.PIWI_DATABASE_PATH = join(dataDir, 'piwi.db');
const { getDatabase } = await import('../../server/database');

let db: Awaited<ReturnType<typeof getDatabase>>;

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  db = await getDatabase();
});

afterAll(() => {
  vi.restoreAllMocks();
  rmSync(dataDir, { recursive: true, force: true });
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Open a write transaction that inserts a project and stays open until `release` is called. */
async function holdTransaction(name: string) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let begun!: () => void;
  const inside = new Promise<void>((resolve) => (begun = resolve));
  const done = db.transaction(async (tx) => {
    await tx.insert(schema.projects).values({ name });
    begun();
    await released;
  });
  await inside;
  return { release, done };
}

/** Track a pending statement: `outcome` stays empty while it waits. */
function track(pending: Promise<unknown>) {
  const outcome: string[] = [];
  const settled = pending.then(
    () => outcome.push('done'),
    () => outcome.push('failed'),
  );
  return { outcome, settled };
}

async function projectNames() {
  const rows = await db.select({ name: schema.projects.name }).from(schema.projects);
  return rows.map((row) => row.name).sort();
}

describe('SQLite connections', () => {
  test('a write waits for an open transaction instead of failing with SQLITE_BUSY', async () => {
    const transaction = await holdTransaction('inside');
    const write = track(db.insert(schema.projects).values({ name: 'outside' }));
    await pause(50);
    expect(write.outcome).toEqual([]);

    transaction.release();
    await transaction.done;
    await write.settled;
    expect(write.outcome).toEqual(['done']);
    expect(await projectNames()).toEqual(['inside', 'outside']);
  });

  test('a second transaction waits for the first', async () => {
    const first = await holdTransaction('first');
    const second = track(db.transaction(async (tx) => tx.insert(schema.projects).values({ name: 'second' })));
    await pause(50);
    expect(second.outcome).toEqual([]);

    first.release();
    await first.done;
    await second.settled;
    expect(second.outcome).toEqual(['done']);
    expect(await projectNames()).toEqual(['first', 'inside', 'outside', 'second']);
  });

  test('a read runs beside an open transaction', async () => {
    const transaction = await holdTransaction('uncommitted');
    const read = track(db.select().from(schema.projects));
    await pause(50);
    expect(read.outcome).toEqual(['done']);

    transaction.release();
    await transaction.done;
  });

  test('the pragmas hold on the connection opened after a transaction', async () => {
    await db.transaction(async (tx) => tx.insert(schema.projects).values({ name: 'after' }));
    const [busyTimeout] = await db.all<{ timeout: number }>(sql`PRAGMA busy_timeout`);
    const [synchronous] = await db.all<{ synchronous: number }>(sql`PRAGMA synchronous`);
    const [foreignKeys] = await db.all<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`);
    const [journal] = await db.all<{ journal_mode: string }>(sql`PRAGMA journal_mode`);
    expect(busyTimeout?.timeout).toBe(5000);
    expect(synchronous?.synchronous).toBe(1);
    expect(foreignKeys?.foreign_keys).toBe(1);
    expect(journal?.journal_mode).toBe('wal');
  });
});
