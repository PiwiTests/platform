import {
  projects,
  testRuns,
  testRunsCases,
  testCases,
  files,
  tags,
  projectTags,
  failureClusters,
  failureDiagnoses,
  casePayloads,
  entityLinks,
} from '../../server/database/schema';
import { asc, desc, eq, exists, sql, and, or, inArray, gte, lte, isNull, isNotNull, count } from 'drizzle-orm';
import { jsonArrayContainsAll, parseTagFilter } from '../utils/tag-filter';
import { FAILED_STATUS_KEYS } from '../utils/test-counts';
import { TEST_PRIORITIES } from '@piwitests/core/test-meta';

import type { DrizzleDB } from './db';
import {
  detectTimeoutOpportunity,
  hasSlowMark,
  type TimeoutOpportunity,
  type TimeoutThresholds,
} from '../analytics/timeout-hygiene';

type ProjectScope = 'all' | Set<number>;

// ─── listProjects ────────────────────────────────────────────────

async function getProjects(db: DrizzleDB, scope: ProjectScope = 'all') {
  let allProjects: any[] = await db.select().from(projects).orderBy(desc(projects.updatedAt));

  if (scope !== 'all') {
    if (scope.size === 0) return { projects: [], ids: [] };
    allProjects = allProjects.filter((p: any) => scope.has(p.id));
  }

  if (allProjects.length === 0) return { projects: [], ids: [] };

  return {
    projects: allProjects,
    ids: allProjects.map((p: any) => p.id),
  };
}

export async function listProjects(db: DrizzleDB, scope: ProjectScope = 'all') {
  const { ids: projectIds, projects: allProjects } = await getProjects(db, scope);

  // 1. Run counts per project (single GROUP BY query instead of loading all rows)
  const runStats: any[] = await db
    .select({
      projectId: testRuns.projectId,
      count: count(),
    })
    .from(testRuns)
    .where(inArray(testRuns.projectId, projectIds))
    .groupBy(testRuns.projectId);

  const runCountByProjectId = new Map<number, number>();
  for (const r of runStats) {
    runCountByProjectId.set(r.projectId, r.count);
  }

  // Latest run id per project, ranked by start_time (id as a deterministic
  // tiebreaker). Using start_time rather than MAX(id) keeps "latest run"
  // correct even when rows are ingested out of chronological order — e.g.
  // historical uploads on the server, or the demo seed which inserts runs
  // newest-first (so MAX(id) would be the oldest run).
  const rankedRuns = db.$with('ranked_latest_runs').as(
    db
      .select({
        id: testRuns.id,
        projectId: testRuns.projectId,
        rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${testRuns.projectId} ORDER BY ${testRuns.startTime} DESC, ${testRuns.id} DESC)`.as(
          'rn',
        ),
      })
      .from(testRuns)
      .where(inArray(testRuns.projectId, projectIds)),
  );
  const latestIdRows: any[] = await db
    .with(rankedRuns)
    .select({ id: rankedRuns.id })
    .from(rankedRuns)
    .where(eq(rankedRuns.rn, 1));
  const latestRunIds: number[] = latestIdRows.map((r) => r.id);

  // 2. Fetch full latest run rows
  const latestRuns: any[] =
    latestRunIds.length > 0 ? await db.select().from(testRuns).where(inArray(testRuns.id, latestRunIds)) : [];
  const latestRunByProjectId = new Map<number, any>();
  for (const r of latestRuns) {
    latestRunByProjectId.set(r.projectId, r);
  }

  // 3. Total test cases per project (batched GROUP BY)
  const caseCounts: any[] = await db
    .select({
      projectId: testCases.projectId,
      count: count(),
    })
    .from(testCases)
    .where(inArray(testCases.projectId, projectIds))
    .groupBy(testCases.projectId);

  const caseCountByProjectId = new Map<number, number>();
  for (const r of caseCounts) {
    caseCountByProjectId.set(r.projectId, r.count);
  }

  // 4. Reports for all latest runs (batched)
  const reportRows: any[] =
    latestRunIds.length > 0
      ? await db
          .select()
          .from(files)
          .where(and(inArray(files.testRunId, latestRunIds), eq(files.type, 'report')))
      : [];
  const reportsByRunId = new Map<
    number,
    { id: number; type: string; label: string; path: string; size: number | null }[]
  >();
  for (const r of reportRows) {
    const list = reportsByRunId.get(r.testRunId!) ?? [];
    list.push({ id: r.id, type: r.subtype || r.type, label: r.label || r.type, path: r.path, size: r.size });
    reportsByRunId.set(r.testRunId!, list);
  }

  // 5. Tags per project (batched)
  const tagRows: any[] = await db
    .select({
      projectId: projectTags.projectId,
      tag: tags,
    })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(inArray(projectTags.projectId, projectIds));

  const tagsByProjectId = new Map<number, any[]>();
  for (const r of tagRows) {
    const list = tagsByProjectId.get(r.projectId) ?? [];
    list.push(r.tag);
    tagsByProjectId.set(r.projectId, list);
  }

  return allProjects.map((project: any) => {
    const latestRun = latestRunByProjectId.get(project.id) ?? null;
    return {
      ...project,
      latestRun: latestRun ? { ...latestRun, reports: reportsByRunId.get(latestRun.id) ?? [] } : null,
      totalRuns: runCountByProjectId.get(project.id) ?? 0,
      totalTestCases: caseCountByProjectId.get(project.id) ?? 0,
      tags: tagsByProjectId.get(project.id) ?? [],
    };
  });
}

// ─── getProject ──────────────────────────────────────────────────

export async function getProject(db: DrizzleDB, id: number, options?: { runLimit?: number }) {
  // Bounds the run list (and the charts derived from it) — projects grow
  // unboundedly, so an uncapped select scales with total history.
  const runLimit = Math.min(Math.max(options?.runLimit ?? 200, 1), 1000);

  const projectResults: any[] = await db.select().from(projects).where(eq(projects.id, id));
  const project = projectResults[0];

  if (!project) throw new Error('Project not found');

  // Select only the columns needed for the run list — omit wide JSON columns
  const runs: any[] = await db
    .select({
      id: testRuns.id,
      projectId: testRuns.projectId,
      status: testRuns.status,
      startTime: testRuns.startTime,
      duration: testRuns.duration,
      totalTests: testRuns.totalTests,
      passedTests: testRuns.passedTests,
      failedTests: testRuns.failedTests,
      skippedTests: testRuns.skippedTests,
      didNotRunTests: testRuns.didNotRunTests,
      flakyTests: testRuns.flakyTests,
      avgTestDuration: testRuns.avgTestDuration,
      p90TestDuration: testRuns.p90TestDuration,
      shardTotal: testRuns.shardTotal,
      shardsFinished: testRuns.shardsFinished,
      environment: testRuns.environment,
      branch: testRuns.branch,
      label: testRuns.label,
      instanceId: testRuns.instanceId,
      playwrightVersion: testRuns.playwrightVersion,
      reporterVersion: testRuns.reporterVersion,
      isFullRun: testRuns.isFullRun,
      filterDetails: testRuns.filterDetails,
      metadata: testRuns.metadata,
      createdAt: testRuns.createdAt,
      updatedAt: testRuns.updatedAt,
    })
    .from(testRuns)
    .where(eq(testRuns.projectId, id))
    .orderBy(desc(testRuns.startTime))
    .limit(runLimit);

  // Fetch reports for all runs in a single query
  const runIds: number[] = runs.map((r: any) => r.id);
  const reportResults: any[] =
    runIds.length > 0
      ? await db
          .select()
          .from(files)
          .where(and(inArray(files.testRunId, runIds), eq(files.type, 'report')))
      : [];

  const reportsByRunId = new Map<
    number,
    { id: number; type: string; label: string; path: string; size: number | null }[]
  >();
  for (const r of reportResults) {
    const list = reportsByRunId.get(r.testRunId!) ?? [];
    list.push({ id: r.id, type: r.subtype || r.type, label: r.label || r.type, path: r.path, size: r.size });
    reportsByRunId.set(r.testRunId!, list);
  }

  // Aggregate distinct browsers per run from the scalar column — the wide
  // `browser` JSON is only needed for full configs, not the name list.
  const browserRows: any[] =
    runIds.length > 0
      ? await db
          .selectDistinct({ testRunId: testRunsCases.testRunId, browserName: testRunsCases.browserName })
          .from(testRunsCases)
          .where(and(inArray(testRunsCases.testRunId, runIds), isNotNull(testRunsCases.browserName)))
      : [];

  const browsersByRunId = new Map<number, string[]>();
  for (const row of browserRows) {
    const name = row.browserName as string | null;
    if (!name) continue;
    const list = browsersByRunId.get(row.testRunId) ?? [];
    if (!list.includes(name)) list.push(name);
    browsersByRunId.set(row.testRunId, list);
  }

  // Get tags for this project
  const projectTagRows: any[] = await db
    .select({ tag: tags })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(eq(projectTags.projectId, id));

  return {
    ...project,
    hasScmToken: !!project.scmToken,
    tags: projectTagRows.map((r: any) => r.tag),
    testRuns: runs.map((r: any) => {
      // Slim the wide metadata JSON down to just the SCM branch/commit shown in the run list
      const scm = (r.metadata as { scm?: { branch?: string | null; commit?: string | null } } | null)?.scm;
      return {
        ...r,
        isFullRun: r.isFullRun === 1,
        metadata:
          scm?.branch || scm?.commit ? { scm: { branch: scm.branch ?? null, commit: scm.commit ?? null } } : null,
        reports: reportsByRunId.get(r.id) ?? [],
        browsers: browsersByRunId.get(r.id) ?? [],
      };
    }),
  };
}

// ─── createProject ───────────────────────────────────────────────

export async function createProject(
  db: DrizzleDB,
  name: string,
  label?: string | null,
  description?: string | null,
  tagIds?: number[],
) {
  const existing: any[] = await db.select().from(projects).where(eq(projects.name, name));
  if (existing.length > 0) throw new Error('A project with this name already exists');

  const result: any[] = await db.insert(projects).values({ name, label, description }).returning();
  const project = result[0]!;

  // Link tags if provided
  if (tagIds && tagIds.length > 0) {
    const existingTags: any[] = await db.select().from(tags).where(inArray(tags.id, tagIds));
    if (existingTags.length !== tagIds.length) {
      throw new Error('One or more tag IDs are invalid');
    }
    await db.insert(projectTags).values(tagIds.map((tagId: number) => ({ projectId: project.id, tagId })));
  }

  return { success: true, project };
}

// ─── updateProject ───────────────────────────────────────────────

export async function updateProject(
  db: DrizzleDB,
  id: number,
  data: {
    label?: string | null;
    description?: string | null;
    diagnosisInstructions?: string | null;
    scmToken?: string | null;
    defaultBranch?: string | null;
    ciRerun?: unknown;
    tagIds?: number[];
  },
) {
  const projectResults: any[] = await db.select().from(projects).where(eq(projects.id, id));
  if (!projectResults[0]) throw new Error('Project not found');

  const { label, description, diagnosisInstructions, scmToken, defaultBranch, ciRerun, tagIds: dataTagIds } = data;

  // Update project
  await db
    .update(projects)
    .set({
      label,
      description,
      diagnosisInstructions: diagnosisInstructions ?? undefined,
      scmToken: scmToken !== undefined ? scmToken : undefined,
      defaultBranch: defaultBranch !== undefined ? defaultBranch : undefined,
      ciRerun: ciRerun !== undefined ? (ciRerun as any) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id));

  // Update project tags if provided
  if (dataTagIds !== undefined) {
    // Remove all existing tags for this project
    await db.delete(projectTags).where(eq(projectTags.projectId, id));

    if (dataTagIds.length > 0) {
      // Validate that all tag IDs exist
      const existingTags: any[] = await db.select().from(tags).where(inArray(tags.id, dataTagIds));
      if (existingTags.length !== dataTagIds.length) {
        throw new Error('One or more tag IDs are invalid');
      }

      // Insert new tag associations
      await db.insert(projectTags).values(dataTagIds.map((tagId: number) => ({ projectId: id, tagId })));
    }
  }

  // Get updated project with tags
  const updatedProject: any[] = await db.select().from(projects).where(eq(projects.id, id));
  const projectTagRows: any[] = await db
    .select({ tag: tags })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(eq(projectTags.projectId, id));

  const { scmToken: _scmToken, ...updatedProjectPublic } = updatedProject[0];

  return {
    success: true,
    project: {
      ...updatedProjectPublic,
      tags: projectTagRows.map((r: any) => r.tag),
    },
  };
}

// ─── deleteProjectData ───────────────────────────────────────────
// Cascading DB-only delete — no storage operations, so it's safe to call from
// both the server (via server/utils/delete-project.ts, which also clears
// storage) and demo mode (directly, against the in-browser DB). The
// storage-touching `deleteProject` wrapper lives in server/utils/ instead of
// here so this shared module never imports server/storage — that module's
// LocalStorageAdapter does synchronous fs/util promisify() calls at import
// time, which crashes when bundled into the demo service worker (no Node
// fs/util in a Worker global scope).

export async function deleteProjectData(db: DrizzleDB, projectId: number) {
  // Get all run IDs to cascade-delete dependent rows that lack DB-level cascade
  const runRows: any[] = await db.select({ id: testRuns.id }).from(testRuns).where(eq(testRuns.projectId, projectId));
  const runIds: number[] = runRows.map((r: any) => r.id);

  if (runIds.length > 0) {
    const caseRows: any[] = await db
      .select({ id: testRunsCases.id })
      .from(testRunsCases)
      .where(inArray(testRunsCases.testRunId, runIds));
    const caseIds: number[] = caseRows.map((c: any) => c.id);

    if (caseIds.length > 0) {
      await db.delete(files).where(inArray(files.testRunsCaseId, caseIds));
    }

    await db.delete(files).where(inArray(files.testRunId, runIds));
    await db.delete(testRunsCases).where(inArray(testRunsCases.testRunId, runIds));
    await db.delete(testRuns).where(eq(testRuns.projectId, projectId));
  }

  await db.delete(testCases).where(eq(testCases.projectId, projectId));
  await db.delete(casePayloads).where(eq(casePayloads.projectId, projectId));

  // Deleting the project row cascades to: projectTags, failureClusters,
  // failureDiagnoses, traceBlobs, traceResources
  await db.delete(projects).where(eq(projects.id, projectId));
}

// ─── getProjectMenu ──────────────────────────────────────────────

export async function getProjectMenu(
  db: DrizzleDB,
  scope: ProjectScope = 'all',
): Promise<{ id: number; name: string; label: string | null }[]> {
  if (scope !== 'all' && scope.size === 0) return [];
  const query = db
    .select({ id: projects.id, name: projects.name, label: projects.label })
    .from(projects)
    .orderBy(desc(projects.updatedAt));
  const rows = await query;
  if (scope === 'all') return rows;
  return rows.filter((p) => scope.has(p.id));
}

// ─── getProjectPerformance ───────────────────────────────────────

export async function getProjectPerformance(
  db: DrizzleDB,
  projectId: number,
  limit: number,
  from?: string,
  to?: string,
  fullRunsOnly: boolean = true,
) {
  // Verify project exists
  const projectResults: any[] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!projectResults[0]) throw new Error('Project not found');

  // Build conditions
  const conditions = [eq(testRuns.projectId, projectId)];
  if (fullRunsOnly) {
    conditions.push(eq(testRuns.isFullRun, 1));
  }
  if (from) {
    const fromDate = new Date(from);
    if (Number.isNaN(fromDate.getTime())) throw new Error('Invalid from date');
    conditions.push(gte(testRuns.startTime, fromDate));
  }
  if (to) {
    const toDate = new Date(to);
    if (Number.isNaN(toDate.getTime())) throw new Error('Invalid to date');
    toDate.setDate(toDate.getDate() + 1);
    conditions.push(lte(testRuns.startTime, toDate));
  }

  const runs: any[] = await db
    .select({
      id: testRuns.id,
      startTime: testRuns.startTime,
      duration: testRuns.duration,
      avgTestDuration: testRuns.avgTestDuration,
      p90TestDuration: testRuns.p90TestDuration,
      status: testRuns.status,
      totalTests: testRuns.totalTests,
      metadata: testRuns.metadata,
      isFullRun: testRuns.isFullRun,
    })
    .from(testRuns)
    .where(and(...conditions))
    .orderBy(desc(testRuns.startTime))
    .limit(Math.min(limit, 200));

  // Reverse so oldest → newest for the trend chart
  runs.reverse();

  // Extract SCM info from metadata for each run
  return runs.map((run: any) => {
    const metadata = run.metadata as Record<string, unknown> | null;
    const scm = metadata?.scm as Record<string, unknown> | undefined;

    return {
      id: run.id,
      startTime: run.startTime,
      duration: run.duration,
      avgTestDuration: run.avgTestDuration,
      p90TestDuration: run.p90TestDuration,
      status: run.status,
      totalTests: run.totalTests,
      commit: (scm?.commit as string | null) || null,
      branch: (scm?.branch as string | null) || null,
      isFullRun: run.isFullRun === 1,
    };
  });
}

// ─── getProjectTestCases ─────────────────────────────────────────

export const TEST_CASE_SORTS = ['lastRun', 'title', 'totalRuns', 'passRate', 'avgDuration', 'status'] as const;
export type TestCasesSort = (typeof TEST_CASE_SORTS)[number];

/** Filterable per-case status categories (the derived `status` field, not raw run statuses). */
export const TEST_CASE_STATUS_FILTERS = ['passed', 'failed', 'flaky', 'skipped', 'didnotrun'] as const;

export interface TestCasesQuery {
  limit: number;
  offset: number;
  q?: string;
  statuses?: string[];
  /** Every tag here must be present on a case for it to match. */
  tags?: string[];
  owner?: string;
  priority?: string;
  maxAgeDays: number;
  sort: TestCasesSort;
  dir: 'asc' | 'desc';
}

/**
 * Parse and clamp the test-cases catalog query parameters. Shared by the REST
 * endpoint (`getQuery` record) and the demo router (`URLSearchParams`) so both
 * apply identical defaults: limit 50 (max 1000), `maxAgeDays` 0 = all time
 * (the UI sends its own default), sort by last run, newest first.
 */
export function parseTestCasesQuery(input?: URLSearchParams | Record<string, unknown> | null): TestCasesQuery {
  const get = (key: string): string | undefined => {
    if (!input) return undefined;
    const value = input instanceof URLSearchParams ? input.get(key) : (input as Record<string, unknown>)[key];
    if (value == null) return undefined;
    return String(Array.isArray(value) ? value[0] : value);
  };
  const num = (key: string, fallback: number): number => {
    const n = Number(get(key));
    return Number.isFinite(n) ? n : fallback;
  };
  const statuses = (get('status') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => (TEST_CASE_STATUS_FILTERS as readonly string[]).includes(s));
  const rawSort = get('sort') ?? '';
  const tags = parseTagFilter(get('tags'));
  const rawPriority = (get('priority') ?? '').trim().toLowerCase();
  const priorities = TEST_PRIORITIES as readonly string[];
  return {
    limit: Math.min(1000, Math.max(1, Math.floor(num('limit', 50)))),
    offset: Math.max(0, Math.floor(num('offset', 0))),
    q: get('q')?.trim() || undefined,
    statuses: statuses.length > 0 ? statuses : undefined,
    tags: tags.length > 0 ? tags : undefined,
    owner: get('owner')?.trim() || undefined,
    priority: priorities.includes(rawPriority) ? rawPriority : undefined,
    maxAgeDays: Math.max(0, num('maxAgeDays', 0)),
    sort: (TEST_CASE_SORTS as readonly string[]).includes(rawSort) ? (rawSort as TestCasesSort) : 'lastRun',
    dir: get('dir') === 'asc' ? 'asc' : 'desc',
  };
}

/**
 * Normalize a `MAX(created_at)` aggregate to epoch milliseconds. The raw value
 * is a ms integer on SQLite, a Date (or timestamp string) on PostgreSQL, and
 * Unix seconds in demo databases seeded before the unit fix.
 */
function toEpochMs(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Paginated test-case catalog for a project with per-case aggregates.
 *
 * Timed-out runs (both the raw `timedOut` Playwright spelling and the declared
 * lowercase `timedout`) are folded into `failedRuns`, matching how the rest of
 * the UI treats timeouts. `passRate` is computed over executed runs only
 * (passed + failed; skipped/didnotrun excluded) and is null when nothing ran.
 * The derived `status` category is what the status filter and sort operate on:
 * `flaky` when any of the last 10 executions is a retry-pass, otherwise the
 * latest run's status (timeouts shown as failed), or `never-run`.
 */
export async function getProjectTestCases(db: DrizzleDB, projectId: number, options: Partial<TestCasesQuery> = {}) {
  const {
    limit = 50,
    offset = 0,
    q,
    statuses,
    tags,
    owner,
    priority,
    maxAgeDays = 0,
    sort = 'lastRun',
    dir = 'desc',
  } = options;

  const passed = sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'passed' THEN 1 ELSE 0 END)`;
  const failed = sql<number>`SUM(CASE WHEN ${testRunsCases.status} IN ('failed', 'timedOut', 'timedout') THEN 1 ELSE 0 END)`;
  const recentFlaky = sql<number>`(
      SELECT COUNT(*) FROM (
        SELECT ${testRunsCases.status} AS s, ${testRunsCases.retries} AS r
        FROM ${testRunsCases}
        WHERE ${testRunsCases.testCaseId} = ${testCases.id}
        ORDER BY ${testRunsCases.createdAt} DESC
        LIMIT 10
      ) AS recent WHERE s = 'passed' AND r > 0
    )`;
  const lastStatus = sql<string | null>`(
      SELECT ${testRunsCases.status}
      FROM ${testRunsCases}
      WHERE ${testRunsCases.testCaseId} = ${testCases.id}
      ORDER BY ${testRunsCases.createdAt} DESC
      LIMIT 1
    )`;
  const category = sql<string>`CASE
      WHEN ${recentFlaky} > 0 THEN 'flaky'
      WHEN ${lastStatus} IN ('timedOut', 'timedout') THEN 'failed'
      ELSE COALESCE(${lastStatus}, 'never-run')
    END`;
  const passRate = sql<
    number | null
  >`CASE WHEN (${passed} + ${failed}) > 0 THEN (${passed} * 1.0) / (${passed} + ${failed}) END`;

  const conditions = [eq(testCases.projectId, projectId)];
  if (q) {
    const pattern = `%${q.toLowerCase()}%`;
    conditions.push(sql`(lower(${testCases.title}) LIKE ${pattern} OR lower(${testCases.filePath}) LIKE ${pattern})`);
  }
  if (maxAgeDays > 0) {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(testRunsCases)
          .where(and(eq(testRunsCases.testCaseId, testCases.id), gte(testRunsCases.createdAt, cutoff))),
      ),
    );
  }
  if (statuses && statuses.length > 0) {
    conditions.push(inArray(category, statuses));
  }
  if (tags && tags.length > 0) {
    conditions.push(...jsonArrayContainsAll(testCases.tags, tags));
  }
  if (owner) {
    conditions.push(eq(testCases.owner, owner));
  }
  if (priority) {
    conditions.push(eq(testCases.priority, priority));
  }
  const where = and(...conditions);

  // Every predicate above is per-case (correlated on testCases.id only), so the
  // total is a plain count over test_cases — no join or grouping needed.
  const countRows: any[] = await db.select({ total: count() }).from(testCases).where(where);
  const total = Number(countRows[0]?.total ?? 0);

  const sortExpressions: Record<TestCasesSort, ReturnType<typeof sql>> = {
    lastRun: sql`MAX(${testRunsCases.createdAt})`,
    title: sql`lower(${testCases.title})`,
    totalRuns: sql`COUNT(${testRunsCases.id})`,
    passRate,
    avgDuration: sql`AVG(CASE WHEN ${testRunsCases.status} NOT IN ('skipped', 'didnotrun') THEN ${testRunsCases.duration} END)`,
    status: category,
  };

  const rows: any[] = await db
    .select({
      id: testCases.id,
      filePath: testCases.filePath,
      suitePath: testCases.suitePath,
      title: testCases.title,
      tags: testCases.tags,
      owner: testCases.owner,
      priority: testCases.priority,
      feature: testCases.feature,
      link: testCases.link,
      status: category,
      totalRuns: sql<number>`COUNT(${testRunsCases.id})`,
      passedRuns: passed,
      failedRuns: failed,
      skippedRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'skipped' THEN 1 ELSE 0 END)`,
      didNotRunRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'didnotrun' THEN 1 ELSE 0 END)`,
      flakyRuns: sql<number>`SUM(CASE WHEN ${testRunsCases.status} = 'passed' AND ${testRunsCases.retries} > 0 THEN 1 ELSE 0 END)`,
      recentFlakyRuns: recentFlaky,
      passRate,
      avgDuration: sql<
        number | null
      >`AVG(CASE WHEN ${testRunsCases.status} NOT IN ('skipped', 'didnotrun') THEN ${testRunsCases.duration} END)`,
      lastRun: sql<number | null>`MAX(${testRunsCases.createdAt})`,
      lastStatus,
    })
    .from(testCases)
    .leftJoin(testRunsCases, eq(testCases.id, testRunsCases.testCaseId))
    .where(where)
    .groupBy(testCases.id, testCases.filePath, testCases.suitePath, testCases.title)
    .orderBy(sql`${sortExpressions[sort]} ${sql.raw(dir === 'asc' ? 'ASC' : 'DESC')} NULLS LAST`, asc(testCases.id))
    .limit(limit)
    .offset(offset);

  return {
    items: rows.map((row) => ({ ...row, lastRun: toEpochMs(row.lastRun) })),
    total,
    limit,
    offset,
  };
}

/**
 * Group a project's recent test executions by spec-file prefix and compute
 * pass rate, flaky rate, failure count, test count, and average duration over
 * the last `days` days. Shared by the REST spec-health endpoint and the MCP
 * `get_spec_health` tool.
 */
export async function getProjectSpecHealth(db: DrizzleDB, projectId: number, days: number) {
  const boundedDays = Math.min(90, Math.max(1, days));
  const since = new Date(Date.now() - boundedDays * 24 * 60 * 60 * 1000);

  const projRows: any[] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  if (projRows.length === 0) throw new Error('Project not found');

  const recentRuns: any[] = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(and(eq(testRuns.projectId, projectId), gte(testRuns.startTime, since)))
    .orderBy(desc(testRuns.startTime))
    .limit(100);
  if (recentRuns.length === 0) return { specs: [] };

  const runIds: number[] = recentRuns.map((r: any) => r.id);
  const rows: any[] = await db
    .select({
      filePath: testCases.filePath,
      status: testRunsCases.status,
      duration: testRunsCases.duration,
      retries: testRunsCases.retries,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(inArray(testRunsCases.testRunId, runIds));

  const specMap = new Map<
    string,
    { testCount: number; passCount: number; failCount: number; flakyCount: number; durations: number[] }
  >();

  for (const row of rows) {
    const prefix = row.filePath.split(/[\\/]/).slice(0, 2).join('/');
    if (!specMap.has(prefix)) {
      specMap.set(prefix, { testCount: 0, passCount: 0, failCount: 0, flakyCount: 0, durations: [] });
    }
    const spec = specMap.get(prefix)!;
    spec.testCount++;
    if (row.status === 'passed') {
      spec.passCount++;
      if ((row.retries ?? 0) > 0) spec.flakyCount++;
    } else if (row.status === 'failed' || row.status === 'timedOut' || row.status === 'timedout') {
      spec.failCount++;
    }
    if (row.duration != null) spec.durations.push(row.duration);
  }

  const specs = [...specMap.entries()]
    .map(([prefix, data]) => ({
      prefix,
      passRate: data.testCount > 0 ? Math.round((data.passCount / data.testCount) * 100) / 100 : 0,
      flakyRate: data.testCount > 0 ? Math.round((data.flakyCount / data.testCount) * 100) / 100 : 0,
      failureCount: data.failCount,
      testCount: data.testCount,
      avgDuration:
        data.durations.length > 0 ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length) : 0,
    }))
    .sort((a, b) => a.prefix.localeCompare(b.prefix));

  return { specs };
}

// ─── getProjectAiStepCoverage ─────────────────────────────────────────

/**
 * Aggregate AI-step *liveness* over a project's recent runs: for each committed
 * AI-step artifact (`page.piwiLocator` / `page.piwiRun`) that was replayed, how
 * many distinct tests exercise it, how often, and when it was last seen. Powers
 * the project "AI steps" panel — a committed artifact that stops showing up is a
 * candidate for `piwi ai prune`. Reads the per-execution `aiUsage` manifest
 * (`{ entries: string[] }`) the reporter attaches while replaying.
 */
export async function getProjectAiStepCoverage(db: DrizzleDB, projectId: number, days: number) {
  const boundedDays = Math.min(90, Math.max(1, days));
  const since = new Date(Date.now() - boundedDays * 24 * 60 * 60 * 1000);

  const projRows: any[] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  if (projRows.length === 0) throw new Error('Project not found');

  const empty = { summary: { artifactCount: 0, testCount: 0, runCount: 0, replayCount: 0 }, artifacts: [] as const };

  const recentRuns: any[] = await db
    .select({ id: testRuns.id, startTime: testRuns.startTime })
    .from(testRuns)
    .where(and(eq(testRuns.projectId, projectId), gte(testRuns.startTime, since)))
    .orderBy(desc(testRuns.startTime))
    .limit(100);
  if (recentRuns.length === 0) return empty;

  const runStart = new Map<number, number>();
  for (const r of recentRuns) runStart.set(r.id, new Date(r.startTime as any).getTime());
  const runIds: number[] = recentRuns.map((r: any) => r.id);

  const rows: any[] = await db
    .select({
      aiUsage: testRunsCases.aiUsage,
      testCaseId: testRunsCases.testCaseId,
      testRunId: testRunsCases.testRunId,
    })
    .from(testRunsCases)
    .where(inArray(testRunsCases.testRunId, runIds));

  const artifactMap = new Map<string, { tests: Set<number>; replayCount: number; lastSeen: number }>();
  const usingTests = new Set<number>();

  for (const row of rows) {
    const usage = row.aiUsage as { entries?: unknown } | null;
    const entries = usage && Array.isArray(usage.entries) ? usage.entries : null;
    if (!entries || entries.length === 0) continue;
    const seen = runStart.get(row.testRunId) ?? 0;
    usingTests.add(row.testCaseId);
    for (const raw of entries) {
      if (typeof raw !== 'string') continue;
      let a = artifactMap.get(raw);
      if (!a) {
        a = { tests: new Set(), replayCount: 0, lastSeen: 0 };
        artifactMap.set(raw, a);
      }
      a.tests.add(row.testCaseId);
      a.replayCount++;
      if (seen > a.lastSeen) a.lastSeen = seen;
    }
  }

  const artifacts = [...artifactMap.entries()]
    .map(([entry, d]) => ({
      entry,
      testCount: d.tests.size,
      replayCount: d.replayCount,
      lastSeen: d.lastSeen ? new Date(d.lastSeen).toISOString() : null,
    }))
    .sort((a, b) => a.entry.localeCompare(b.entry));

  return {
    summary: {
      artifactCount: artifacts.length,
      testCount: usingTests.size,
      runCount: recentRuns.length,
      replayCount: artifacts.reduce((sum, a) => sum + a.replayCount, 0),
    },
    artifacts,
  };
}

// ─── getProjectSlowTests ─────────────────────────────────────────

export async function getProjectSlowTests(db: DrizzleDB, projectId: number, runsCount: number) {
  // Verify project exists
  const projectResults: any[] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!projectResults[0]) throw new Error('Project not found');

  const effectiveLimit = Math.min(runsCount, 100);

  // Get recent test run IDs for this project
  const recentRuns: any[] = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(desc(testRuns.startTime))
    .limit(effectiveLimit);

  const runIds: number[] = recentRuns.map((r: any) => r.id);
  if (runIds.length === 0) return [];

  // Get all test case results from these runs, joining startTime so we can sort chronologically
  const results: any[] = await db
    .select({
      testCaseId: testRunsCases.testCaseId,
      duration: testRunsCases.duration,
      testRunId: testRunsCases.testRunId,
      startTime: testRuns.startTime,
      title: testCases.title,
      filePath: testCases.filePath,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(and(inArray(testRunsCases.testRunId, runIds), eq(testCases.projectId, projectId)));

  // Group by test case and compute aggregates
  const testCaseMap = new Map<
    number,
    {
      id: number;
      title: string;
      filePath: string;
      entries: Array<{ startTime: Date; duration: number }>;
    }
  >();

  for (const row of results) {
    if (row.duration === null || row.duration === undefined) continue;

    if (!testCaseMap.has(row.testCaseId)) {
      testCaseMap.set(row.testCaseId, {
        id: row.testCaseId,
        title: row.title,
        filePath: row.filePath,
        entries: [],
      });
    }

    const entry = testCaseMap.get(row.testCaseId)!;
    entry.entries.push({ startTime: row.startTime, duration: row.duration });
  }

  // Compute stats and sort by average duration desc (slowest first)
  return Array.from(testCaseMap.values())
    .map(
      (entry: {
        id: number;
        title: string;
        filePath: string;
        entries: Array<{ startTime: Date; duration: number }>;
      }) => {
        // Sort entries chronologically so latestDuration and trend are correct
        const chronological = [...entry.entries].sort(
          (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
        );
        const durations = chronological.map((e) => e.duration);

        const sorted = [...durations].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        const avgDuration = Math.round(sum / sorted.length);
        const maxDuration = sorted[sorted.length - 1] || 0;
        const minDuration = sorted[0] || 0;
        const latestDuration = durations[durations.length - 1] || 0;

        // Compute trend: compare first half average vs second half average
        let trend: 'faster' | 'slower' | 'stable' = 'stable';
        if (durations.length >= 4) {
          const mid = Math.floor(durations.length / 2);
          const firstHalf = durations.slice(0, mid);
          const secondHalf = durations.slice(mid);
          const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
          const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

          const changePercent = ((secondAvg - firstAvg) / firstAvg) * 100;
          if (changePercent > 10) trend = 'slower';
          else if (changePercent < -10) trend = 'faster';
        }

        return {
          id: entry.id,
          title: entry.title,
          filePath: entry.filePath,
          avgDuration,
          maxDuration,
          minDuration,
          runCount: durations.length,
          trend,
          latestDuration,
        };
      },
    )
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, 20);
}

// ─── getProjectTimeoutOpportunities ──────────────────────────────

/**
 * Rank tests whose configured per-test timeout is far larger than their real
 * duration (so failures/hangs waste time), or that still carry a `test.slow()`
 * mark they no longer need. Pure detection lives in
 * `#shared/analytics/timeout-hygiene`; this handler only assembles each test's
 * duration history + latest timeout + latest annotations from recent runs.
 */
export async function getProjectTimeoutOpportunities(
  db: DrizzleDB,
  projectId: number,
  runsCount: number,
  thresholds?: TimeoutThresholds,
): Promise<TimeoutOpportunity[]> {
  const projectResults: any[] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
  if (!projectResults[0]) throw new Error('Project not found');

  const effectiveLimit = Math.min(runsCount, 100);

  const recentRuns: any[] = await db
    .select({ id: testRuns.id })
    .from(testRuns)
    .where(eq(testRuns.projectId, projectId))
    .orderBy(desc(testRuns.startTime))
    .limit(effectiveLimit);

  const runIds: number[] = recentRuns.map((r: any) => r.id);
  if (runIds.length === 0) return [];

  const results: any[] = await db
    .select({
      testCaseId: testRunsCases.testCaseId,
      duration: testRunsCases.duration,
      timeout: testRunsCases.timeout,
      status: testRunsCases.status,
      testAnnotations: testRunsCases.testAnnotations,
      startTime: testRuns.startTime,
      title: testCases.title,
      filePath: testCases.filePath,
    })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(and(inArray(testRunsCases.testRunId, runIds), eq(testCases.projectId, projectId)));

  type Acc = {
    testCaseId: number;
    title: string;
    filePath: string;
    durations: number[];
    failCount: number;
    latestTime: number;
    timeout: number | null;
    hasSlowAnnotation: boolean;
  };
  const byCase = new Map<number, Acc>();

  for (const row of results) {
    let acc = byCase.get(row.testCaseId);
    if (!acc) {
      acc = {
        testCaseId: row.testCaseId,
        title: row.title,
        filePath: row.filePath,
        durations: [],
        failCount: 0,
        latestTime: -Infinity,
        timeout: null,
        hasSlowAnnotation: false,
      };
      byCase.set(row.testCaseId, acc);
    }
    if (row.duration !== null && row.duration !== undefined) acc.durations.push(row.duration);
    if (row.status === 'failed' || row.status === 'timedout' || row.status === 'timedOut') acc.failCount++;
    // Latest execution wins for the "current" timeout + slow annotation state.
    const t = new Date(row.startTime).getTime();
    if (t >= acc.latestTime) {
      acc.latestTime = t;
      acc.timeout = row.timeout ?? null;
      acc.hasSlowAnnotation = hasSlowMark(row.testAnnotations as Array<{ type?: string }> | null);
    }
  }

  const opportunities: TimeoutOpportunity[] = [];
  for (const acc of byCase.values()) {
    const opp = detectTimeoutOpportunity(
      {
        testCaseId: acc.testCaseId,
        title: acc.title,
        filePath: acc.filePath,
        durations: acc.durations,
        timeout: acc.timeout,
        hasSlowAnnotation: acc.hasSlowAnnotation,
        failCount: acc.failCount,
      },
      thresholds,
    );
    if (opp) opportunities.push(opp);
  }

  return opportunities.sort((a, b) => b.impact - a.impact).slice(0, 50);
}

// ─── getProjectFailureClusters ───────────────────────────────────

export async function getProjectFailureClusters(db: DrizzleDB, projectId: number, statusFilter?: string) {
  const projectResults: any[] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));

  if (!projectResults[0]) throw new Error('Project not found');

  const whereClauses = [eq(failureClusters.projectId, projectId)];
  if (statusFilter && ['open', 'resolved', 'ignored'].includes(statusFilter)) {
    whereClauses.push(eq(failureClusters.status, statusFilter));
  }

  const clusters: any[] = await db
    .select({
      id: failureClusters.id,
      fingerprint: failureClusters.fingerprint,
      signature: failureClusters.signature,
      title: failureClusters.title,
      errorType: failureClusters.errorType,
      selector: failureClusters.selector,
      sampleError: failureClusters.sampleError,
      status: failureClusters.status,
      triageNote: failureClusters.triageNote,
      firstSeenRunId: failureClusters.firstSeenRunId,
      lastSeenRunId: failureClusters.lastSeenRunId,
      occurrences: failureClusters.occurrences,
      fixLandedRunId: failureClusters.fixLandedRunId,
      fixLandedAt: failureClusters.fixLandedAt,
      fixCommit: failureClusters.fixCommit,
      timeToResolutionMs: failureClusters.timeToResolutionMs,
      fixVerification: failureClusters.fixVerification,
      assignee: failureClusters.assignee,
      snoozedUntil: failureClusters.snoozedUntil,
      snoozeMode: failureClusters.snoozeMode,
    })
    .from(failureClusters)
    .where(and(...whereClauses))
    .orderBy(desc(failureClusters.lastSeenRunId))
    .limit(100);

  if (clusters.length === 0) return [];

  // Distinct affected test cases per cluster (occurrences counts retries too)
  const clusterIds: number[] = clusters.map((c: any) => c.id);
  const counts: any[] = await db
    .select({
      clusterId: testRunsCases.failureClusterId,
      affectedTests: sql<number>`count(distinct ${testRunsCases.testCaseId})`,
    })
    .from(testRunsCases)
    .where(inArray(testRunsCases.failureClusterId, clusterIds))
    .groupBy(testRunsCases.failureClusterId);
  const affectedById = new Map(counts.map((c: any) => [c.clusterId, Number(c.affectedTests)]));

  // Resolve lastSeen run status and start time
  const lastSeenRunIds: number[] = [...new Set(clusters.map((c: any) => c.lastSeenRunId))] as number[];
  const lastSeenRuns: any[] = await db
    .select({
      id: testRuns.id,
      status: testRuns.status,
      startTime: testRuns.startTime,
    })
    .from(testRuns)
    .where(inArray(testRuns.id, lastSeenRunIds));

  const runDataById = new Map(lastSeenRuns.map((r: any) => [r.id, { status: r.status, startTime: r.startTime }]));

  // Attach compact diagnosis subset
  const diagnosisRows: any[] =
    clusterIds.length > 0
      ? await db
          .select({
            clusterId: failureDiagnoses.clusterId,
            status: failureDiagnoses.status,
            category: failureDiagnoses.category,
            confidence: failureDiagnoses.confidence,
            summary: failureDiagnoses.summary,
          })
          .from(failureDiagnoses)
          .where(inArray(failureDiagnoses.clusterId, clusterIds))
      : [];
  const diagnosisById = new Map(diagnosisRows.map((d: any) => [d.clusterId, d]));

  // A pinned known-issue link per cluster (newest wins), carried into the list as
  // a compact chip so a triaged cluster shows what is already tracking it.
  const linkRows: any[] = await db
    .select({
      clusterId: entityLinks.failureClusterId,
      id: entityLinks.id,
      url: entityLinks.url,
      provider: entityLinks.provider,
      key: entityLinks.key,
    })
    .from(entityLinks)
    .where(inArray(entityLinks.failureClusterId, clusterIds))
    .orderBy(desc(entityLinks.id));
  const issueByCluster = new Map<number, { url: string; provider: string; key: string | null }>();
  for (const row of linkRows) {
    if (row.clusterId != null && !issueByCluster.has(row.clusterId)) {
      issueByCluster.set(row.clusterId, { url: row.url, provider: row.provider, key: row.key ?? null });
    }
  }

  return clusters.map((c: any) => {
    const runData = runDataById.get(c.lastSeenRunId) as { status: string; startTime: Date } | undefined;
    return {
      ...c,
      affectedTests: affectedById.get(c.id) ?? 0,
      lastSeenRunStatus: runData?.status ?? null,
      lastSeenAt: runData?.startTime ?? null,
      diagnosis: diagnosisById.get(c.id) ?? null,
      issueLink: issueByCluster.get(c.id) ?? null,
    };
  });
}

// ─── getProjectFlakyTests ────────────────────────────────────────

const TERMINAL_STATUSES = ['passed', 'failed', 'timedout', 'interrupted'];

/**
 * Resolve the `test_cases.id`s in a project matching a tag/owner/priority
 * filter, or `null` when no filter was requested (meaning "no restriction").
 */
async function resolveFilteredCaseIds(
  db: DrizzleDB,
  projectId: number,
  filter?: FlakyTestsFilter,
): Promise<Set<number> | null> {
  const conditions = [eq(testCases.projectId, projectId)];
  if (filter?.tags?.length) conditions.push(...jsonArrayContainsAll(testCases.tags, filter.tags));
  if (filter?.owner) conditions.push(eq(testCases.owner, filter.owner));
  if (filter?.priority) conditions.push(eq(testCases.priority, filter.priority));
  if (conditions.length === 1) return null;

  const rows: any[] = await db
    .select({ id: testCases.id })
    .from(testCases)
    .where(and(...conditions));
  return new Set(rows.map((r) => r.id as number));
}

/** Narrow the flaky leaderboard to the tests a team actually owns. */
export interface FlakyTestsFilter {
  /** Every tag must be present on the case. */
  tags?: string[];
  owner?: string;
  priority?: string;
}

export async function getProjectFlakyTests(
  db: DrizzleDB,
  projectId: number,
  runsLimit: number,
  environment?: string | null,
  filter?: FlakyTestsFilter,
  branch?: string | null,
) {
  const projectResults: any[] = await db
    .select({ id: projects.id, defaultBranch: projects.defaultBranch })
    .from(projects)
    .where(eq(projects.id, projectId));
  const project = projectResults[0];
  if (!project) throw new Error('Project not found');

  const effectiveLimit = Math.min(200, Math.max(1, runsLimit));

  // Step 1: Last N terminal runs. An explicit branch filter scopes to exactly
  // that branch. Otherwise, when the project's default branch is known, the
  // leaderboard reads default-branch runs (plus runs with no branch, e.g. local
  // or pre-migration) so a work-in-progress branch stops contaminating the
  // project's health signal. Environment scopes independently.
  const runsConditions = [eq(testRuns.projectId, projectId)];
  if (environment) runsConditions.push(eq(testRuns.environment, environment));
  if (branch) {
    runsConditions.push(eq(testRuns.branch, branch));
  } else if (project.defaultBranch) {
    runsConditions.push(or(eq(testRuns.branch, project.defaultBranch), isNull(testRuns.branch))!);
  }
  const recentRuns: any[] = await db
    .select({ id: testRuns.id, startTime: testRuns.startTime })
    .from(testRuns)
    .where(and(...runsConditions))
    .orderBy(desc(testRuns.startTime))
    .limit(effectiveLimit);

  if (recentRuns.length === 0) return [];

  const runIds: number[] = recentRuns.map((r: any) => r.id);

  // Re-fetch with status filter
  const runsWithStatus: any[] = await db
    .select({ id: testRuns.id, startTime: testRuns.startTime, status: testRuns.status })
    .from(testRuns)
    .where(inArray(testRuns.id, runIds));
  const filteredRuns: any[] = runsWithStatus.filter((r: any) => TERMINAL_STATUSES.includes(r.status));

  if (filteredRuns.length === 0) return [];
  const filteredRunIds: number[] = filteredRuns.map((r: any) => r.id);
  const runStartTimeById = new Map(filteredRuns.map((r: any) => [r.id, r.startTime]));

  // Step 2: All test_runs_cases for those runs
  const allRows: any[] = await db
    .select({
      id: testRunsCases.id,
      testRunId: testRunsCases.testRunId,
      testCaseId: testRunsCases.testCaseId,
      status: testRunsCases.status,
      retries: testRunsCases.retries,
      duration: testRunsCases.duration,
      browser: testRunsCases.browser,
    })
    .from(testRunsCases)
    .where(inArray(testRunsCases.testRunId, filteredRunIds));

  // Step 3: Per (testCaseId, runId, browserKey): group rows
  type BrowserGroup = { rows: any[]; finalStatus: string; retryPass: boolean };
  const runDataMap = new Map<number, Map<number, Map<string, BrowserGroup>>>();

  for (const row of allRows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = row.browser as any;
    const browserKey: string = b?.projectName ?? b?.browserName ?? '';

    let byRun = runDataMap.get(row.testCaseId);
    if (!byRun) {
      byRun = new Map();
      runDataMap.set(row.testCaseId, byRun);
    }
    let byBrowser = byRun.get(row.testRunId);
    if (!byBrowser) {
      byBrowser = new Map();
      byRun.set(row.testRunId, byBrowser);
    }
    let group = byBrowser.get(browserKey);
    if (!group) {
      group = { rows: [], finalStatus: '', retryPass: false };
      byBrowser.set(browserKey, group);
    }
    group.rows.push(row);
  }

  // Compute per-browser group finalStatus and retryPass
  for (const [, byRun] of runDataMap) {
    for (const [, byBrowser] of byRun) {
      for (const [, group] of byBrowser) {
        const sorted = group.rows.slice().sort((a: any, b: any) => (a.retries ?? 0) - (b.retries ?? 0));
        const maxRetryRow = sorted[sorted.length - 1];
        group.finalStatus = maxRetryRow?.status ?? 'unknown';
        const hasFailed = group.rows.some((r: any) => FAILED_STATUS_KEYS.includes(r.status));
        const hasPassed = group.rows.some((r: any) => r.status === 'passed');
        group.retryPass = hasFailed && hasPassed;
      }
    }
  }

  // Step 4: Per testCaseId: aggregate across runs
  type CaseAgg = {
    totalRuns: number;
    failedRuns: number;
    retryPassRuns: number;
    alternations: number;
    lastFlakeRunId: number | null;
    lastFlakeAt: Date | null;
    latestRunsCaseId: number;
    failedDurations: number[];
  };

  const caseAggMap = new Map<number, CaseAgg>();

  // Process runs oldest → newest
  const sortedRuns = [...filteredRuns].sort((a: any, b: any) => a.startTime.getTime() - b.startTime.getTime());

  for (const testCaseId of runDataMap.keys()) {
    const byRun = runDataMap.get(testCaseId)!;
    let prevFinalFailed: boolean | null = null;
    let alternations = 0;
    let totalRuns = 0;
    let failedRuns = 0;
    let retryPassRuns = 0;
    let lastFlakeRunId: number | null = null;
    let lastFlakeAt: Date | null = null;
    let latestRunsCaseId = 0;
    const failedDurations: number[] = [];

    for (const run of sortedRuns) {
      const byBrowser = byRun.get(run.id);
      if (!byBrowser) continue;

      totalRuns++;
      let runFinalFailed = false;
      let runRetryPass = false;

      for (const [, group] of byBrowser) {
        if (group.finalStatus === 'failed' || group.finalStatus === 'timedOut') runFinalFailed = true;
        if (group.retryPass) runRetryPass = true;

        for (const row of group.rows) {
          if (row.id > latestRunsCaseId) latestRunsCaseId = row.id;
          if ((row.status === 'failed' || row.status === 'timedOut') && row.duration != null) {
            failedDurations.push(row.duration);
          }
        }
      }

      if (runFinalFailed) failedRuns++;
      if (runRetryPass) {
        retryPassRuns++;
        lastFlakeRunId = run.id;
        lastFlakeAt = runStartTimeById.get(run.id) ?? null;
      }

      if (prevFinalFailed !== null && prevFinalFailed !== runFinalFailed) {
        alternations++;
        if (!runRetryPass) {
          lastFlakeRunId = run.id;
          lastFlakeAt = runStartTimeById.get(run.id) ?? null;
        }
      }
      prevFinalFailed = runFinalFailed;
    }

    caseAggMap.set(testCaseId, {
      totalRuns,
      failedRuns,
      retryPassRuns,
      alternations,
      lastFlakeRunId,
      lastFlakeAt,
      latestRunsCaseId,
      failedDurations,
    });
  }

  // Step 5: Filter candidates and compute scores
  const candidates: Array<{
    testCaseId: number;
    latestRunsCaseId: number;
    totalRuns: number;
    failedRuns: number;
    retryPassRuns: number;
    alternations: number;
    failureRate: number;
    score: number;
    lastFlakeAt: Date | null;
    avgFailedDurationMs: number;
    wastedCiMinutes: number;
    impact: number;
  }> = [];

  // Applied before ranking so the top-N slice is taken from matching tests
  // only — filtering the slice afterwards would return fewer than N rows.
  const allowedCaseIds = await resolveFilteredCaseIds(db, projectId, filter);

  for (const [testCaseId, agg] of caseAggMap) {
    if (allowedCaseIds && !allowedCaseIds.has(testCaseId)) continue;
    if (agg.totalRuns < 3) continue;
    if (agg.retryPassRuns < 1 && agg.alternations < 2) continue;

    const retryRate = agg.retryPassRuns / agg.totalRuns;
    const altRate = agg.alternations / Math.max(1, agg.totalRuns - 1);
    const score = Math.min(100, Math.max(1, Math.round(100 * (0.6 * retryRate + 0.4 * altRate))));
    const failureRate = agg.failedRuns / agg.totalRuns;

    const avgFailedDurationMs =
      agg.failedDurations.length > 0
        ? Math.round(agg.failedDurations.reduce((a, b) => a + b, 0) / agg.failedDurations.length)
        : 0;
    const wastedCiMinutes = (avgFailedDurationMs / 60000) * agg.retryPassRuns;
    const wastedCiMinutesVal = Math.round(wastedCiMinutes * 100) / 100;
    const impact = Math.round(wastedCiMinutesVal * 0.7 + agg.retryPassRuns * 30 * 0.3);

    candidates.push({
      testCaseId,
      latestRunsCaseId: agg.latestRunsCaseId,
      totalRuns: agg.totalRuns,
      failedRuns: agg.failedRuns,
      retryPassRuns: agg.retryPassRuns,
      alternations: agg.alternations,
      failureRate,
      score,
      lastFlakeAt: agg.lastFlakeAt,
      avgFailedDurationMs,
      wastedCiMinutes: wastedCiMinutesVal,
      impact,
    });
  }

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => b.impact - a.impact || b.score - a.score || b.retryPassRuns - a.retryPassRuns);
  const top = candidates.slice(0, 50);

  // Step 6: Join titles/filePaths + rootCause
  const testCaseIds: number[] = top.map((c) => c.testCaseId);
  const testCaseRows: any[] = await db
    .select({
      id: testCases.id,
      title: testCases.title,
      filePath: testCases.filePath,
      flakyRootCause: testCases.flakyRootCause,
      tags: testCases.tags,
      owner: testCases.owner,
      priority: testCases.priority,
    })
    .from(testCases)
    .where(inArray(testCases.id, testCaseIds));
  const testCaseById = new Map(testCaseRows.map((t: any) => [t.id, t]));

  return top.map((c) => {
    const tc = testCaseById.get(c.testCaseId);
    return {
      testCaseId: c.testCaseId,
      latestRunsCaseId: c.latestRunsCaseId,
      title: tc?.title ?? '',
      filePath: tc?.filePath ?? '',
      totalRuns: c.totalRuns,
      failedRuns: c.failedRuns,
      retryPassRuns: c.retryPassRuns,
      alternations: c.alternations,
      failureRate: Math.round(c.failureRate * 100) / 100,
      score: c.score,
      lastFlakeAt: c.lastFlakeAt,
      rootCause: tc?.flakyRootCause ?? null,
      tags: (tc?.tags as string[] | null) ?? null,
      owner: tc?.owner ?? null,
      priority: tc?.priority ?? null,
      impact: c.impact,
      wastedCiMinutes: c.wastedCiMinutes,
      avgFailedDurationMs: c.avgFailedDurationMs,
    };
  });
}

// ─── getProjectsOverview ─────────────────────────────────────────────────────

const FAILING_STATUSES = ['failed', 'timedout', 'interrupted'];

function deriveTendency(runs: { status: string; flakyTests: number }[]): 'passing' | 'flaky' | 'failing' | 'unknown' {
  if (runs.length < 2) return 'unknown';
  const latest = runs[runs.length - 1]!;
  if (FAILING_STATUSES.includes(latest.status)) return 'failing';
  const w = runs.slice(-5);
  const hasFlaky = w.some((r) => (r.flakyTests ?? 0) > 0);
  const anyFailed = w.some((r) => FAILING_STATUSES.includes(r.status));
  const anyPassed = w.some((r) => r.status === 'passed');
  if (hasFlaky || (anyFailed && anyPassed)) return 'flaky';
  if (w.every((r) => r.status === 'passed')) return 'passing';
  return 'unknown';
}

export async function getProjectsOverview(db: DrizzleDB, scope: ProjectScope = 'all') {
  const { ids: projectIds, projects: allProjects } = await getProjects(db, scope);

  // Tags per project (batched)
  const tagRows: any[] = await db
    .select({ projectId: projectTags.projectId, tag: tags })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(inArray(projectTags.projectId, projectIds));

  const tagsByProjectId = new Map<number, any[]>();
  for (const r of tagRows) {
    const list = tagsByProjectId.get(r.projectId) ?? [];
    list.push(r.tag);
    tagsByProjectId.set(r.projectId, list);
  }

  // Total full run counts per project
  const fullRunStats: any[] = await db
    .select({
      projectId: testRuns.projectId,
      totalFullRuns: count(),
    })
    .from(testRuns)
    .where(and(inArray(testRuns.projectId, projectIds), eq(testRuns.isFullRun, 1)))
    .groupBy(testRuns.projectId);

  const totalFullRunsByProjectId = new Map<number, number>();
  for (const r of fullRunStats) {
    totalFullRunsByProjectId.set(r.projectId, Number(r.totalFullRuns));
  }

  // Last 20 full runs per project using a CTE with window function
  let recentFullRuns: any[] = [];
  if (projectIds.length > 0) {
    const rankedCte = db.$with('ranked_runs').as(
      db
        .select({
          id: testRuns.id,
          projectId: testRuns.projectId,
          status: testRuns.status,
          passedTests: testRuns.passedTests,
          failedTests: testRuns.failedTests,
          flakyTests: testRuns.flakyTests,
          totalTests: testRuns.totalTests,
          startTime: testRuns.startTime,
          duration: testRuns.duration,
          environment: testRuns.environment,
          rn: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${testRuns.projectId} ORDER BY ${testRuns.startTime} DESC)`.as(
            'rn',
          ),
        })
        .from(testRuns)
        .where(and(inArray(testRuns.projectId, projectIds), eq(testRuns.isFullRun, 1))),
    );

    recentFullRuns = await db
      .with(rankedCte)
      .select({
        id: rankedCte.id,
        projectId: rankedCte.projectId,
        status: rankedCte.status,
        passedTests: rankedCte.passedTests,
        failedTests: rankedCte.failedTests,
        flakyTests: rankedCte.flakyTests,
        totalTests: rankedCte.totalTests,
        startTime: rankedCte.startTime,
        duration: rankedCte.duration,
        environment: rankedCte.environment,
      })
      .from(rankedCte)
      .where(lte(rankedCte.rn, 20))
      .orderBy(rankedCte.projectId, rankedCte.startTime);
  }

  // Group runs by projectId (each list is oldest → newest)
  const runsByProjectId = new Map<number, any[]>();
  for (const run of recentFullRuns) {
    const list = runsByProjectId.get(run.projectId) ?? [];
    list.push(run);
    runsByProjectId.set(run.projectId, list);
  }

  return allProjects.map((project: any) => {
    const runs = runsByProjectId.get(project.id) ?? [];
    const latest = runs.length > 0 ? runs[runs.length - 1] : null;
    return {
      id: project.id,
      name: project.name,
      label: project.label ?? null,
      tags: tagsByProjectId.get(project.id) ?? [],
      totalFullRuns: totalFullRunsByProjectId.get(project.id) ?? 0,
      latestFullRun: latest
        ? {
            id: latest.id,
            status: latest.status,
            startTime: latest.startTime,
            duration: latest.duration ?? null,
            passedTests: latest.passedTests ?? 0,
            failedTests: latest.failedTests ?? 0,
            flakyTests: latest.flakyTests ?? 0,
            totalTests: latest.totalTests ?? 0,
          }
        : null,
      recentRuns: runs.map((r: any) => ({
        id: r.id,
        status: r.status,
        passedTests: r.passedTests ?? 0,
        failedTests: r.failedTests ?? 0,
        flakyTests: r.flakyTests ?? 0,
        totalTests: r.totalTests ?? 0,
        startTime: r.startTime,
        environment: r.environment ?? null,
      })),
      tendency: deriveTendency(runs),
    };
  });
}
