/**
 * Code reach on the server: the application source files each test executed.
 *
 * Two origins, one answer:
 * - `client`: the files whose functions ran in the page, from the reporter's
 *   `codeReach` field (JavaScript coverage). Stored in `code_reach`, one row per
 *   (test case, branch, file); a test's rows on a branch hold the files of every
 *   execution of its latest run there (browser projects, retries, ingest
 *   batches), and replace the rows of older runs. A run without code reach
 *   leaves them as they are, so a nightly sample serves the whole day.
 * - `server`: the handler files of the routes the test reached, read from the
 *   Test Map's `reaches` and `handled-by` edges when asked, so an instrumented
 *   backend gets reach with no capture of its own.
 *
 * Always observed reach: a file a test executed, never line coverage.
 */
import { and, desc, eq, inArray, isNull, ne, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
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
 * files of every execution of the latest run are merged, and replace the rows
 * of older runs. An execution older than the rows already stored (an imported
 * old report) changes nothing.
 */
/** What a caller that has already read it hands {@link upsertCodeReach}, which reads the rest itself. */
export interface CodeReachLookups {
  /** The start and branch of every run the cases belong to. */
  runs?: Map<number, { startedAt: Date; branch: string | null }>;
  /** The project's stored default branch, resolved by the caller at most once. */
  defaultBranch?: () => Promise<string>;
}

export async function upsertCodeReach(
  db: DrizzleDB,
  projectId: number,
  cases: CodeReachCase[],
  known: CodeReachLookups = {},
): Promise<void> {
  if (cases.length === 0) return;
  let runs = known.runs;
  if (!runs) {
    runs = new Map();
    const runIds = [...new Set(cases.map((c) => c.runId))];
    for (let i = 0; i < runIds.length; i += INSERT_CHUNK) {
      const rows = await db
        .select({ id: testRuns.id, startTime: testRuns.startTime, branch: testRuns.branch })
        .from(testRuns)
        .where(inArray(testRuns.id, runIds.slice(i, i + INSERT_CHUNK)));
      for (const r of rows) runs.set(r.id, { startedAt: new Date(r.startTime), branch: r.branch });
    }
  }
  const branched = [...runs.values()].some((r) => r.branch);
  const defaultBranch = branched ? await (known.defaultBranch?.() ?? projectDefaultBranch(db, projectId)) : null;

  // Per (test case, branch) in this batch: the latest run, and the files of all its executions.
  const latest = new Map<
    string,
    { testCaseId: number; runId: number; tag: string; startedAt: Date; files: Set<string> }
  >();
  for (const c of cases) {
    const run = runs.get(c.runId);
    if (!run) continue;
    const tag = locatorBranchTag(run.branch, defaultBranch);
    const key = `${c.testCaseId}\x00${tag}`;
    const current = latest.get(key);
    if (current && current.runId === c.runId) {
      for (const file of c.files) current.files.add(file);
    } else if (
      !current ||
      run.startedAt > current.startedAt ||
      (+run.startedAt === +current.startedAt && c.runId > current.runId)
    ) {
      latest.set(key, {
        testCaseId: c.testCaseId,
        runId: c.runId,
        tag,
        startedAt: run.startedAt,
        files: new Set(c.files),
      });
    }
  }

  for (const { testCaseId, runId, tag, startedAt, files } of latest.values()) {
    const scope = and(eq(codeReach.testCaseId, testCaseId), eq(codeReach.branch, tag));
    // The column itself, not a raw max(): its mapping reads the timestamp as stored on either database.
    const [newest] = await db
      .select({ at: codeReach.lastSeenAt })
      .from(codeReach)
      .where(scope)
      .orderBy(desc(codeReach.lastSeenAt))
      .limit(1);
    const newestAt = newest?.at ?? null;
    if (newestAt && newestAt > startedAt) continue;
    // Rows of this same run (another project, a retry, an earlier batch) stay and are merged into.
    await db
      .delete(codeReach)
      .where(and(scope, or(isNull(codeReach.lastSeenRunId), ne(codeReach.lastSeenRunId, runId))));
    const rows = [...files].map((file) => ({
      projectId,
      testCaseId,
      branch: tag,
      file,
      origin: 'client' as const,
      lastSeenRunId: runId,
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
 * A SQL condition keeping the paths that may name `file` under `sameFilePath`:
 * those ending in its base name. Callers apply `sameFilePath` to what is left.
 */
function sameBaseName(column: AnyColumn, file: string): SQL {
  const normalized = file.replace(/\\/g, '/');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  const suffix = `%/${base.replace(/[\\%_]/g, (c) => `\\${c}`)}`;
  return or(eq(column, base), sql`${column} LIKE ${suffix} ESCAPE '\\'`)!;
}

/**
 * Every (test, file) pair of a project on a branch: the branch's own client
 * rows for the tests that have some, the default branch's for the others, and
 * the handler files of the routes each test reached. With `file`, only the
 * pairs whose file matches it (`sameFilePath`).
 */
export async function loadCodeReachPairs(
  db: DrizzleDB,
  projectId: number,
  branch?: string | null,
  file?: string,
): Promise<CodeReachPair[]> {
  const view = await resolveBranchView(db, projectId, branch);
  const tag = view.tag ?? '';
  const inView = and(eq(codeReach.projectId, projectId), inArray(codeReach.branch, tag === '' ? [''] : ['', tag]));
  const rows = await db
    .select({ testCaseId: codeReach.testCaseId, file: codeReach.file, branch: codeReach.branch })
    .from(codeReach)
    .where(file === undefined ? inView : and(inView, sameBaseName(codeReach.file, file)));
  // A test with rows of its own on the branch reads only those, whichever files they name.
  const onBranch = new Set<number>();
  if (tag !== '') {
    const own =
      file === undefined
        ? rows.filter((r) => r.branch === tag)
        : await db
            .selectDistinct({ testCaseId: codeReach.testCaseId })
            .from(codeReach)
            .where(and(eq(codeReach.projectId, projectId), eq(codeReach.branch, tag)));
    for (const r of own) onBranch.add(r.testCaseId);
  }
  const pairs: CodeReachPair[] = rows
    .filter((r) => r.branch === tag || !onBranch.has(r.testCaseId))
    .filter((r) => file === undefined || sameFilePath(r.file, file))
    .map((r) => ({ testCaseId: r.testCaseId, file: r.file, origin: 'client' }));
  pairs.push(...(await serverReachPairs(db, projectId, file)));
  return pairs;
}

/** Handler files of the routes each test reached, from the Test Map's canonical edges; with `file`, only that one. */
async function serverReachPairs(db: DrizzleDB, projectId: number, file?: string): Promise<CodeReachPair[]> {
  const handledBy = and(
    eq(graphEdges.projectId, projectId),
    eq(graphEdges.kind, 'handled-by'),
    eq(graphEdges.fromKind, 'route'),
    eq(graphEdges.toKind, 'handler'),
  );
  const handled = (
    await db
      .select({ route: graphEdges.fromKey, file: graphEdges.toKey })
      .from(graphEdges)
      .where(file === undefined ? handledBy : and(handledBy, sameBaseName(graphEdges.toKey, file)))
  ).filter((h) => file === undefined || sameFilePath(handlerNodeKey(h.file), file));
  if (handled.length === 0) return [];
  const filesOf = new Map<string, Set<string>>();
  for (const h of handled) filesOf.set(h.route, (filesOf.get(h.route) ?? new Set()).add(handlerNodeKey(h.file)));
  const reachesRoute = and(
    eq(graphEdges.projectId, projectId),
    eq(graphEdges.kind, 'reaches'),
    eq(graphEdges.fromKind, 'test'),
    eq(graphEdges.toKind, 'route'),
  );
  const routes = [...filesOf.keys()];
  const reaches: Array<{ test: string; route: string }> = [];
  if (file === undefined) {
    reaches.push(
      ...(await db.select({ test: graphEdges.fromKey, route: graphEdges.toKey }).from(graphEdges).where(reachesRoute)),
    );
  } else {
    for (let i = 0; i < routes.length; i += INSERT_CHUNK) {
      reaches.push(
        ...(await db
          .select({ test: graphEdges.fromKey, route: graphEdges.toKey })
          .from(graphEdges)
          .where(and(reachesRoute, inArray(graphEdges.toKey, routes.slice(i, i + INSERT_CHUNK))))),
      );
    }
  }
  const out = new Map<string, CodeReachPair>();
  for (const r of reaches) {
    const testCaseId = Number(r.test);
    if (!Number.isInteger(testCaseId)) continue;
    for (const f of filesOf.get(r.route) ?? []) {
      out.set(`${testCaseId}\x00${f}`, { testCaseId, file: f, origin: 'server' });
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
  const pairs = await loadCodeReachPairs(db, projectId, branch, file);
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
