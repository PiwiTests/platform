import { getDatabase } from '../../../database';
import { integrationConnections } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { readProjectIntegration, writeProjectIntegration } from '../../../utils/integrations/binding';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Save the project tracker binding',
    description:
      'Replace the project-integration binding with a normalized settings object. A null connection clears the binding. Requires administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);
  const db = await getDatabase();

  const body = (await readBody(event)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    throw apiError({ statusCode: 400, message: 'Invalid request body' });
  }

  // A bound connection must exist — an unknown id would leave a dangling FK.
  if (typeof body.connectionId === 'number' && body.connectionId > 0) {
    const [conn] = await db
      .select({ id: integrationConnections.id })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, body.connectionId));
    if (!conn) throw apiError({ statusCode: 400, message: 'Connection not found' });
  }

  await writeProjectIntegration(db, id, body);
  return await readProjectIntegration(db, id);
});
