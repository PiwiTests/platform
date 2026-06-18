import { getDatabase } from '../../../database';
import { failureClusters, testRunsCases } from '../../../database/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { Role } from '../../../../shared/types';
import { requireAuth } from '../../../utils/auth';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Extract test cases from failure cluster',
    description:
      'Unlinks selected test cases from a failure cluster by setting their failureClusterId to NULL. Optionally updates the triage note.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' });

  const db = await getDatabase();

  const [cluster] = await db.select({ id: failureClusters.id }).from(failureClusters).where(eq(failureClusters.id, id));
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  const body = await readBody(event);
  const testCaseIds: number[] | undefined = body?.testCaseIds;
  if (!testCaseIds || !Array.isArray(testCaseIds) || testCaseIds.length === 0) {
    throw createError({ statusCode: 400, message: 'testCaseIds must be a non-empty array' });
  }

  const triageNote: string | undefined = body?.triageNote;

  // Unlink selected test cases from this cluster
  await db
    .update(testRunsCases)
    .set({ failureClusterId: null })
    .where(and(eq(testRunsCases.failureClusterId, id), inArray(testRunsCases.testCaseId, testCaseIds)));

  // Recalculate remaining occurrences
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(testRunsCases)
    .where(eq(testRunsCases.failureClusterId, id));

  const remainingOccurrences = Number(countRow?.count ?? 0);

  // Update cluster
  const updateFields: Record<string, unknown> = {
    occurrences: remainingOccurrences,
    updatedAt: new Date(),
  };
  if (triageNote !== undefined) {
    updateFields.triageNote = triageNote;
  }
  await db.update(failureClusters).set(updateFields).where(eq(failureClusters.id, id));

  return {
    success: true,
    extractedCount: testCaseIds.length,
    remainingOccurrences,
  };
});
