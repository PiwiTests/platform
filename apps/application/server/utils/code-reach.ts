/**
 * Code reach on the server: the application source files each test executed.
 *
 * Two origins, one answer:
 * - `client`: the files whose functions ran in the page, from the reporter's
 *   `codeReach` field (JavaScript coverage). Stored in `code_reach`, one row per
 *   (test case, branch, file); the rows of a test's latest execution on a branch
 *   replace the previous ones. A run without code reach leaves them as they are,
 *   so a nightly sample serves the whole day.
 * - `server`: the handler files of the routes the test reached, read from the
 *   Test Map's `reaches` and `handled-by` edges when asked, so an instrumented
 *   backend gets reach with no capture of its own.
 *
 * Always observed reach: a file a test executed, never line coverage.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { finalizeCodeReach } from '@piwitests/core/code-reach';
import { sameFilePath } from '@piwitests/core/locator-break';
import type { LocatorIndexTest } from '@piwitests/core/locator-index';
import { codeReach, graphEdges, testRuns } from '../database/schema';
import type { DrizzleDB } from '#shared/handlers/db';
import { handlerNodeKey, testEndpointKey } from '#shared/graph';
import { indexTests, locatorBranchTag, projectDefaultBranch, resolveBranchView } from './locator-usages';

/** Longest path accepted in a code reach list. */
const MAX_PATH_LENGTH = 500;
const INSERT_CHUNK = 500;
/** Files and tests in the code index at most. */
const MAX_INDEX_FILES = 20_000;

export type CodeReachOrigin = 'client' | 'server';

/** A test's `codeReach` field, cleaned: repository-relative paths, sorted, capped; null when absent or malformed. */
export function sanitizeCodeReach(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const files = raw.filter(
    (f): f is string => typeof f === 'string' && f.length > 0 && f.length <= MAX_PATH_LENGTH && !f.includes('\0'),
  );
  return finalizeCodeReach(files);
}

/** One execution's code reach, as ingest hands it over. */
export interface CodeReachCase {
  testCaseId: number;
  runId: number;
  files: string[];
}

/**
 * Store the code reach of a batch of executions: per test case and branch, the
 * latest run's files replace the stored ones. An execution older than the rows
 * already stored (an imported old report) changes nothing.
 */
export async function upsertCodeReach(db: DrizzleDB, projectId: number, cases: CodeReachCase[]): Promise<void> {
  if (cases.length === 0) return;
  const runIds = [...new Set(cases.map((c) => c.runId))];
  const runs = new Map<number, { startedAt: Date; branch: string | null }>();
  for (let i = 0; i < runIds.length; i += INSERT_CHUNK) {
    const rows = await db
      .select({ id: testRuns.id, startTime: testRuns.startTime, branch: testRuns.branch })
      .from(testRuns)
      .where(inArray(testRuns.id, runIds.slice(i, i + INSERT_CHUNK)));
    for (const r of rows) runs.set(r.id, { startedAt: new Date(r.startTime), branch: r.branch });
  }
  const branched = [...runs.values()].some((r) => r.branch);
  const defaultBranch = branched ? await projectDefaultBranch(db, projectId) : null;

  // The latest execution per (test case, branch) in this batch.
  const latest = new Map<string, { c: CodeReachCase; tag: string; startedAt: Date }>();
  for (const c of cases) {
    const run = runs.get(c.runId);
    if (!run) continue;
    const tag = locatorBranchTag(run.branch, defaultBranch);
    const key = `${c.testCaseId}\x00${tag}`;
    const current = latest.get(key);
    if (!current || run.startedAt >= current.startedAt) latest.set(key, { c, tag, startedAt: run.startedAt });
  }

  for (const { c, tag, startedAt } of latest.values()) {
    // The column itself, not a raw max(): its mapping reads the timestamp as stored on either database.
    const [newest] = await db
      .select({ at: codeReach.lastSeenAt })
      .from(codeReach)
      .where(and(eq(codeReach.testCaseId, c.testCaseId), eq(codeReach.branch, tag)))
      .orderBy(desc(codeReach.lastSeenAt))
      .limit(1);
    const newestAt = newest?.at ?? null;
    if (newestAt && newestAt > startedAt) continue;
    await db.delete(codeReach).where(and(eq(codeReach.testCaseId, c.testCaseId), eq(codeReach.branch, tag)));
    const rows = c.files.map((file) => ({
      projectId,
      testCaseId: c.testCaseId,
      branch: tag,
      file,
      origin: 'client' as const,
      lastSeenRunId: c.runId,
      lastSeenAt: startedAt,
    }));
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await db
        .insert(codeReach)
        .values(rows.slice(i, i + INSERT_CHUNK))
        .onConflictDoNothing();
    }
  }
}

/** One (test, file) pair of reach. */
export interface CodeReachPair {
  testCaseId: number;
  file: string;
  origin: CodeReachOrigin;
}

/**
 * Every (test, file) pair of a project on a branch: the branch's own client
 * rows for the tests that have some, the default branch's for the others, and
 * the handler files of the routes each test reached.
 */
export async function loadCodeReachPairs(
  db: DrizzleDB,
  projectId: number,
  branch?: string | null,
): Promise<CodeReachPair[]> {
  const view = await resolveBranchView(db, projectId, branch);
  const tag = view.tag ?? '';
  const rows = await db
    .select({ testCaseId: codeReach.testCaseId, file: codeReach.file, branch: codeReach.branch })
    .from(codeReach)
    .where(and(eq(codeReach.projectId, projectId), inArray(codeReach.branch, tag === '' ? [''] : ['', tag])));
  const onBranch = new Set(rows.filter((r) => r.branch === tag && tag !== '').map((r) => r.testCaseId));
  const pairs: CodeReachPair[] = rows
    .filter((r) => r.branch === tag || !onBranch.has(r.testCaseId))
    .map((r) => ({ testCaseId: r.testCaseId, file: r.file, origin: 'client' }));
  pairs.push(...(await serverReachPairs(db, projectId)));
  return pairs;
}

/** Handler files of the routes each test reached, from the Test Map's canonical edges. */
async function serverReachPairs(db: DrizzleDB, projectId: number): Promise<CodeReachPair[]> {
  const reaches = await db
    .select({ test: graphEdges.fromKey, route: graphEdges.toKey })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.projectId, projectId),
        eq(graphEdges.kind, 'reaches'),
        eq(graphEdges.fromKind, 'test'),
        eq(graphEdges.toKind, 'route'),
      ),
    );
  if (reaches.length === 0) return [];
  const handled = await db
    .select({ route: graphEdges.fromKey, file: graphEdges.toKey })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.projectId, projectId),
        eq(graphEdges.kind, 'handled-by'),
        eq(graphEdges.fromKind, 'route'),
        eq(graphEdges.toKind, 'handler'),
      ),
    );
  const filesOf = new Map<string, Set<string>>();
  for (const h of handled) filesOf.set(h.route, (filesOf.get(h.route) ?? new Set()).add(handlerNodeKey(h.file)));
  const out = new Map<string, CodeReachPair>();
  for (const r of reaches) {
    const testCaseId = Number(r.test);
    if (!Number.isInteger(testCaseId)) continue;
    for (const file of filesOf.get(r.route) ?? []) {
      out.set(`${testCaseId}\x00${file}`, { testCaseId, file, origin: 'server' });
    }
  }
  return [...out.values()];
}

/** The tests that reach a file (suffix match), with how. */
export interface FileReach {
  file: string;
  branch: string;
  tests: Array<LocatorIndexTest & { origin: CodeReachOrigin }>;
}

/** Which tests reach one file on a branch. */
export async function getCodeReachForFile(
  db: DrizzleDB,
  projectId: number,
  file: string,
  branch?: string | null,
): Promise<FileReach> {
  const view = await resolveBranchView(db, projectId, branch);
  const pairs = (await loadCodeReachPairs(db, projectId, branch)).filter((p) => sameFilePath(p.file, file));
  const originOf = new Map<number, CodeReachOrigin>();
  for (const p of pairs) if (originOf.get(p.testCaseId) !== 'client') originOf.set(p.testCaseId, p.origin);
  const tests = await indexTests(db, [...originOf.keys()], view);
  return {
    file,
    branch: view.name ?? view.defaultBranch,
    tests: tests
      .map((t) => ({ ...t, origin: originOf.get(t.id)! }))
      .sort((a, b) => a.file.localeCompare(b.file) || a.title.localeCompare(b.title)),
  };
}

/** The whole map of a branch, for editors. */
export interface CodeIndex {
  projectId: number;
  branch: string;
  files: string[];
  tests: LocatorIndexTest[];
  /** Per file (a position in `files`), the tests reaching it (positions in `tests`) and how. */
  reach: Array<{ file: number; tests: number[]; origin: CodeReachOrigin }>;
  /** When the newest client row was recorded; null when none was. */
  builtAt: string | null;
  truncated: boolean;
}

/** The code index of a project on a branch. */
export async function getCodeIndex(db: DrizzleDB, projectId: number, branch?: string | null): Promise<CodeIndex> {
  const view = await resolveBranchView(db, projectId, branch);
  const pairs = await loadCodeReachPairs(db, projectId, branch);
  const byFile = new Map<string, { client: Set<number>; server: Set<number> }>();
  for (const p of pairs) {
    const entry = byFile.get(p.file) ?? { client: new Set<number>(), server: new Set<number>() };
    entry[p.origin].add(p.testCaseId);
    byFile.set(p.file, entry);
  }
  const files = [...byFile.keys()].sort();
  const truncated = files.length > MAX_INDEX_FILES;
  const kept = files.slice(0, MAX_INDEX_FILES);
  const testIds = [...new Set(kept.flatMap((f) => [...byFile.get(f)!.client, ...byFile.get(f)!.server]))];
  const tests = await indexTests(db, testIds, view);
  const position = new Map(tests.map((t, i) => [t.id, i]));
  const reach: CodeIndex['reach'] = [];
  kept.forEach((file, i) => {
    const entry = byFile.get(file)!;
    for (const origin of ['client', 'server'] as const) {
      const ids = [...entry[origin]].filter((id) => position.has(id)).map((id) => position.get(id)!);
      if (ids.length) reach.push({ file: i, tests: ids.sort((a, b) => a - b), origin });
    }
  });
  const [newest] = await db
    .select({ at: codeReach.lastSeenAt })
    .from(codeReach)
    .where(eq(codeReach.projectId, projectId))
    .orderBy(desc(codeReach.lastSeenAt))
    .limit(1);
  return {
    projectId,
    branch: view.name ?? view.defaultBranch,
    files: kept,
    tests,
    reach,
    builtAt: newest?.at ? newest.at.toISOString() : null,
    truncated,
  };
}

/** The graph specs of client code reach: `file` nodes with origin `coverage` and `reaches` edges from each test. */
export function buildCodeReachGraph(cases: Array<{ testCaseId: number; files: string[] }>) {
  const nodes = new Map<string, { kind: 'file'; key: string; origin: 'coverage' }>();
  const edges: Array<{
    fromKind: 'test';
    fromKey: string;
    toKind: 'file';
    toKey: string;
    kind: 'reaches';
    origin: 'coverage';
    confidence: number;
  }> = [];
  for (const c of cases) {
    for (const file of c.files) {
      const key = handlerNodeKey(file);
      nodes.set(key, { kind: 'file', key, origin: 'coverage' });
      edges.push({
        fromKind: 'test',
        fromKey: testEndpointKey(c.testCaseId),
        toKind: 'file',
        toKey: key,
        kind: 'reaches',
        origin: 'coverage',
        confidence: 1,
      });
    }
  }
  return { nodes: [...nodes.values()], edges };
}
