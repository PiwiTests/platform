import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set.
delete process.env.PIWI_DATABASE_URL;
const {
  addProjectUrlPattern,
  listProjectUrlPatterns,
  listVisibleUrlPatterns,
  replaceProjectUrlPatterns,
  suggestUrlPatterns,
  urlPatternInputSchema,
} = await import('../../shared/handlers/url-patterns');

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;
let shop: number;
let admin: number;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyDb = () => db as any;

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)),
  });
  const rows = await db
    .insert(schema.projects)
    .values([{ name: 'shop', label: 'Shop' }, { name: 'admin' }])
    .returning();
  shop = rows[0]!.id;
  admin = rows[1]!.id;
});

describe('validation', () => {
  test('a pattern starts with a scheme or a wildcard', () => {
    expect(urlPatternInputSchema.safeParse({ pattern: 'https://shop.test/**' }).success).toBe(true);
    expect(urlPatternInputSchema.safeParse({ pattern: '**/checkout/*' }).success).toBe(true);
    expect(urlPatternInputSchema.safeParse({ pattern: 'shop.test/**' }).success).toBe(false);
    expect(urlPatternInputSchema.safeParse({ pattern: '  ' }).success).toBe(false);
  });
});

describe('writes', () => {
  test('replace keeps the given order and trims empty labels to null', async () => {
    const result = await replaceProjectUrlPatterns(anyDb(), shop, [
      { pattern: 'https://staging.shop.test/**', environment: 'staging', branch: 'develop' },
      { pattern: ' https://shop.test/** ', environment: ' ', branch: null },
    ]);
    expect(result.ok).toBe(true);
    const items = await listProjectUrlPatterns(anyDb(), shop);
    expect(items.map((i) => [i.pattern, i.environment, i.branch])).toEqual([
      ['https://staging.shop.test/**', 'staging', 'develop'],
      ['https://shop.test/**', null, null],
    ]);
  });

  test('replace refuses a duplicate and an unknown project', async () => {
    expect(
      await replaceProjectUrlPatterns(anyDb(), shop, [
        { pattern: 'https://a.test/**' },
        { pattern: 'https://a.test/**' },
      ]),
    ).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(await replaceProjectUrlPatterns(anyDb(), 9999, [])).toMatchObject({ ok: false, reason: 'not-found' });
  });

  test('add appends and refuses a pattern the project has', async () => {
    await replaceProjectUrlPatterns(anyDb(), shop, [{ pattern: 'https://a.test/**' }]);
    const added = await addProjectUrlPattern(anyDb(), shop, { pattern: 'https://b.test/**', environment: 'qa' });
    expect(added.ok && added.items.map((i) => i.pattern)).toEqual(['https://a.test/**', 'https://b.test/**']);
    expect(await addProjectUrlPattern(anyDb(), shop, { pattern: 'https://b.test/**' })).toMatchObject({
      ok: false,
      reason: 'duplicate',
    });
    // Another project may use the same pattern.
    expect((await addProjectUrlPattern(anyDb(), admin, { pattern: 'https://b.test/**' })).ok).toBe(true);
  });
});

describe('what the extension reads', () => {
  test('ordered by project then position, filtered by scope, labeled', async () => {
    await replaceProjectUrlPatterns(anyDb(), admin, [{ pattern: 'https://admin.test/**' }]);
    await replaceProjectUrlPatterns(anyDb(), shop, [
      { pattern: 'https://shop.test/b/**' },
      { pattern: 'https://shop.test/**', environment: 'prod' },
    ]);
    const all = await listVisibleUrlPatterns(anyDb(), 'all');
    expect(all.map((p) => [p.projectId, p.pattern])).toEqual([
      [shop, 'https://shop.test/b/**'],
      [shop, 'https://shop.test/**'],
      [admin, 'https://admin.test/**'],
    ]);
    expect(all[0]).toMatchObject({ projectName: 'shop', projectLabel: 'Shop', environment: null, branch: null });
    expect(all[2]!.projectLabel).toBe('admin');
    expect((await listVisibleUrlPatterns(anyDb(), new Set([admin]))).map((p) => p.projectId)).toEqual([admin]);
    expect(await listVisibleUrlPatterns(anyDb(), new Set())).toEqual([]);
  });
});

describe('suggestions', () => {
  test('one pattern per visited origin, most visited first, minus covered ones', async () => {
    await db.insert(schema.testRuns).values({
      projectId: shop,
      status: 'passed',
      startTime: new Date(),
      metadata: { htmlReport: { projects: [{ use: { baseURL: 'https://staging.shop.test/app' } }] } },
    } as typeof schema.testRuns.$inferInsert);
    await db.insert(schema.graphNodes).values([
      { projectId: shop, kind: 'page', key: '/cart', attrs: { url: 'https://staging.shop.test/cart' } },
      { projectId: shop, kind: 'page', key: '/pay', attrs: { url: 'https://pay.example.com/checkout' } },
      { projectId: shop, kind: 'page', key: '/x', attrs: null },
      { projectId: shop, kind: 'route', key: 'GET /api', attrs: { url: 'https://api.shop.test/api' } },
    ]);
    const suggestions = await suggestUrlPatterns(anyDb(), shop);
    expect(suggestions.map((s) => s.pattern)).toEqual(['https://staging.shop.test/**', 'https://pay.example.com/**']);
    expect(suggestions[0]).toMatchObject({ sources: ['base-url', 'test-map'], hits: 2 });

    await replaceProjectUrlPatterns(anyDb(), shop, [{ pattern: 'https://staging.shop.test/**' }]);
    expect((await suggestUrlPatterns(anyDb(), shop)).map((s) => s.origin)).toEqual(['https://pay.example.com']);
    expect(await suggestUrlPatterns(anyDb(), 9999)).toEqual([]);
  });
});
