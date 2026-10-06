/**
 * The latest complete run on a branch and its failed executions at their
 * failing lines: what an editor shows in its Problems panel and status bar.
 * With overlays, the finished runs of that branch started after it (a test
 * re-run from the editor, a run on a developer's machine) are laid over it,
 * per test and Playwright project: the newest result wins.
 */
import { and, asc, desc, eq, gt, inArray, isNull, notInArray, or, type SQL } from 'drizzle-orm';
import { extractStackFrames, stripAnsi, withoutStackFrames } from '@piwitests/core/error-parse';
import { failureClusters, files, testCases, testRuns, testRunsCases } from '../database/schema';
import type { DrizzleDB } from '#shared/handlers/db';
import { caseHeadline } from '#shared/failure-verdict';
import { isScreenshotFileRow } from '#shared/file-classify';
import { extractErrorLocation } from './locator-healing';
import { lastAttempts } from '#shared/status-classify';
import { CI_RUN_ORIGINS, UNFINISHED_RUN_STATUSES, eligibleRunSql, runOriginIn } from '#shared/run-eligibility';
import type { RunMetadata } from './run-json-types';

/** Failed executions listed per run, and failures listed as resolved. */
export const MAX_BRANCH_FAILURES = 200;

/** Runs laid over the latest complete run, at most. */
export const MAX_BRANCH_OVERLAYS = 20;

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
  /** What launched it (`test_runs.origin`): `ci`, `ci-rerun`, `local`, `desktop`… */
  origin: string;
  /** The commit it ran at (`metadata.scm.commit`); null when the reporter recorded none. */
  commit: string | null;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  flakyTests: number;
  skippedTests: number;
}

/** A finished run of the branch started after the latest complete run, laid over it. */
export interface BranchOverlay {
  id: number;
  status: string;
  /** What launched it (`test_runs.origin`): `editor`, `local`, `desktop`, `ci`… */
  origin: string;
  /** Whether it ran the whole suite. */
  isFullRun: boolean;
  /** ISO 8601. */
  startTime: string;
  /** The commit it ran at (`metadata.scm.commit`); null when the reporter recorded none. */
  commit: string | null;
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
  /** `baseline` for an execution of the latest complete run, `overlay` for one of a run laid over it. */
  source: 'baseline' | 'overlay';
  /** The run the execution belongs to. */
  runId: number;
  /** The Playwright project the execution ran in; null when unknown. */
  browserName: string | null;
  /** In milliseconds; null when not recorded. */
  duration: number | null;
  /**
   * For the latest complete run, whether the failure is a new regression there (the test passed in its baseline);
   * for an overlay, whether the test did not fail on this project in the latest complete run.
   */
  isNew: boolean;
  /** The failure cluster's title; null without a cluster or a title. */
  clusterTitle: string | null;
  /** The test's owner (`piwi:owner`); null when none. */
  owner: string | null;
  /** What a run laid over the latest complete run says about the test on another project: `passed on chromium in run #124`. */
  note?: string;
}

/** A failure of the latest complete run whose newest result on its project, in a run laid over it, is a pass. */
export interface BranchResolved {
  testCaseId: number;
  title: string;
  /** The spec file and the line of the `test(…)` call, as the passing run reported them. */
  file: string;
  line: number | null;
  browserName: string | null;
  /** The run that passed it, and its passing execution. */
  runId: number;
  executionId: number;
  /** The execution that failed in the latest complete run. */
  baselineExecutionId: number;
}

export interface BranchFailures {
  run: BranchRun | null;
  /** The runs laid over `run`, newest first; empty without overlays. */
  overlays: BranchOverlay[];
  failures: BranchFailure[];
  /** The failures of `run` a run laid over it passed; empty without overlays. */
  resolved: BranchResolved[];
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

/** The commit a run's metadata records; null without one. */
function commitOf(metadata: unknown): string | null {
  const commit = (metadata as RunMetadata | null)?.scm?.commit;
  return typeof commit === 'string' && commit.trim() ? commit.trim() : null;
}

/** A test on one Playwright project: what the newest result is kept per. */
function testKey(row: { testCaseId: number; browserName: string | null }): string {
  return `${row.testCaseId}\x00${row.browserName ?? ''}`;
}

/** One execution as a failure is listed from. */
interface ExecutionRow {
  executionId: number;
  runId: number;
  testCaseId: number;
  retries: number | null;
  browserName: string | null;
  clusterId: number | null;
  clusterTitle: string | null;
  status: string;
  error: string | null;
  steps: unknown;
  line: number | null;
  duration: number | null;
  isNewRegression: number | null;
  title: string;
  file: string;
  owner: string | null;
}

/** An attempt of a test on one project in a run laid over the latest complete run. */
interface OverlayAttempt {
  executionId: number;
  runId: number;
  testCaseId: number;
  retries: number | null;
  browserName: string | null;
  status: string;
  file: string;
  line: number | null;
}

/** A failure to list: an execution, where it comes from, and where it is. */
interface Listed {
  executionId: number;
  source: BranchFailure['source'];
  isNew: boolean;
  note?: string;
  file: string;
  line: number | null;
}

/**
 * The newest complete run of a project on `branch` (any branch when null) and
 * the tests whose last attempt in it failed, one execution per test and browser
 * project. A complete run ran the whole suite and finished: a filtered or
 * selection run and a run still in progress are passed over, as is every run
 * the `branch-failures` use leaves out. A CI run is preferred: a local run
 * stands in only while the branch has no CI run.
 *
 * With `overlays`, the finished runs of that run's branch started after it,
 * whole or partial, that the `editor-overlay` use reads (at most
 * {@link MAX_BRANCH_OVERLAYS}, newest first) are laid over it. For each test
 * and Playwright project, the newest last attempt that passed or failed wins: a
 * failure passed later moves to `resolved`, a failure that failed again is
 * listed from the later execution, and a test that fails only in a later run is
 * listed as new. A pass on another project resolves nothing; it is noted on the
 * failure. Of the overlays, only the attempts of the tests that failed in the
 * complete run or in an overlay are read: no other test can change the answer.
 */
export async function getBranchFailures(
  db: DrizzleDB,
  projectId: number,
  branch: string | null,
  options: { overlays?: boolean } = {},
): Promise<BranchFailures> {
  const runColumns = {
    id: testRuns.id,
    status: testRuns.status,
    branch: testRuns.branch,
    startTime: testRuns.startTime,
    origin: testRuns.origin,
    metadata: testRuns.metadata,
    totalTests: testRuns.totalTests,
    passedTests: testRuns.passedTests,
    failedTests: testRuns.failedTests,
    flakyTests: testRuns.flakyTests,
    skippedTests: testRuns.skippedTests,
  };
  const newest = (ciOnly: boolean) =>
    db
      .select(runColumns)
      .from(testRuns)
      .where(
        and(
          eq(testRuns.projectId, projectId),
          branch ? eq(testRuns.branch, branch) : undefined,
          eligibleRunSql('branch-failures'),
          ciOnly ? runOriginIn(testRuns.origin, CI_RUN_ORIGINS) : undefined,
        ),
      )
      .orderBy(desc(testRuns.startTime), desc(testRuns.id))
      .limit(1);
  const ciRuns = await newest(true);
  const [run] = ciRuns.length ? ciRuns : await newest(false);
  if (!run) return { run: null, overlays: [], failures: [], resolved: [] };

  const overlayRuns = options.overlays
    ? await db
        .select({ ...runColumns, isFullRun: testRuns.isFullRun })
        .from(testRuns)
        .where(
          and(
            eq(testRuns.projectId, projectId),
            run.branch ? eq(testRuns.branch, run.branch) : isNull(testRuns.branch),
            or(
              gt(testRuns.startTime, run.startTime),
              and(eq(testRuns.startTime, run.startTime), gt(testRuns.id, run.id)),
            ),
            notInArray(testRuns.status, [...UNFINISHED_RUN_STATUSES]),
            eligibleRunSql('editor-overlay'),
          ),
        )
        .orderBy(desc(testRuns.startTime), desc(testRuns.id))
        .limit(MAX_BRANCH_OVERLAYS)
    : [];

  const executions = (where: SQL | undefined): Promise<ExecutionRow[]> =>
    db
      .select({
        executionId: testRunsCases.id,
        runId: testRunsCases.testRunId,
        testCaseId: testRunsCases.testCaseId,
        retries: testRunsCases.retries,
        browserName: testRunsCases.browserName,
        clusterId: testRunsCases.failureClusterId,
        clusterTitle: failureClusters.title,
        status: testRunsCases.status,
        error: testRunsCases.error,
        steps: testRunsCases.steps,
        line: testRunsCases.line,
        duration: testRunsCases.duration,
        isNewRegression: testRunsCases.isNewRegression,
        title: testCases.title,
        file: testCases.filePath,
        owner: testCases.owner,
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testCases.id, testRunsCases.testCaseId))
      .leftJoin(failureClusters, eq(failureClusters.id, testRunsCases.failureClusterId))
      .where(where)
      .orderBy(asc(testCases.filePath), asc(testRunsCases.line), asc(testRunsCases.id));

  // Every attempt of each test that failed at least once, so a pass on a retry drops the test.
  const attempts = await executions(
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
  );
  const baseline = lastAttempts(attempts.map((a) => ({ ...a, id: a.executionId }))).filter((r) =>
    FAIL_STATUSES.includes(r.status),
  );

  // The last attempt of each test on each project in each overlay; the newest run that passed or failed it wins.
  const overlayIds = overlayRuns.map((o) => o.id);
  let overlayAttempts: OverlayAttempt[] = [];
  if (overlayIds.length) {
    const failedBefore = [...new Set(baseline.map((r) => r.testCaseId))];
    const failedInOverlay = inArray(
      testRunsCases.testCaseId,
      db
        .select({ id: testRunsCases.testCaseId })
        .from(testRunsCases)
        .where(and(inArray(testRunsCases.testRunId, overlayIds), inArray(testRunsCases.status, FAIL_STATUSES))),
    );
    overlayAttempts = await db
      .select({
        executionId: testRunsCases.id,
        runId: testRunsCases.testRunId,
        testCaseId: testRunsCases.testCaseId,
        retries: testRunsCases.retries,
        browserName: testRunsCases.browserName,
        status: testRunsCases.status,
        file: testCases.filePath,
        line: testRunsCases.line,
      })
      .from(testRunsCases)
      .innerJoin(testCases, eq(testCases.id, testRunsCases.testCaseId))
      .where(
        and(
          inArray(testRunsCases.testRunId, overlayIds),
          failedBefore.length ? or(inArray(testRunsCases.testCaseId, failedBefore), failedInOverlay) : failedInOverlay,
        ),
      )
      .orderBy(asc(testCases.filePath), asc(testRunsCases.line), asc(testRunsCases.id));
  }
  const newer = new Map<string, OverlayAttempt>();
  for (const id of overlayIds) {
    const ofRun = overlayAttempts.filter((a) => a.runId === id).map((a) => ({ ...a, id: a.executionId }));
    for (const attempt of lastAttempts(ofRun)) {
      if (attempt.status !== 'passed' && !FAIL_STATUSES.includes(attempt.status)) continue;
      const key = testKey(attempt);
      if (!newer.has(key)) newer.set(key, attempt);
    }
  }
  const overlayRank = new Map(overlayIds.map((id, rank) => [id, rank]));
  const passes = [...newer.values()]
    .filter((a) => a.status === 'passed')
    .sort((a, b) => overlayRank.get(a.runId)! - overlayRank.get(b.runId)!);

  const listed: Listed[] = [];
  const resolved: BranchResolved[] = [];
  const fromOverlay = (later: OverlayAttempt, isNew: boolean): Listed => ({
    executionId: later.executionId,
    source: 'overlay',
    isNew,
    file: later.file,
    line: later.line,
  });
  for (const failure of baseline) {
    const later = newer.get(testKey(failure));
    if (!later) {
      const elsewhere = passes.find((p) => p.testCaseId === failure.testCaseId);
      listed.push({
        executionId: failure.executionId,
        source: 'baseline',
        isNew: !!failure.isNewRegression,
        ...(elsewhere
          ? { note: `passed${elsewhere.browserName ? ` on ${elsewhere.browserName}` : ''} in run #${elsewhere.runId}` }
          : {}),
        file: failure.file,
        line: failure.line,
      });
    } else if (later.status === 'passed') {
      resolved.push({
        testCaseId: failure.testCaseId,
        title: failure.title,
        file: failure.file,
        line: later.line ?? failure.line ?? null,
        browserName: failure.browserName ?? null,
        runId: later.runId,
        executionId: later.executionId,
        baselineExecutionId: failure.executionId,
      });
    } else {
      listed.push(fromOverlay(later, false));
    }
  }
  const failedKeys = new Set(baseline.map(testKey));
  for (const [key, later] of newer) {
    if (later.status !== 'passed' && !failedKeys.has(key)) listed.push(fromOverlay(later, true));
  }
  if (listed.some((l) => l.source === 'overlay')) {
    // In file order, then line order; the sort is stable, so equal places keep the order they were listed in.
    listed.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : (a.line ?? 0) - (b.line ?? 0)));
  }
  const shown = listed.slice(0, MAX_BRANCH_FAILURES);

  const overlayShown = shown.filter((l) => l.source === 'overlay').map((l) => l.executionId);
  const rowsById = new Map<number, ExecutionRow>(
    [...baseline, ...(overlayShown.length ? await executions(inArray(testRunsCases.id, overlayShown)) : [])].map(
      (r) => [r.executionId, r],
    ),
  );

  const ids = shown.map((l) => l.executionId);
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
  for (const f of evidence) {
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
      origin: run.origin,
      commit: commitOf(run.metadata),
      totalTests: run.totalTests,
      passedTests: run.passedTests,
      failedTests: run.failedTests,
      flakyTests: run.flakyTests,
      skippedTests: run.skippedTests,
    },
    overlays: overlayRuns.map((o) => ({
      id: o.id,
      status: o.status,
      origin: o.origin,
      isFullRun: Boolean(o.isFullRun),
      startTime: iso(o.startTime),
      commit: commitOf(o.metadata),
      totalTests: o.totalTests,
      passedTests: o.passedTests,
      failedTests: o.failedTests,
      flakyTests: o.flakyTests,
      skippedTests: o.skippedTests,
    })),
    failures: shown.map((l) => {
      const r = rowsById.get(l.executionId)!;
      return {
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
        source: l.source,
        runId: r.runId,
        browserName: r.browserName ?? null,
        duration: r.duration ?? null,
        isNew: l.isNew,
        clusterTitle: r.clusterTitle ?? null,
        owner: r.owner ?? null,
        ...(l.note ? { note: l.note } : {}),
      };
    }),
    resolved: resolved.slice(0, MAX_BRANCH_FAILURES),
  };
}
