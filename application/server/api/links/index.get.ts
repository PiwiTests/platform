import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { entityLinks } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Links'],
    summary: 'List entity links',
    description: 'Returns all entity links attached to a run, test-case run, or test case.',
    parameters: [
      {
        name: 'entityType',
        in: 'query',
        required: true,
        schema: { type: 'string', enum: ['test_run', 'test_runs_case', 'test_case'] },
      },
      { name: 'entityId', in: 'query', required: true, schema: { type: 'integer' } },
    ],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event, REQUIRED_ROLES);

  const query = getQuery(event);
  const entityType = query.entityType as string;
  const entityId = parseInt(query.entityId as string, 10);

  if (!['test_run', 'test_runs_case', 'test_case'].includes(entityType) || !entityId) {
    throw createError({ statusCode: 400, message: 'Invalid entityType or entityId' });
  }

  const fkColumn =
    entityType === 'test_run'
      ? entityLinks.testRunId
      : entityType === 'test_runs_case'
        ? entityLinks.testRunsCaseId
        : entityLinks.testCaseId;

  const db = await getDatabase();
  const links = await db.select().from(entityLinks).where(eq(fkColumn, entityId));

  return { links };
});
