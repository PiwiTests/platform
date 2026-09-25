import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { dashboardActor, dashboardRoute } from '../../../utils/dashboards';
import { listEntityShareLinks } from '../../../utils/share-links';
import { savedDashboardId } from '../../../utils/share-view';
import { loadDashboardDefinition } from '#shared/handlers/dashboards';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'List live dashboard links',
    description:
      'The live dashboard links minted for this saved dashboard: prefixes and lifecycle only, never the tokens. A built-in dashboard has none; duplicate it to share it.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const id = savedDashboardId(event);
  await dashboardRoute(() => loadDashboardDefinition(db as any, String(id), dashboardActor(event, user as any)));
  return { items: await listEntityShareLinks(db, 'dashboard', id) };
});
