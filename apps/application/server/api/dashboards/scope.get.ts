import { requireAuth } from '../../utils/auth';
import { getProjectScope } from '../../utils/project-access';
import { getDatabase } from '../../database';
import { parseAnalyticsScope } from '#shared/analytics/scope';
import { getAnalyticsScopeSummary } from '#shared/handlers/analytics/scope-summary';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'How an analytics scope resolves',
    description:
      'Takes the same query keys as `GET /api/widgets/[widget]` and returns how the scope resolves for the caller: the period and comparison as dates, notes (a selection missing in a project, a deleted marker), the markers to draw inside the period, recent markers a period can anchor on, the selection keys and browsers the test filter offers, and where the rollup data starts.',
    parameters: [
      {
        name: 'period',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Period in compact form (`last-30d`, `this-month`, `2026-08-01..2026-08-31`, …)',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const access = await getProjectScope(db, user as any);
  return getAnalyticsScopeSummary(db, parseAnalyticsScope(getQuery(event)), access);
});
