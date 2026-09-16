import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { listTrackerConnections } from '../../utils/integrations/connections';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Which trackers are connected',
    description:
      'Lists the connected trackers a member can file into. Drives whether the create-issue entry points show.',
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();
  return { trackers: await listTrackerConnections(db) };
});
