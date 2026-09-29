import { beforeAll, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

delete process.env.PIWI_DATABASE_URL;
const { resolveBranchPolicy } = await import('../../shared/handlers/analytics/common');
const { parseAnalyticsScope } = await import('../../shared/analytics/scope');

let db: ReturnType<typeof drizzle<typeof schema>>;
const NOW = Date.parse('2026-09-24T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values([
    { id: 1, name: 'configured', defaultBranch: 'develop' },
    { id: 2, name: 'reported' },
    { id: 3, name: 'latest run silent' },
    { id: 4, name: 'no runs' },
  ]);
  const run = (projectId: number, days: number, metadata: Record<string, unknown>) => ({
    projectId,
    status: 'passed',
    startTime: daysAgo(days),
    metadata,
  });
  await db
    .insert(schema.testRuns)
    .values([
      run(1, 1, { defaultBranch: 'ignored' }),
      run(2, 3, { defaultBranch: 'master' }),
      run(2, 1, { defaultBranch: 'trunk' }),
      run(3, 2, { defaultBranch: 'older' }),
      run(3, 1, {}),
    ]);
});

async function defaultsOf(allowed: 'all' | number[]) {
  const policy = await resolveBranchPolicy(db as any, parseAnalyticsScope({}), allowed);
  if (policy.kind !== 'default') throw new Error(`expected the default-branch policy, got ${policy.kind}`);
  return new Map(policy.groups.flatMap((g) => g.projectIds.map((id) => [id, g.branch] as const)));
}

describe('resolveBranchPolicy', () => {
  test('a project uses its setting, else what its latest run reported, else main', async () => {
    expect(await defaultsOf('all')).toEqual(
      new Map([
        [1, 'develop'],
        [2, 'trunk'],
        [3, 'main'],
        [4, 'main'],
      ]),
    );
  });

  test('only the allowed projects are resolved', async () => {
    expect(await defaultsOf([2, 4])).toEqual(
      new Map([
        [2, 'trunk'],
        [4, 'main'],
      ]),
    );
  });
});
