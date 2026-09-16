import { and, eq, gte, inArray } from 'drizzle-orm';
import { projects, testRuns, projectTags, tags } from '../../../server/database/schema';
import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsTagInfo } from '../../analytics/types';

export type ProjectAccess = 'all' | Set<number>;

export const TERMINAL_RUN_STATUSES = ['passed', 'failed', 'timedout', 'interrupted'];
export const FAILING_RUN_STATUSES = ['failed', 'timedout', 'interrupted'];

/**
 * Intersect the requested project filter with the caller's access scope.
 * Returns `'all'` (no restriction) or the allowed project id list (possibly empty).
 */
export function resolveAllowedProjects(scope: AnalyticsScope, access: ProjectAccess): 'all' | number[] {
  if (!scope.projectIds || scope.projectIds.length === 0) {
    return access === 'all' ? 'all' : [...access];
  }
  if (access === 'all') return scope.projectIds;
  return scope.projectIds.filter((id) => access.has(id));
}

export interface ScopedProject {
  id: number;
  name: string;
  label: string | null;
}

export async function fetchScopedProjects(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess,
): Promise<ScopedProject[]> {
  const allowed = resolveAllowedProjects(scope, access);
  if (allowed !== 'all' && allowed.length === 0) return [];

  const rows: any[] = await db
    .select({ id: projects.id, name: projects.name, label: projects.label })
    .from(projects)
    .where(allowed === 'all' ? undefined : inArray(projects.id, allowed));
  return rows;
}

export async function fetchTagsByProject(
  db: DrizzleDB,
  projectIds: number[],
): Promise<Map<number, AnalyticsTagInfo[]>> {
  const byProject = new Map<number, AnalyticsTagInfo[]>();
  if (projectIds.length === 0) return byProject;

  const rows: any[] = await db
    .select({ projectId: projectTags.projectId, id: tags.id, text: tags.text, color: tags.color })
    .from(projectTags)
    .innerJoin(tags, eq(projectTags.tagId, tags.id))
    .where(inArray(projectTags.projectId, projectIds));

  for (const row of rows) {
    const list = byProject.get(row.projectId) ?? [];
    list.push({ id: row.id, text: row.text, color: row.color });
    byProject.set(row.projectId, list);
  }
  return byProject;
}

export interface ScopedRun {
  id: number;
  projectId: number;
  status: string;
  startTime: Date;
  duration: number | null;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  flakyTests: number;
}

/**
 * Terminal runs matching the scope, starting `sinceDays` ago (ordered oldest →
 * newest). Most widgets fetch twice the period so they can compare against the
 * previous equal-length window.
 */
export async function fetchScopedRuns(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess,
  sinceDays: number,
): Promise<ScopedRun[]> {
  const allowed = resolveAllowedProjects(scope, access);
  if (allowed !== 'all' && allowed.length === 0) return [];

  const conditions = [
    gte(testRuns.startTime, new Date(Date.now() - sinceDays * DAY_MS)),
    inArray(testRuns.status, TERMINAL_RUN_STATUSES),
  ];
  if (allowed !== 'all') conditions.push(inArray(testRuns.projectId, allowed));
  if (scope.fullRunsOnly) conditions.push(eq(testRuns.isFullRun, 1));
  if (scope.environments && scope.environments.length > 0)
    conditions.push(inArray(testRuns.environment, scope.environments));
  if (scope.branches && scope.branches.length > 0) conditions.push(inArray(testRuns.branch, scope.branches));

  const rows: any[] = await db
    .select({
      id: testRuns.id,
      projectId: testRuns.projectId,
      status: testRuns.status,
      startTime: testRuns.startTime,
      duration: testRuns.duration,
      totalTests: testRuns.totalTests,
      passedTests: testRuns.passedTests,
      failedTests: testRuns.failedTests,
      flakyTests: testRuns.flakyTests,
    })
    .from(testRuns)
    .where(and(...conditions))
    .orderBy(testRuns.startTime);
  return rows;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export function periodStart(days: number): number {
  return Date.now() - days * DAY_MS;
}

/** ISO `YYYY-MM-DD` (UTC) for a date. */
export function dayKey(date: Date | string | number): string {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Fixed-size time buckets over the last `days` days, at most ~`maxBuckets`
 * buckets so a year-long period still renders a readable series.
 * Returns bucket start keys (oldest → newest) plus a lookup from timestamp.
 */
export function makeTimeBuckets(days: number, maxBuckets = 31) {
  const bucketDays = Math.max(1, Math.ceil(days / maxBuckets));
  const bucketMs = bucketDays * DAY_MS;
  const end = Date.now();
  const start = end - days * DAY_MS;
  const keys: string[] = [];
  for (let t = start; t < end; t += bucketMs) {
    keys.push(dayKey(t));
  }
  return {
    bucketDays,
    keys,
    keyFor(date: Date | string | number): string | null {
      const ts = new Date(date).getTime();
      if (ts < start || Number.isNaN(ts)) return null;
      const index = Math.min(keys.length - 1, Math.floor((ts - start) / bucketMs));
      return keys[index] ?? null;
    },
  };
}

/**
 * Index of the first non-empty entry, so long periods ("All time") don't
 * render years of empty leading buckets. Returns 0 when everything is empty.
 */
export function firstNonEmptyIndex<T>(items: T[], isEmpty: (item: T) => boolean): number {
  const index = items.findIndex((item) => !isEmpty(item));
  return index <= 0 ? 0 : index;
}

export function roundRate(passed: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((passed / total) * 1000) / 10;
}

export function minutes(ms: number): number {
  return Math.round((ms / 60000) * 10) / 10;
}
