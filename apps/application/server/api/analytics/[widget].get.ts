import { requireAuth } from '../../utils/auth';
import { getProjectScope } from '../../utils/project-access';
import { getDatabase } from '../../database';
import { isAnalyticsWidgetId, runAnalyticsWidget } from '#shared/handlers/analytics';
import { parseAnalyticsScope } from '#shared/analytics/scope';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'Cross-project analytics widget data',
    description:
      'Returns the data for one analytics widget (see the widget registry: insights, portfolio, pass-rate-heatmap, ci-time-trend, wasted-time, flaky-leaderboard, cluster-landscape), aggregated across every project the caller can see.',
    parameters: [
      { name: 'widget', in: 'path', required: true, schema: { type: 'string' } },
      {
        name: 'days',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 30, maximum: 3650 },
        description: 'Period length in days (the period ends now)',
      },
      {
        name: 'projects',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Comma-separated project ids to restrict to',
      },
      {
        name: 'environment',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Restrict to runs reported for one environment',
      },
      {
        name: 'fullRunsOnly',
        in: 'query',
        required: false,
        schema: { type: 'boolean', default: true },
        description: 'Only count full-suite runs',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const widget = getRouterParam(event, 'widget');
  if (!isAnalyticsWidgetId(widget)) {
    throw apiError({ statusCode: 404, message: 'Unknown analytics widget' });
  }

  const db = await getDatabase();
  const access = await getProjectScope(db, user as any);
  const scope = parseAnalyticsScope(getQuery(event));
  return runAnalyticsWidget(db, widget, scope, access);
});
