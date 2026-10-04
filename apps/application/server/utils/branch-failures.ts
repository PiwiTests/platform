/**
 * The latest complete run on a branch and its failed executions at their
 * failing lines: what an editor shows in its Problems panel and status bar.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { extractStackFrames, stripAnsi, withoutStackFrames } from '@piwitests/core/error-parse';
import { files, testCases, testRuns, testRunsCases } from '../database/schema';
import type { DrizzleDB } from '#shared/handlers/db';
import { caseHeadline } from '#shared/failure-verdict';
import { isScreenshotFileRow } from '#shared/file-classify';
import { extractErrorLocation } from './locator-healing';
import { lastAttempts } from '#shared/status-classify';
import { CI_RUN_ORIGINS, eligibleRunSql, runOriginIn } from '#shared/run-eligibility';

/** Failed executions listed per run. */
export const MAX_BRANCH_FAILURES = 200;

/** The error message of a failure is cut after this many lines, then after this many characters. */
const MESSAGE_MAX_LINES = 12;
const MESSAGE_MAX_CHARS = 1000;
/** Stack frames listed per failure. */
const MAX_FRAMES = 10;

const FAIL_STATUSES = ['failed', 'timedOut', 'timedout'];

export interface BranchRun {
  id: number;
  status: string;
  branch: string | null;
  /** ISO 8601. */
  startTime: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  flakyTests: number;
  skippedTests: number;
}

export interface BranchFailure {
  executionId: number;
  testCaseId: number;
  /** The failure cluster the execution belongs to (its fix plan: `GET /api/failure-clusters/:id/fix-plan`); null when none. */
  clusterId: number | null;
  title: string;
  /** The spec file and the line of the `test(…)` call. */
  file: string;
  line: number | null;
  status: string;
  /** One line on why it failed; null without an error. */
  headline: string | null;
  /** The failing call in the error's first frame outside `node_modules`, `file:line:col`; null when the error names none. */
  location: string | null;
  /** The error without its stack trace (call log, expected and received included), shortened; null without an error. */
  message: string | null;
  /** The error's frames outside `node_modules`, innermost first, `file:line:col`: the failing call, then its callers. */
  frames: string[];
  /** Stored trace paths, downloadable from `/api/files/<path>`. */
  traces: string[];
  /** The failure screenshot's stored path; null without one. */
  screenshot: string | null;
}

export interface BranchFailures {
  run: BranchRun | null;
  failures: BranchFailure[];
}

/** An error as an editor quotes it: without ANSI codes and stack frames, at most {@link MESSAGE_MAX_LINES} lines. */
export function errorMessage(error: string | null): string | null {
  if (!error) return null;
  const lines = withoutStackFrames(stripAnsi(error).replace(/\r\n?/g, '\n'))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .split('\n');
  let text = lines.slice(0, MESSAGE_MAX_LINES).join('\n');
  if (text.length > MESSAGE_MAX_CHARS) text = text.slice(0, MESSAGE_MAX_CHARS).trimEnd();
  return !text ? null : text.length < lines.join('\n').length ? `${text}\n…` : text;
}

/** An error's frames outside `node_modules` as `file:line:col`, innermost first, without repeats. */
export function errorFrames(error: string | null): string[] {
  if (!error) return [];
  const frames = extractStackFrames(stripAnsi(error)).map((f) => `${f.file}:${f.line}:${f.column}`);
  return [...new Set(frames)].slice(0, MAX_FRAMES);
}

function iso(value: Date | number | string | null | undefined): string {
  if (value == null) return new Date(0).toISOString();
  const d = value instanceof Date ? value : new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

/**
 * The newest complete run of a project on `branch` (any branch when null) and
 * the tests whose last attempt in it failed, one execution per test and browser
 * project. A complete run ran the whole suite and finished: a filtered or
 * selection run and a run still in progress are passed over, as is every run
 * the `branch-failures` use leaves out. A CI run is preferred: a local run
 * stands in only while the branch has no CI run.
 */
export async function getBranchFailures(
  db: DrizzleDB,
  projectId: number,
  branch: string | null,
): Promise<BranchFailures> {
  const newest = (ciOnly: boolean) =>
    db
      .select({
        id: testRuns.id,
        status: testRuns.status,
        branch: testRuns.branch,
        startTime: testRuns.startTime,
        totalTests: testRuns.totalTests,
        passedTests: testRuns.passedTests,
        failedTests: testRuns.failedTests,
        flakyTests: testRuns.flakyTests,
        skippedTests: testRuns.skippedTests,
      })
      .from(testRuns)
      .where(
        and(
          eq(testRuns.projectId, projectId),
          branch ? eq(testRuns.branch, branch) : undefined,
          eligibleRunSql('branch-failures'),
          ciOnly ? runOriginIn(testRuns.metadata, CI_RUN_ORIGINS) : undefined,
        ),
      )
      .orderBy(desc(testRuns.startTime), desc(testRuns.id))
      .limit(1);
  const ciRuns = await newest(true);
  const [run] = ciRuns.length ? ciRuns : await newest(false);
  if (!run) return { run: null, failures: [] };

  // Every attempt of each test that failed at least once, so a pass on a retry drops the test.
  const attempts = await db
    .select({
      executionId: testRunsCases.id,
      testCaseId: testRunsCases.testCaseId,
      retries: testRunsCases.retries,
      browserName: testRunsCases.browserName,
      clusterId: testRunsCases.failureClusterId,
      status: testRunsCases.status,
      error: testRunsCases.error,
      steps: testRunsCases.steps,
      line: testRunsCases.line,
      title: testCases.title,
      file: testCases.filePath,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testCases.id, testRunsCases.testCaseId))
    .where(
      and(
        eq(testRunsCases.testRunId, run.id),
        inArray(
          testRunsCases.testCaseId,
          db
            .select({ id: testRunsCases.testCaseId })
            .from(testRunsCases)
            .where(and(eq(testRunsCases.testRunId, run.id), inArray(testRunsCases.status, FAIL_STATUSES))),
        ),
      ),
    )
    .orderBy(asc(testCases.filePath), asc(testRunsCases.line), asc(testRunsCases.id));
  const rows = lastAttempts(attempts.map((a: (typeof attempts)[number]) => ({ ...a, id: a.executionId })))
    .filter((r) => FAIL_STATUSES.includes(r.status))
    .slice(0, MAX_BRANCH_FAILURES);

  const ids = rows.map((r: { executionId: number }) => r.executionId);
  const evidence =
    ids.length > 0
      ? await db
          .select({
            id: files.id,
            testRunsCaseId: files.testRunsCaseId,
            type: files.type,
            subtype: files.subtype,
            label: files.label,
            path: files.path,
          })
          .from(files)
          .where(and(inArray(files.testRunsCaseId, ids), inArray(files.type, ['trace', 'screenshot', 'attachment'])))
          .orderBy(desc(files.id))
      : [];
  const traces = new Map<number, string[]>();
  const screenshots = new Map<number, string>();
  for (const f of evidence as Array<{
    testRunsCaseId: number | null;
    type: string;
    subtype: string | null;
    label: string | null;
    path: string;
    id: number;
  }>) {
    if (f.testRunsCaseId == null) continue;
    if (f.type === 'trace') traces.set(f.testRunsCaseId, [...(traces.get(f.testRunsCaseId) ?? []), f.path]);
    // Newest first: the failure screenshot is captured last.
    else if (!screenshots.has(f.testRunsCaseId) && isScreenshotFileRow(f)) screenshots.set(f.testRunsCaseId, f.path);
  }

  return {
    run: {
      id: run.id,
      status: run.status,
      branch: run.branch ?? null,
      startTime: iso(run.startTime),
      totalTests: run.totalTests,
      passedTests: run.passedTests,
      failedTests: run.failedTests,
      flakyTests: run.flakyTests,
      skippedTests: run.skippedTests,
    },
    failures: rows.map(
      (r: {
        executionId: number;
        testCaseId: number;
        clusterId: number | null;
        status: string;
        error: string | null;
        steps: unknown;
        line: number | null;
        title: string;
        file: string;
      }) => ({
        executionId: r.executionId,
        testCaseId: r.testCaseId,
        clusterId: r.clusterId ?? null,
        title: r.title,
        file: r.file,
        line: r.line ?? null,
        status: r.status,
        headline: caseHeadline(r)?.headline ?? null,
        location: r.error ? extractErrorLocation(r.error) : null,
        message: errorMessage(r.error),
        frames: errorFrames(r.error),
        traces: (traces.get(r.executionId) ?? []).reverse(),
        screenshot: screenshots.get(r.executionId) ?? null,
      }),
    ),
  };
}
