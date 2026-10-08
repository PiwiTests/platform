/**
 * The migrations that make `idx_users_email` ignore letter case
 * (`*_clear_duplicate_user_emails`, then the index on `lower(email)`): a
 * database migrated up to just before them holds accounts whose emails differ
 * only in case, then the rest of the migrations run as at startup.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

const SQLITE_MIGRATIONS = fileURLToPath(new URL('../../server/database/migrations', import.meta.url));
const POSTGRES_MIGRATIONS = fileURLToPath(new URL('../../server/database/migrations-pg', import.meta.url));
const DATA_MIGRATION = '_clear_duplicate_user_emails';

interface Journal {
  entries: { tag: string }[];
}

function readJournal(folder: string): Journal {
  return JSON.parse(readFileSync(join(folder, 'meta/_journal.json'), 'utf8')) as Journal;
}

/** The SQL of the data migration and of the migration right after it, which rebuilds the index. */
function migrationSql(folder: string): { clear: string; index: string } {
  const { entries } = readJournal(folder);
  const at = entries.findIndex((entry) => entry.tag.endsWith(DATA_MIGRATION));
  if (at < 0 || !entries[at + 1]) throw new Error(`no ${DATA_MIGRATION} migration followed by another in ${folder}`);
  const read = (tag: string) => readFileSync(join(folder, `${tag}.sql`), 'utf8');
  return { clear: read(entries[at]!.tag), index: read(entries[at + 1]!.tag) };
}

/**
 * Accounts whose emails differ only in letter case, as the migrations before
 * the cut allow, and the email and verified flag each one keeps.
 */
const ACCOUNTS: { id: number; email: string | null; verified: boolean; keeps: [string | null, boolean] }[] = [
  // An unverified older account gives the address up to the one that verified it.
  { id: 1, email: 'alice@example.com', verified: false, keeps: [null, false] },
  { id: 2, email: 'Alice@Example.com', verified: true, keeps: ['Alice@Example.com', true] },
  // Neither verified it: the oldest keeps it.
  { id: 3, email: 'bob@example.com', verified: false, keeps: ['bob@example.com', false] },
  { id: 4, email: 'BOB@example.com', verified: false, keeps: [null, false] },
  // Several verified it: the oldest of those keeps it.
  { id: 5, email: 'CAROL@example.com', verified: false, keeps: [null, false] },
  { id: 6, email: 'carol@example.com', verified: true, keeps: ['carol@example.com', true] },
  { id: 7, email: 'Carol@example.com', verified: true, keeps: [null, false] },
  // Addresses no other account holds are left alone.
  { id: 8, email: 'dave@example.com', verified: true, keeps: ['dave@example.com', true] },
  { id: 9, email: null, verified: false, keeps: [null, false] },
  { id: 10, email: null, verified: false, keeps: [null, false] },
];

const EXPECTED = ACCOUNTS.map(({ id, keeps: [email, verified] }) => ({ id, email, verified }));

describe('on SQLite', () => {
  let folderBefore: string;

  beforeAll(() => {
    // The migrations folder cut just before the data migration.
    const journal = readJournal(SQLITE_MIGRATIONS);
    const cut = journal.entries.findIndex((entry) => entry.tag.endsWith(DATA_MIGRATION));
    expect(cut).toBeGreaterThan(0);
    const entries = journal.entries.slice(0, cut);
    folderBefore = mkdtempSync(join(tmpdir(), 'piwi-user-emails-'));
    mkdirSync(join(folderBefore, 'meta'));
    writeFileSync(join(folderBefore, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) {
      copyFileSync(join(SQLITE_MIGRATIONS, `${entry.tag}.sql`), join(folderBefore, `${entry.tag}.sql`));
    }
  });

  afterAll(() => {
    rmSync(folderBefore, { recursive: true, force: true });
  });

  test('keeps each address on one account, then refuses a re-cased copy', async () => {
    const client = createClient({ url: ':memory:' });
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: folderBefore });
    for (const { id, email, verified } of ACCOUNTS) {
      await client.execute({
        sql: `INSERT INTO users (id, username, password, role, email, email_verified, created_at, updated_at)
              VALUES (?, ?, '', 'member', ?, ?, 0, 0)`,
        args: [id, `user-${id}`, email, verified ? 1 : 0],
      });
    }

    await migrate(db, { migrationsFolder: SQLITE_MIGRATIONS });

    const rows = await client.execute('SELECT id, email, email_verified FROM users ORDER BY id');
    expect(rows.rows.map((row) => ({ id: row.id, email: row.email, verified: row.email_verified === 1 }))).toEqual(
      EXPECTED,
    );
    await expect(
      client.execute(
        `INSERT INTO users (id, username, password, role, email, created_at, updated_at)
         VALUES (11, 'user-11', '', 'member', 'DAVE@EXAMPLE.COM', 0, 0)`,
      ),
    ).rejects.toThrow("UNIQUE constraint failed: index 'idx_users_email'");
  });
});

describe.skipIf(!process.env.PIWI_POSTGRES_TEST_URL)('on PostgreSQL (PIWI_POSTGRES_TEST_URL)', () => {
  test('keeps each address on one account, then refuses a re-cased copy', async () => {
    const { clear, index } = migrationSql(POSTGRES_MIGRATIONS);
    const { default: postgres } = await import('postgres');
    const client = postgres(process.env.PIWI_POSTGRES_TEST_URL!, { max: 1, onnotice: () => {} });
    try {
      // A temporary table and index of the same names are the ones the migrations reach in this session.
      await client`CREATE TEMP TABLE users (id integer PRIMARY KEY, email text, email_verified boolean NOT NULL DEFAULT false)`;
      await client`CREATE UNIQUE INDEX idx_users_email ON users (email)`;
      for (const { id, email, verified } of ACCOUNTS) {
        await client`INSERT INTO users (id, email, email_verified) VALUES (${id}, ${email}, ${verified})`;
      }

      await client.unsafe(clear);
      await client.unsafe(index.replaceAll('--> statement-breakpoint', ''));

      const rows = await client<{ id: number; email: string | null; verified: boolean }[]>`
        SELECT id, email, email_verified AS verified FROM users ORDER BY id`;
      expect(rows.map((row) => ({ ...row }))).toEqual(EXPECTED);
      await expect(client`INSERT INTO users (id, email) VALUES (11, 'DAVE@EXAMPLE.COM')`).rejects.toThrow(
        'duplicate key value violates unique constraint "idx_users_email"',
      );
    } finally {
      await client.end();
    }
  });
});
