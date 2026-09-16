/**
 * The one filter object every analytics widget receives. Parsed from the
 * request query on both the server route and the demo router so the two stay
 * identical by construction.
 */

export interface AnalyticsScope {
  /** Period length in days (clamped to 1–3650). The period ends now. */
  days: number;
  /** Optional explicit project filter (always intersected with the caller's access scope). */
  projectIds?: number[];
  /** Restrict to runs reported for any of these deployment environments. */
  environments?: string[];
  /** Restrict to runs reported on any of these SCM branches. */
  branches?: string[];
  /** Only count full-suite runs (default) — partial/--grep runs skew every rate. */
  fullRunsOnly: boolean;
}

export const ANALYTICS_PERIODS = [7, 30, 90, 365] as const;

export const DEFAULT_ANALYTICS_DAYS = 30;

/** "All time" is expressed as a 10-year window so the bucket math needs no special case. */
export const MAX_ANALYTICS_DAYS = 3650;

type QueryLike = URLSearchParams | Record<string, unknown> | undefined | null;

function pick(query: QueryLike, key: string): string | null {
  if (!query) return null;
  if (query instanceof URLSearchParams) return query.get(key);
  const value = (query as Record<string, unknown>)[key];
  if (value == null) return null;
  return Array.isArray(value) ? String(value[0] ?? '') : String(value);
}

export function parseAnalyticsScope(query: QueryLike): AnalyticsScope {
  const rawDays = Number(pick(query, 'days'));
  const days =
    Number.isFinite(rawDays) && rawDays > 0
      ? Math.min(MAX_ANALYTICS_DAYS, Math.round(rawDays))
      : DEFAULT_ANALYTICS_DAYS;

  const rawProjects = pick(query, 'projects');
  const projectIds = rawProjects
    ? rawProjects
        .split(',')
        .map((p) => Number(p))
        .filter((p) => Number.isInteger(p) && p > 0)
    : undefined;

  const environments = parseList(pick(query, 'environments') ?? pick(query, 'environment'));
  const branches = parseList(pick(query, 'branches') ?? pick(query, 'branch'));
  const fullRunsOnly = pick(query, 'fullRunsOnly') !== 'false';

  return {
    days,
    projectIds: projectIds && projectIds.length > 0 ? projectIds : undefined,
    environments,
    branches,
    fullRunsOnly,
  };
}

/** Split a comma-separated query value into a trimmed, non-empty list (undefined when empty). */
function parseList(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  return values.length > 0 ? values : undefined;
}

/** Serialize a scope back into query params (used by the client composable). */
export function analyticsScopeToQuery(scope: AnalyticsScope): Record<string, string> {
  const query: Record<string, string> = { days: String(scope.days) };
  if (scope.projectIds && scope.projectIds.length > 0) query.projects = scope.projectIds.join(',');
  if (scope.environments && scope.environments.length > 0) query.environments = scope.environments.join(',');
  if (scope.branches && scope.branches.length > 0) query.branches = scope.branches.join(',');
  if (!scope.fullRunsOnly) query.fullRunsOnly = 'false';
  return query;
}
