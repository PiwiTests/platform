import { getDatabase } from '../../../database';
import { requireProjectAccess } from '../../../utils/project-access';
import { Role } from '../../../../shared/types';
import { approveMergeSuggestion, getSuggestionProjectId } from '~~/shared/handlers/cluster-merge-suggestions';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Approve a cluster merge suggestion',
    description: 'Merges the two suggested clusters (lower id survives) and consumes the suggestion. Requires reporter or administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid suggestion ID' });

  const db = await getDatabase();
  const projectId = await getSuggestionProjectId(db, id);
  if (!projectId) throw createError({ statusCode: 404, message: 'Suggestion not found' });

  await requireProjectAccess(event, projectId, REQUIRED_ROLES);

  const result = await approveMergeSuggestion(db, id);
  if (!result) throw createError({ statusCode: 409, message: 'Suggestion is not pending' });
  return { success: true, ...result };
});
