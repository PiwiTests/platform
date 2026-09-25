import { getProjectScope, requireProjectAccess, requireRouteId } from '../../utils/project-access';
import { getShareLink, revokeShareLink } from '../../utils/share-links';
import { forgetLiveDashboard } from '../../utils/share-view';
import { requireAuth } from '../../utils/auth';
import { dashboardActor, dashboardRoute } from '../../utils/dashboards';
import { reportRoute } from '../../utils/reports/context';
import { getDatabase } from '../../database';
import { getReportSnapshot } from '#shared/handlers/reports';
import { loadDashboardDefinition } from '#shared/handlers/dashboards';

defineRouteMeta({
  openAPI: {
    tags: ['Share Links'],
    summary: 'Revoke a share link',
    description:
      'Revokes a share link immediately. The row is kept for the audit trail. A report link needs access to every project of its snapshot, a live dashboard link access to its dashboard, any other link access to its project.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'share link ID');
  const db = await getDatabase();
  const link = await getShareLink(db, id);
  if (!link) {
    throw apiError({ statusCode: 404, message: 'Share link not found' });
  }
  if (link.entityKind === 'report') {
    const user = await requireAuth(event);
    await reportRoute(async () => getReportSnapshot(db as any, link.entityId, await getProjectScope(db, user as any)));
  } else if (link.entityKind === 'dashboard') {
    const user = await requireAuth(event);
    await dashboardRoute(() =>
      loadDashboardDefinition(db as any, String(link.entityId), dashboardActor(event, user as any)),
    );
  } else if (link.projectId != null) {
    await requireProjectAccess(event, link.projectId);
  } else {
    await requireAuth(event);
  }
  await revokeShareLink(db, id);
  forgetLiveDashboard(id);
  return { success: true };
});
