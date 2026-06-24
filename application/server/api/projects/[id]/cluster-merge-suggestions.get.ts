import { requireProjectAccess } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { listMergeSuggestions } from '~~/shared/handlers/cluster-merge-suggestions';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'List cluster merge suggestions for a project',
    description:
      'Returns pending (or filtered) merge suggestions surfaced by the embedding reconciler / LLM adjudicator, each joined with both clusters’ summaries.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const projectId = parseInt(getRouterParam(event, 'id') || '0');
  if (!projectId) throw createError({ statusCode: 400, message: 'Invalid project ID' });

  const status = (getQuery(event).status as string | undefined) || 'pending';
  await requireProjectAccess(event, projectId);

  const db = await getDatabase();
  return listMergeSuggestions(db, projectId, status);
});
