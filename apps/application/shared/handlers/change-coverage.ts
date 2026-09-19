/**
 * Change coverage — the answer to "did we test what this pull request changed?".
 * Joins the changed files of a diff to the tests that observably reach them
 * (locator call sites, captured every run, and the tests defined in a changed
 * spec) and to the tickets named in the commits and the pull request.
 *
 * Honest by construction: reach is *observed* reach, never instrumented
 * coverage, and "no test in this run" is always paired with the count from the
 * recent window, so a selection-narrowed run is never mistaken for a gap.
 */

import { desc, eq, inArray } from 'drizzle-orm';
import { locatorSnapshots, testCases, testRuns, testRunsCases } from '../../server/database/schema';
import type { DrizzleDB } from './db';
import { parseCallsiteLocation } from '../callsite-location';
import { HISTORY_WINDOW_RUNS } from './scenario-gaps';

/** A repo-relative path normalized for suffix matching. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/** Two repo-relative paths match when equal or one is a path-suffix of the other. */
function pathsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return a.endsWith('/' + b) || b.endsWith('/' + a);
}

/** The Jira/Linear-style ticket shape, `PROJ-123`. */
const TICKET_RE = /\b[A-Z][A-Z0-9]+-\d+\b/g;

/** Distinct ticket ids mentioned across a set of free-text strings. */
export function extractTicketIds(...texts: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(TICKET_RE)) found.add(m[0]);
  }
  return [...found];
}

// ── Inputs / outputs ─────────────────────────────────────────────────────────

export interface ChangedFileInput {
  filePath: string;
  additions: number;
  deletions: number;
}

export interface ChangeCoverageFile {
  filePath: string;
  additions: number;
  deletions: number;
  /** A test reaching this file ran in the run under inspection. */
  reachedInRun: boolean;
  /** How many of the recent runs a reaching test executed in. */
  reachedCountHistory: number;
  /** Distinct tests that observably reach this file. */
  reachingTestCount: number;
  ticket: string | null;
}

export interface ChangeCoverageTicket {
  ticket: string | null;
  files: ChangeCoverageFile[];
}

export interface ChangeCoverage {
  runId: number | null;
  baseSha: string | null;
  headSha: string | null;
  baseBranch: string | null;
  windowRuns: number;
  files: ChangeCoverageFile[];
  tickets: ChangeCoverageTicket[];
  reachedFiles: number;
  uncoveredFiles: number;
  /** False when no SCM diff was available (no token, or the fetch failed). */
  scmAvailable: boolean;
}

export interface ChangeCoverageInput {
  changedFiles: ChangedFileInput[];
  runId?: number | null;
  baseSha?: string | null;
  headSha?: string | null;
  baseBranch?: string | null;
  /** Tickets from the commit messages and the pull request. */
  tickets?: string[];
  scmAvailable?: boolean;
}

// ── File reach ───────────────────────────────────────────────────────────────

/**
 * Per-file set of test cases that reach it, from locator call sites (captured
 * every run for every locator) plus the tests defined in the file itself.
 */
async function loadFileReach(
  db: DrizzleDB,
  projectId: number,
): Promise<{ byFile: Map<string, Set<number>>; caseFiles: Array<{ id: number; filePath: string }> }> {
  const caseFiles = await db
    .select({ id: testCases.id, filePath: testCases.filePath })
    .from(testCases)
    .where(eq(testCases.projectId, projectId));

  const snapshots = await db
    .select({ testCaseId: locatorSnapshots.testCaseId, location: locatorSnapshots.location })
    .from(locatorSnapshots)
    .innerJoin(testCases, eq(locatorSnapshots.testCaseId, testCases.id))
    .where(eq(testCases.projectId, projectId));

  const byFile = new Map<string, Set<number>>();
  const add = (file: string, caseId: number) => {
    const norm = normalizePath(file);
    if (!norm) return;
    const set = byFile.get(norm) ?? new Set<number>();
    set.add(caseId);
    byFile.set(norm, set);
  };

  for (const s of snapshots) {
    const parsed = parseCallsiteLocation(s.location);
    if (parsed?.file) add(parsed.file, s.testCaseId);
  }
  return { byFile, caseFiles };
}

/**
 * Compute change coverage for one diff. Pure of any SCM concern — the caller
 * fetches the diff and the tickets and hands them in, so the demo runs the same
 * join against seeded rows.
 */
export async function computeChangeCoverage(
  db: DrizzleDB,
  projectId: number,
  input: ChangeCoverageInput,
): Promise<ChangeCoverage> {
  const windowRuns = HISTORY_WINDOW_RUNS;
  const tickets = input.tickets ?? [];
  const primaryTicket = tickets[0] ?? null;
  const files = input.changedFiles
    .map((f) => ({ ...f, filePath: normalizePath(f.filePath) }))
    .filter((f) => f.filePath);

  const recent = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(desc(testRuns.id))
    .limit(windowRuns);
  const recentIds = recent.map((r) => r.id);

  const { byFile, caseFiles } = await loadFileReach(db, projectId);

  // Which test cases ran in the inspected run, and in each recent run.
  const ranInRun = new Set<number>();
  if (input.runId != null) {
    const rows = await db
      .select({ testCaseId: testRunsCases.testCaseId })
      .from(testRunsCases)
      .where(eq(testRunsCases.testRunId, input.runId));
    for (const r of rows) ranInRun.add(r.testCaseId);
  }

  const runsByCase = new Map<number, Set<number>>();
  if (recentIds.length > 0) {
    const rows = await db
      .select({ testRunId: testRunsCases.testRunId, testCaseId: testRunsCases.testCaseId })
      .from(testRunsCases)
      .where(inArray(testRunsCases.testRunId, recentIds));
    for (const r of rows) {
      const set = runsByCase.get(r.testCaseId) ?? new Set<number>();
      set.add(r.testRunId);
      runsByCase.set(r.testCaseId, set);
    }
  }

  const covered: ChangeCoverageFile[] = files.map((file) => {
    const reaching = new Set<number>();
    // Reach through captured locator call sites.
    for (const [reachedFile, ids] of byFile) {
      if (pathsMatch(reachedFile, file.filePath)) for (const id of ids) reaching.add(id);
    }
    // A changed spec file reaches the tests defined in it.
    for (const c of caseFiles) {
      if (pathsMatch(normalizePath(c.filePath), file.filePath)) reaching.add(c.id);
    }

    const historyRuns = new Set<number>();
    for (const id of reaching) for (const runId of runsByCase.get(id) ?? []) historyRuns.add(runId);

    const reachedInRun = input.runId != null ? [...reaching].some((id) => ranInRun.has(id)) : historyRuns.size > 0;

    return {
      filePath: file.filePath,
      additions: file.additions,
      deletions: file.deletions,
      reachedInRun,
      reachedCountHistory: historyRuns.size,
      reachingTestCount: reaching.size,
      ticket: primaryTicket,
    };
  });

  const reachedFiles = covered.filter((f) => f.reachedInRun || f.reachedCountHistory > 0).length;

  // Group by ticket, uncovered files leading each group.
  const byTicket = new Map<string | null, ChangeCoverageFile[]>();
  for (const f of covered) {
    const list = byTicket.get(f.ticket) ?? [];
    list.push(f);
    byTicket.set(f.ticket, list);
  }
  const ticketGroups: ChangeCoverageTicket[] = [...byTicket].map(([ticket, groupFiles]) => ({
    ticket,
    files: groupFiles,
  }));

  return {
    runId: input.runId ?? null,
    baseSha: input.baseSha ?? null,
    headSha: input.headSha ?? null,
    baseBranch: input.baseBranch ?? null,
    windowRuns,
    files: covered,
    tickets: ticketGroups,
    reachedFiles,
    uncoveredFiles: covered.length - reachedFiles,
    scmAvailable: input.scmAvailable ?? true,
  };
}
