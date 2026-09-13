import { getDatabase } from '../../../../database';
import { requireAuth } from '../../../../utils/auth';
import { getConnectionRow, setWebhookToken } from '../../../../utils/integrations/connections';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Generate an inbound-webhook token',
    description:
      'Generate (or rotate) the per-connection webhook secret and return it once, with the URL to register in Jira. The token is never returned by any read endpoint afterward. Requires administrator role.',
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

  const token = await setWebhookToken(db, id);
  if (!token) throw apiError({ statusCode: 404, message: 'Connection not found' });

  const base = process.env.PIWI_SITE_URL?.trim().replace(/\/$/, '') ?? '';
  const path = `/api/integrations/jira/webhook/${token}`;
  return { token, url: base ? `${base}${path}` : path };
});
