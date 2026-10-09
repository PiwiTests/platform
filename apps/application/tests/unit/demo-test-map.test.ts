import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient, type Client } from '@libsql/client';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';
import { WEB_DASHBOARD_PROJECT_ID } from '#shared/demo/demo-test-map.mjs';

const { computeScenarioGaps } = await import('../../shared/handlers/scenario-gaps');
const { backfillUnindexedProjects } = await import('../../server/utils/locator-usages');

/**
 * The web-dashboard Test Map in the demo seed is what the live detectors find in
 * its graph: recomputing the project's gaps on the seeded database, as the demo's
 * Recompute button does, adds no gap, closes none and rewrites none. The
 * locator index is built from the seeded runs first, as the server and the demo
 * build it when their database opens, so control reach is part of the recompute,
 * and the control reach and feature groups it writes are the seeded ones.
 *
 * After a change to the model or to a detector, `PIWI_UPDATE_DEMO_TEST_MAP=1`
 * rewrites `shared/demo/demo-test-map-gaps.json` from the recompute; regenerate
 * the seed (`npm run app:seed:demo`) and run the test again.
 */

const rootDir = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
let outDir: string;
let client: Client;
let db: ReturnType<typeof drizzle<typeof schema>>;

type GapRow = typeof schema.scenarioGaps.$inferSelect;
let seededEdges: Awaited<ReturnType<typeof derivedEdges>>;

function shape(rows: GapRow[]) {
  return rows
    .map((r) => ({
      detector: r.detector,
      key: r.key,
      class: r.class,
      title: r.title,
      evidence: r.evidence,
      score: r.score,
      status: r.status,
    }))
    .sort((a, b) => `${a.detector} ${a.key}`.localeCompare(`${b.detector} ${b.key}`));
}

/** The edges the recompute writes besides gaps: locator reach to controls and links, and feature groups. */
async function derivedEdges() {
  const rows = await db
    .select()
    .from(schema.graphEdges)
    .where(eq(schema.graphEdges.projectId, WEB_DASHBOARD_PROJECT_ID));
  return rows
    .filter(
      (r) =>
        (r.kind === 'reaches' && (r.toKind === 'control' || r.toKind === 'link')) ||
        (r.kind === 'groups' && r.fromKind === 'feature'),
    )
    .map((r) => ({
      edge: `${r.fromKind}:${r.fromKey} ${r.kind} ${r.toKind}:${r.toKey}`,
      confidence: r.confidence,
      evidence: r.evidence,
    }))
    .sort((a, b) => a.edge.localeCompare(b.edge));
}

async function projectGaps(): Promise<GapRow[]> {
  return db
    .select()
    .from(schema.scenarioGaps)
    .where(and(eq(schema.scenarioGaps.projectId, WEB_DASHBOARD_PROJECT_ID), eq(schema.scenarioGaps.kind, 'gap')));
}

/** Rewrite the detected-gaps fixture from the gaps the recompute left in the ledger. */
async function writeLedger(rows: GapRow[]): Promise<void> {
  const titles = new Map(
    (
      await db
        .select({ id: schema.testCases.id, title: schema.testCases.title })
        .from(schema.testCases)
        .where(eq(schema.testCases.projectId, WEB_DASHBOARD_PROJECT_ID))
    ).map((t) => [t.id, t.title]),
  );
  const detected = rows
    .filter((r) => r.status !== 'closed')
    .map((r) => ({
      detector: r.detector,
      class: r.class,
      key: r.key,
      title: r.title,
      evidence: r.evidence,
      factors: r.factors,
      score: r.score,
      test: r.testCaseId != null ? (titles.get(r.testCaseId) ?? null) : null,
    }))
    .sort((a, b) => `${a.detector} ${a.key}`.localeCompare(`${b.detector} ${b.key}`));
  writeFileSync(join(rootDir, 'shared/demo/demo-test-map-gaps.json'), `${JSON.stringify(detected, null, 2)}\n`);
}

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'piwi-demo-test-map-'));
  execFileSync('node', ['scripts/generate-demo-seed.mjs'], {
    cwd: rootDir,
    stdio: 'ignore',
    env: { ...process.env, PIWI_DEMO_SEED_OUTPUT_DIR: outDir },
  });
  client = createClient({ url: ':memory:' });
  await client.executeMultiple(readFileSync(join(outDir, 'seed.sql'), 'utf-8'));
  db = drizzle(client, { schema });
  await backfillUnindexedProjects(db as never);
  seededEdges = await derivedEdges();
}, 120_000);

afterAll(() => {
  client?.close();
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe('the web-dashboard Test Map', () => {
  test('recomputing its gaps leaves the seeded ledger as it is', async () => {
    const seeded = shape(await projectGaps());
    await computeScenarioGaps(db as never, WEB_DASHBOARD_PROJECT_ID);
    const after = await projectGaps();
    if (process.env.PIWI_UPDATE_DEMO_TEST_MAP) await writeLedger(after);
    expect(shape(after)).toEqual(seeded);
  });

  test('recomputing writes the control reach and the feature groups the seed already holds', async () => {
    expect(seededEdges.some((e) => e.edge.includes(' reaches control:'))).toBe(true);
    await computeScenarioGaps(db as never, WEB_DASHBOARD_PROJECT_ID);
    expect(await derivedEdges()).toEqual(seededEdges);
  });
});
