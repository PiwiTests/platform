import { asc, eq } from 'drizzle-orm';
import { testRunResourceReports } from '../../server/database/schema';
import type { DrizzleDB } from './db';
import { sanitizeResourceReport, type StoredResourceReport } from '#shared/resource-report';
import type { WireResourceReport } from '#shared/types';

/**
 * A run's resource report, stored one row per reporter: each shard's finish
 * writes its own row whole, in one statement, so shards finishing at the same
 * time never overwrite each other's part, and a retried finish replaces its
 * own. Shared by the server's ingest paths and the demo's.
 */

/** The most parts a run's report is read with. */
const PARTS_CAP = 64;

/** Store one reporter's report for a run, replacing what the same shard sent before. */
export async function saveResourceReportPart(db: DrizzleDB, runId: number, part: WireResourceReport): Promise<void> {
  const now = new Date();
  await db
    .insert(testRunResourceReports)
    .values({ runId, shard: part.shardIndex ?? 0, report: part, updatedAt: now })
    .onConflictDoUpdate({
      target: [testRunResourceReports.runId, testRunResourceReports.shard],
      set: { report: part, updatedAt: now },
    });
}

/** The run's report, its parts in shard order; no parts when no reporter sent one. */
export async function readResourceReport(db: DrizzleDB, runId: number): Promise<StoredResourceReport> {
  const rows = await db
    .select({ report: testRunResourceReports.report })
    .from(testRunResourceReports)
    .where(eq(testRunResourceReports.runId, runId))
    .orderBy(asc(testRunResourceReports.shard))
    .limit(PARTS_CAP);
  return {
    v: 1,
    parts: rows.map((row) => sanitizeResourceReport(row.report)).filter((p): p is WireResourceReport => p !== null),
  };
}

/** True when at least one reporter of the run sent a report. */
export async function hasResourceReport(db: DrizzleDB, runId: number): Promise<boolean> {
  const rows = await db
    .select({ id: testRunResourceReports.id })
    .from(testRunResourceReports)
    .where(eq(testRunResourceReports.runId, runId))
    .limit(1);
  return rows.length > 0;
}
