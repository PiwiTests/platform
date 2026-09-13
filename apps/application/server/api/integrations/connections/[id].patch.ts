import { z } from 'zod';
import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { getConnectionRow, updateConnection } from '../../../utils/integrations/connections';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Update an integration connection',
    description:
      'Updates a connection. An empty credential map keeps the stored credential. Environment-managed connections are read-only.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator'],
  },
});

const schema = z.object({
  name: z.string().min(1).max(200).optional(),
  baseUrl: z.string().url('Must be a valid URL').optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  credentials: z.record(z.string(), z.string()).nullable().optional(),
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw apiError({ statusCode: 400, message: 'Invalid connection ID' });

  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  const db = await getDatabase();
  const row = await getConnectionRow(db, id);
  if (!row) throw apiError({ statusCode: 404, message: 'Connection not found' });
  if (row.managedBy === 'env') {
    throw apiError({
      statusCode: 403,
      message: 'This connection is managed through environment variables and cannot be edited here.',
    });
  }

  const connection = await updateConnection(db, id, parsed.data);
  return { connection };
});
