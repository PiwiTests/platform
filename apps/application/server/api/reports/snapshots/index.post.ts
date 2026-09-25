import { getDatabase } from '../../../database';
import { requireAuth, isAuthEnabled } from '../../../utils/auth';
import { getProjectScope } from '../../../utils/project-access';
import { reportBaseUrl, reportPiwiVersion, reportRoute, reportScheduleTimeZone } from '../../../utils/reports/context';
import { createReportSnapshot } from '#shared/handlers/reports';
import { parseReportRequest } from '#shared/reports/request';

defineRouteMeta({
  openAPI: {
    tags: ['Reports'],
    summary: 'Generate and keep a quality report',
    description:
      'Renders a built-in dashboard over a scope, as `GET /api/reports/preview` does, and stores it as a report snapshot, so it can be reopened unchanged later. The body carries the same keys as the preview query (`dashboard`, `lang`, `period`, `projects`, …). Returns the snapshot id.',
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>;
  const request = await reportRoute(async () => parseReportRequest(body));
  const snapshot = await reportRoute(async () =>
    createReportSnapshot(
      db as any,
      { dashboard: request.dashboard, scope: request.scope, language: request.language },
      {
        access: await getProjectScope(db, user as any),
        timeZone: request.scope.timeZone ?? (await reportScheduleTimeZone(db)),
        baseUrl: reportBaseUrl(),
        piwiVersion: reportPiwiVersion(),
        createdBy: isAuthEnabled(event) ? user.id : null,
      },
    ),
  );
  setResponseStatus(event, 201);
  return snapshot;
});
