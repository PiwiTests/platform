import { requireAuth } from '../../utils/auth';
import { getProjectScope } from '../../utils/project-access';
import { getDatabase } from '../../database';
import { listAcceptedUnwritten } from '#shared/handlers/scenario-gaps';

defineRouteMeta({
  openAPI: {
    tags: ['Scenario gaps'],
    summary: 'Accepted-but-unwritten scenario gaps across projects',
    description:
      'Gaps accepted more than a week ago whose node still has no trusted edge — the draft was never turned into a test. Drives the Home "gaps" inbox queue.',
    parameters: [],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const scope = await getProjectScope(db, user as any);
  const projectIds = scope === 'all' ? 'all' : [...scope];
  return { items: await listAcceptedUnwritten(db, projectIds) };
});
