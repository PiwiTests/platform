import { eq, desc } from 'drizzle-orm';
import { getDatabase } from '../../../database';
import { testRuns } from '../../../database/schema';
import { Role } from '#shared/types';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Get latest run info for a project',
    description: 'Returns the id and status of the most recent test run for the project',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, id);

  const db = await getDatabase();
  const result = await db
    .select({ id: testRuns.id, status: testRuns.status })
    .from(testRuns)
    .where(eq(testRuns.projectId, id))
    .orderBy(desc(testRuns.id))
    .limit(1);

  return result[0] ?? null;
});
