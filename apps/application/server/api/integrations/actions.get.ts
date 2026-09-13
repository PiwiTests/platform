import { and, desc, eq } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { apiError } from '../../utils/api-error';
import { requireProjectAccess } from '../../utils/project-access';
import { integrationActions } from '../../database/schema';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'List integration actions',
    description:
      'The outbox activity for a project — what Piwi wrote to the tracker, with the provider error on failures.',
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const query = getQuery(event);
  const projectId = Number(query.projectId ?? 0);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw apiError({ statusCode: 400, message: 'projectId is required' });
  }
  await requireProjectAccess(event, projectId);

  const db = await getDatabase();
  const status = typeof query.status === 'string' ? query.status : null;
  const where = status
    ? and(eq(integrationActions.projectId, projectId), eq(integrationActions.status, status))
    : eq(integrationActions.projectId, projectId);

  const rows = await db
    .select({
      id: integrationActions.id,
      connectionId: integrationActions.connectionId,
      kind: integrationActions.kind,
      entityType: integrationActions.entityType,
      entityId: integrationActions.entityId,
      status: integrationActions.status,
      attempts: integrationActions.attempts,
      error: integrationActions.error,
      result: integrationActions.result,
      createdAt: integrationActions.createdAt,
      finishedAt: integrationActions.finishedAt,
    })
    .from(integrationActions)
    .where(where)
    .orderBy(desc(integrationActions.id))
    .limit(50);

  return { actions: rows };
});
