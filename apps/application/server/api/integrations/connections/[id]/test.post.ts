import { getDatabase } from '../../../../database';
import { requireAuth } from '../../../../utils/auth';
import { testConnection } from '../../../../utils/integrations/connections';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Test an integration connection',
    description:
      'Verifies the connection by resolving the authenticated account (Jira `whoAmI`) and records the outcome. Soft-fail: a reachable provider that rejects the credentials returns HTTP 200 with `{ ok: false, error }`.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw apiError({ statusCode: 400, message: 'Invalid connection ID' });

  const db = await getDatabase();
  const result = await testConnection(db, id);
  if (!result) throw apiError({ statusCode: 404, message: 'Connection not found' });
  return result;
});
