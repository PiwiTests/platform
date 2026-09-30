import { requireAuth } from '../utils/auth';
import { getProjectScope } from '../utils/project-access';
import { getDatabase } from '../database';
import { searchProjectsTestRunsCases } from '#shared/handlers/search';

defineRouteMeta({
  openAPI: {
    tags: ['Search'],
    summary: 'Search across projects, test runs, and test cases',
    description:
      'Case-insensitive search across project names/labels, run labels/IDs, and test case titles, within the projects the caller can open. Returns up to 5 results per category.',
    parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
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
