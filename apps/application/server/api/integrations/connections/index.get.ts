import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { listConnections } from '../../../utils/integrations/connections';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'List integration connections',
    description: 'Lists every configured integration connection. Credentials are never returned.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();
  return { connections: await listConnections(db) };
});
