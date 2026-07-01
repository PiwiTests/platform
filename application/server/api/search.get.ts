import { requireAuth } from '../utils/auth';
import { getProjectScope } from '../utils/project-access';
import { getDatabase } from '../database';
import { searchProjectsTestRunsCases } from '#shared/handlers/search';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Search'],
    summary: 'Search across projects, test runs, and test cases',
    description:
      'Full-text search across project names/labels, run labels/IDs, and test case titles. Returns up to 5 results per category.',
    parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const { q } = getQuery(event);
  if (!q || typeof q !== 'string' || q.trim().length < 2) {
    return { projects: [], runs: [], cases: [] };
  }
  const db = await getDatabase();
  const scope = await getProjectScope(db, user as any);
  return searchProjectsTestRunsCases(db, q.trim(), scope);
});
