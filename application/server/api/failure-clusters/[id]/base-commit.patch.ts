import { getDatabase } from '../../../database';
import { failureClusters } from '../../../database/schema';
import { eq } from 'drizzle-orm';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Update manual base commit for a cluster',
    description: 'Persists a manual baseline commit SHA for a failure cluster used in AI diagnosis context.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' });

  const body = await readBody(event);
  const commit = typeof body?.commit === 'string' ? body.commit.trim() : null;

  const db = await getDatabase();

  const [cluster] = await db.select({ id: failureClusters.id }).from(failureClusters).where(eq(failureClusters.id, id));
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  await db
    .update(failureClusters)
    .set({ manualBaseCommit: commit || null, updatedAt: new Date() })
    .where(eq(failureClusters.id, id));

  return { success: true, manualBaseCommit: commit || null };
});
