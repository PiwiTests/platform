import { and, eq, isNotNull } from 'drizzle-orm';
import { testRuns, testRunsCases, testCases } from '../../server/database/schema';
import type { DrizzleDB } from './db';
import { isPassiveCapabilityDeclined } from './capabilities';
import {
  browserCpuMs,
  peakRssMb,
  readStoredResourceReport,
  sanitizeExecutionResources,
  type StoredResourceReport,
} from '#shared/resource-report';

/**
 * A run's resources, as its Resources tab reads them: the report each of its
 * reporters sent (findings and what the run cost each machine), and the
 * executions that cost the most, from what each one measured.
 */

/** One execution's cost, as the tab lists it. */
export interface RunResourceExecution {
  executionId: number;
  testCaseId: number;
  title: string;
  filePath: string;
  line: number | null;
  status: string;
  retries: number;
  /** The worker process and the browser processes it started, together. */
  cpuMs: number;
  /** The browser processes alone (Linux). */
  browserCpuMs: number | null;
  /** The largest browser process during the test. */
  peakRssMb: number | null;
  /** Pages already open in the worker when the test started. */
  openAtStartPages: number;
  /** Objects the test opened itself and left open. */
  leftOpen: number;
}

export interface RunResources {
  report: StoredResourceReport | null;
  /** The executions that carried their cost, costliest first. */
  costliest: RunResourceExecution[];
  /** How many executions carried their cost. */
  measuredExecutions: number;
}

/** How many executions the tab lists. */
const COSTLIEST_CAP = 20;

/** A run's resources; null when the run does not exist. */
export async function getRunResources(db: DrizzleDB, runId: number): Promise<RunResources | null> {
  const [run] = await db
    .select({ projectId: testRuns.projectId, resourceReport: testRuns.resourceReport })
    .from(testRuns)
    .where(eq(testRuns.id, runId));
  if (!run) return null;
  if (await isPassiveCapabilityDeclined(db, run.projectId, 'resources')) {
    return { report: null, costliest: [], measuredExecutions: 0 };
  }

  const stored = readStoredResourceReport(run.resourceReport);
  const rows = await db
    .select({
      executionId: testRunsCases.id,
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      retries: testRunsCases.retries,
      resources: testRunsCases.resources,
      title: testCases.title,
      filePath: testCases.filePath,
      line: testRunsCases.line,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testCases.id, testRunsCases.testCaseId))
    .where(and(eq(testRunsCases.testRunId, runId), isNotNull(testRunsCases.resources)));

  const executions: RunResourceExecution[] = [];
  for (const row of rows) {
    const resources = sanitizeExecutionResources(row.resources);
    if (!resources) continue;
    const browser = browserCpuMs(resources);
    executions.push({
      executionId: row.executionId,
      testCaseId: row.testCaseId,
      title: row.title,
      filePath: row.filePath,
      line: row.line ?? null,
      status: row.status,
      retries: row.retries ?? 0,
      cpuMs: resources.workerCpuMs + (browser ?? 0),
      browserCpuMs: browser,
      peakRssMb: peakRssMb(resources),
      openAtStartPages: resources.openAtStart?.pages ?? 0,
      leftOpen: resources.leftOpen ?? 0,
    });
  }
  executions.sort((a, b) => b.cpuMs - a.cpuMs);

  return {
    report: stored.parts.length > 0 ? stored : null,
    costliest: executions.slice(0, COSTLIEST_CAP),
    measuredExecutions: executions.length,
  };
}
