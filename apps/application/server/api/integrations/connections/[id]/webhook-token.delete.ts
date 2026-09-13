import { getDatabase } from '../../../../database';
import { requireAuth } from '../../../../utils/auth';
import { clearWebhookToken, getConnectionRow } from '../../../../utils/integrations/connections';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Disable the inbound webhook',
    description: 'Clear the connection webhook secret, turning the inbound webhook off. Requires administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw apiError({ statusCode: 400, message: 'Invalid connection ID' });

  const db = await getDatabase();
  const row = await getConnectionRow(db, id);
  if (!row) throw apiError({ statusCode: 404, message: 'Connection not found' });

  await clearWebhookToken(db, id);
  return { success: true };
});
