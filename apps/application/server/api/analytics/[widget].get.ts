import { requireAuth } from '../../utils/auth';
import { getProjectScope } from '../../utils/project-access';
import { getDatabase } from '../../database';
import { isAnalyticsWidgetId, runAnalyticsWidget } from '#shared/handlers/analytics';
import { parseAnalyticsScope } from '#shared/analytics/scope';
import { getAnalyticsScopeSummary } from '#shared/handlers/analytics/scope-summary';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'Cross-project analytics widget data',
    description:
      'Returns the data for one analytics widget (see the widget registry: insights, portfolio, pass-rate-heatmap, ci-time-trend, wasted-time, flaky-leaderboard, cluster-landscape, regression-velocity, browser-matrix, slow-endpoints), aggregated across every project the caller can see. Scalar series read the daily rollups; with a test filter they are counted from the matching executions. Probe runs are never counted. The reserved name `scope` returns how the scope resolves instead: the period and comparison as dates, notes (a selection missing in a project, a deleted marker), the markers to draw inside the period, recent markers a period can anchor on, the selection keys and browsers the test filter offers, and where the rollup data starts.',
    parameters: [
      { name: 'widget', in: 'path', required: true, schema: { type: 'string' } },
      {
        name: 'period',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description:
          'Period in compact form: `last-30d`, `this-month`, `last-quarter`, `2026-08-01..2026-08-31`, `since-marker-12`, `markers-12..15`, `release-0`, `sprint-0@2026-09-01/14d`, `all`. Wins over `days`',
      },
      {
        name: 'days',
        in: 'query',
        required: false,
        schema: { type: 'integer' },
        description: 'Legacy period length in days, ending now (3650 = all time). Read when `period` is absent',
      },
      {
        name: 'compare',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Comparison: `previous` (default), `previous-unit`, `year`, `none`, or `YYYY-MM-DD..YYYY-MM-DD`',
      },
      {
        name: 'by',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Granularity of series: `auto` (default), `day`, `week`, `month`',
      },
      {
        name: 'projects',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Comma-separated project ids to restrict to',
      },
      {
        name: 'projectTags',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Comma-separated project tags; only projects carrying one of them',
      },
      {
        name: 'environments',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Comma-separated environments (`environment` is accepted too)',
      },
      {
        name: 'branches',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Comma-separated branches (`branch` is accepted too); turns the default-branch policy off',
      },
      {
        name: 'allBranches',
        in: 'query',
        required: false,
        schema: { type: 'boolean' },
        description: 'Count every branch instead of each project’s default branch plus unknown-branch runs',
      },
      {
        name: 'fullRunsOnly',
        in: 'query',
        required: false,
        schema: { type: 'boolean', default: true },
        description: 'Only count full-suite runs',
      },
      {
        name: 'sel',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Test filter: a selection key, resolved in each project',
      },
      {
        name: 'tags',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Test filter: tests carrying every one of these tags',
      },
      {
        name: 'anyTags',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Test filter: tests carrying any of these tags',
      },
      {
        name: 'owner',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Test filter: comma-separated owners',
      },
      {
        name: 'priority',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Test filter: comma-separated priorities (critical, high, medium, low)',
      },
      {
        name: 'feature',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Test filter: comma-separated features',
      },
      {
        name: 'files',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Test filter: comma-separated file globs',
      },
      {
        name: 'q',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Test filter: text in the title or file path',
      },
      {
        name: 'quarantined',
        in: 'query',
        required: false,
        schema: { type: 'boolean' },
        description: 'Test filter: only quarantined (true) or only not quarantined (false) tests',
      },
      {
        name: 'browsers',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Test filter on executions: comma-separated Playwright project names (`browser` is accepted too)',
      },
      {
        name: 'tz',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'IANA time zone for calendar periods (default UTC)',
      },
      {
        name: 'locale',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Locale for the first day of the week',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const widget = getRouterParam(event, 'widget');
  if (widget === 'scope') {
    const db = await getDatabase();
    const access = await getProjectScope(db, user as any);
    return getAnalyticsScopeSummary(db, parseAnalyticsScope(getQuery(event)), access);
  }
  if (!isAnalyticsWidgetId(widget)) {
    throw apiError({ statusCode: 404, message: 'Unknown analytics widget' });
  }

  const db = await getDatabase();
  const access = await getProjectScope(db, user as any);
  const scope = parseAnalyticsScope(getQuery(event));
  return runAnalyticsWidget(db, widget, scope, access);
});
