import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { getConnection } from '../../../utils/integrations/connections';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Get an integration connection',
    description: 'Returns a single connection. Credentials are never returned.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw apiError({ statusCode: 400, message: 'Invalid connection ID' });

  const db = await getDatabase();
  const connection = await getConnection(db, id);
  if (!connection) throw apiError({ statusCode: 404, message: 'Connection not found' });
  return { connection };
});
