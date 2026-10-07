import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { sql, type SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { PgDialect } from 'drizzle-orm/pg-core';
import { foldText, foldTextWithOffsets } from '#shared/utils/fold-text';
import { foldedContains, foldedEquals } from '#shared/utils/fold-text-sql';

/** Text as it is written in tests and test titles, in several languages. */
const VALUES = [
  'Résumé upload',
  'resume upload',
  'CAFÉ menu',
  'Łódź office',
  'Ærøskøbing',
  'naïve test',
  'Straße',
  'ПРИВЕТ мир',
  'Ελληνικά',
  'plain ascii',
  '100% done',
  'first_name',
  'firstXname',
  'a*b star',
  'a[b] bracket',
  'what? yes',
  'İstanbul',
  'Crème brûlée',
  'Tiếng Việt',
];

const QUERIES = [
  'resume',
  'RÉSUMÉ',
  'café',
  'CAFE',
  'lodz',
  'ŁÓDŹ',
  'skob',
  'naive',
  'NAÏVE',
  'straße',
  'STRASSE',
  'привет',
  'МИР',
  'ελληνικα',
  'ΕΛΛΗΝΙΚΆ',
  '0% d',
  'first_',
  'a*b',
  'a[b]',
  'what?',
  'istanbul',
  'creme brulee',
  'tieng viet',
  'nothing here',
];

describe('foldText', () => {
  test('lowers case and drops accents', () => {
    expect(foldText('Résumé')).toBe('resume');
    expect(foldText('CRÈME BRÛLÉE')).toBe('creme brulee');
    expect(foldText('Tiếng Việt')).toBe('tieng viet');
    expect(foldText('ΕΛΛΗΝΙΚΆ')).toBe('ελληνικα');
    expect(foldText('İstanbul')).toBe('istanbul');
  });

  test('drops the strokes no decomposition splits off', () => {
    expect(foldText('Łódź')).toBe('lodz');
    expect(foldText('Ærøskøbing')).toBe('æroskobing');
    expect(foldText('Đorđe')).toBe('dorde');
  });

  test('reads a decomposed accent like a composed one', () => {
    expect(foldText('cafe\u0301')).toBe(foldText('café'));
  });

  test('keeps letters that are not accented forms', () => {
    expect(foldText('Straße')).toBe('straße');
    expect(foldText('東京 テスト')).toBe('東京 テスト');
    expect(foldText('한국어')).toBe('한국어');
  });
});

describe('foldTextWithOffsets', () => {
  test('folds as foldText does', () => {
    for (const value of [...VALUES, 'cafe\u0301 au lait', 'ΟΔΟΣ']) {
      expect(foldTextWithOffsets(value).text).toBe(foldText(value));
    }
  });

  test('maps each folded character back to the characters it came from', () => {
    const folded = foldTextWithOffsets('Cafe\u0301 Été');
    expect(folded.text).toBe('cafe ete');
    // The `e` and its combining accent are one character of the original.
    expect([folded.starts[3], folded.ends[3]]).toEqual([3, 5]);
    expect([folded.starts[5], folded.ends[5]]).toEqual([6, 7]);
  });
});

interface Engine {
  name: string;
  postgres: boolean;
  /** The values whose row satisfies `where`, sorted. */
  select(where: SQL): Promise<string[]>;
}

/** Build a predicate as the server would on that engine: the dialect is read from the environment. */
function build(postgres: boolean, predicate: () => SQL): SQL {
  const previous = process.env.PIWI_DATABASE_URL;
  if (postgres) process.env.PIWI_DATABASE_URL = 'postgres://test';
  else delete process.env.PIWI_DATABASE_URL;
  try {
    return predicate();
  } finally {
    if (previous === undefined) delete process.env.PIWI_DATABASE_URL;
    else process.env.PIWI_DATABASE_URL = previous;
  }
}

const sqlite = new SQLiteSyncDialect();
const pg = new PgDialect();
const value = sql.identifier('value');

async function libsqlEngine(): Promise<Engine> {
  const client = createClient({ url: ':memory:' });
  // LIKE compares case-sensitively, as it does on PostgreSQL.
  await client.execute('PRAGMA case_sensitive_like=ON');
  await client.execute('CREATE TABLE t (value TEXT)');
  for (const v of VALUES) await client.execute({ sql: 'INSERT INTO t (value) VALUES (?)', args: [v] });
  return {
    name: 'SQLite (libSQL)',
    postgres: false,
    async select(where) {
      const query = sqlite.sqlToQuery(sql`SELECT value FROM t WHERE ${where}`);
      const result = await client.execute({ sql: query.sql, args: query.params as never });
      return result.rows.map((row) => String(row.value)).sort();
    },
  };
}

async function sqlJsEngine(): Promise<Engine> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('CREATE TABLE t (value TEXT)');
  for (const v of VALUES) db.run('INSERT INTO t (value) VALUES (?)', [v]);
  return {
    name: 'SQLite (sql.js, the demo)',
    postgres: false,
    async select(where) {
      const query = sqlite.sqlToQuery(sql`SELECT value FROM t WHERE ${where}`);
      const [result] = db.exec(query.sql, query.params as never);
      return (result?.values ?? []).map((row) => String(row[0])).sort();
    },
  };
}

const postgresUrl = process.env.PIWI_POSTGRES_TEST_URL;
let closePostgres: (() => Promise<void>) | null = null;

async function postgresEngine(): Promise<Engine> {
  const { default: postgres } = await import('postgres');
  const client = postgres(postgresUrl!, { onnotice: () => {}, max: 1 });
  const table = `piwi_fold_text_${process.pid}`;
  await client.unsafe(`DROP TABLE IF EXISTS ${table}; CREATE TABLE ${table} (value TEXT)`);
  for (const v of VALUES) await client.unsafe(`INSERT INTO ${table} (value) VALUES ($1)`, [v]);
  closePostgres = async () => {
    await client.unsafe(`DROP TABLE IF EXISTS ${table}`);
    await client.end();
  };
  return {
    name: 'PostgreSQL',
    postgres: true,
    async select(where) {
      const query = pg.sqlToQuery(sql`SELECT value FROM ${sql.identifier(table)} WHERE ${where}`);
      const rows = await client.unsafe(query.sql, query.params as never[]);
      return rows.map((row) => String(row.value)).sort();
    },
  };
}

const engines: Array<[string, () => Promise<Engine>]> = [
  ['SQLite (libSQL)', libsqlEngine],
  ['SQLite (sql.js, the demo)', sqlJsEngine],
];
if (postgresUrl) engines.push(['PostgreSQL (PIWI_POSTGRES_TEST_URL)', postgresEngine]);

afterAll(async () => {
  await closePostgres?.();
});

describe.each(engines)('folded SQL predicates on %s', (_name, open) => {
  let engine: Engine;
  beforeAll(async () => {
    engine = await open();
  });

  const contains = (query: string, wildcard = false) =>
    engine.select(build(engine.postgres, () => foldedContains(value, query, { wildcard })));
  const equals = (query: string) => engine.select(build(engine.postgres, () => foldedEquals(value, query)));

  test('a value contains a query as foldText reads them', async () => {
    for (const query of QUERIES) {
      const expected = VALUES.filter((v) => foldText(v).includes(foldText(query))).sort();
      expect({ query, rows: await contains(query) }).toEqual({ query, rows: expected });
    }
  });

  test('accents and case are ignored on either side', async () => {
    expect(await contains('resume')).toEqual(['Résumé upload', 'resume upload']);
    expect(await contains('RÉSUMÉ')).toEqual(['Résumé upload', 'resume upload']);
    expect(await contains('lodz')).toEqual(['Łódź office']);
    expect(await contains('МИР')).toEqual(['ПРИВЕТ мир']);
  });

  test('every character of a query is taken literally', async () => {
    expect(await contains('0% d')).toEqual(['100% done']);
    expect(await contains('first_')).toEqual(['first_name']);
    expect(await contains('a*b')).toEqual(['a*b star']);
    expect(await contains('a[b]')).toEqual(['a[b] bracket']);
    expect(await contains('what?')).toEqual(['what? yes']);
  });

  test('a wildcard stands for any characters', async () => {
    expect(await contains('cr*brul', true)).toEqual(['Crème brûlée']);
    expect(await contains('RES*LOAD', true)).toEqual(['Résumé upload', 'resume upload']);
    expect(await contains('load*res', true)).toEqual([]);
  });

  test('equality ignores accents and case and covers the whole value', async () => {
    expect(await equals('cafe menu')).toEqual(['CAFÉ menu']);
    expect(await equals('STRAßE')).toEqual(['Straße']);
    expect(await equals('cafe')).toEqual([]);
    expect(await equals('100% DONE')).toEqual(['100% done']);
    expect(await equals('first_name')).toEqual(['first_name']);
  });
});
