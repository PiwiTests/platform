import { getDatabase } from '../../../database';
import { failureClusters, failureDiagnoses } from '../../../database/schema';
import { eq } from 'drizzle-orm';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Get stored diagnosis for a cluster',
    description: 'Returns the stored AI diagnosis result and manual base commit for a failure cluster.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' });

  const db = await getDatabase();

  const [cluster] = await db
    .select({ id: failureClusters.id, manualBaseCommit: failureClusters.manualBaseCommit })
    .from(failureClusters)
    .where(eq(failureClusters.id, id));
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  const [diag] = await db.select().from(failureDiagnoses).where(eq(failureDiagnoses.clusterId, id));
  return {
    diagnosis: diag ?? null,
    manualBaseCommit: cluster.manualBaseCommit ?? null,
  };
});
