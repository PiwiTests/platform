import { and, desc, eq } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { apiError } from '../../utils/api-error';
import { requireAuth } from '../../utils/auth';
import { requireProjectAccess } from '../../utils/project-access';
import { integrationActions } from '../../database/schema';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'List integration actions',
    description:
      'The outbox activity — what Piwi wrote to the tracker, with the provider error on failures. Filter by `projectId` (any member of that project) or by `connectionId` (administrators, across projects, for the Settings → Integrations activity list).',
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const query = getQuery(event);
  const connectionId = Number(query.connectionId ?? 0);
  const projectId = Number(query.projectId ?? 0);
  const status = typeof query.status === 'string' ? query.status : null;

  let scopeWhere;
  if (Number.isInteger(connectionId) && connectionId > 0) {
    // The connection-scoped activity list spans projects, so it is admin-only.
    await requireAuth(event, [Role.ADMINISTRATOR]);
    scopeWhere = eq(integrationActions.connectionId, connectionId);
  } else if (Number.isInteger(projectId) && projectId > 0) {
    await requireProjectAccess(event, projectId);
    scopeWhere = eq(integrationActions.projectId, projectId);
  } else {
    throw apiError({ statusCode: 400, message: 'projectId or connectionId is required' });
  }

  const db = await getDatabase();
  const where = status ? and(scopeWhere, eq(integrationActions.status, status)) : scopeWhere;

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
