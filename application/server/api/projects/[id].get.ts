import { getDatabase } from '../../database';
import { getProject } from '~~/shared/handlers/projects';
import { Role } from '../../../shared/types';
import { requireProjectAccess } from '../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Get project details',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid project ID',
    });
  }

  await requireProjectAccess(event, id);

  const db = await getDatabase();
  try {
    const result = await getProject(db, id);
    const { scmToken: _scm, ...rest } = result;
    return rest;
  } catch (e: any) {
    if (e?.message === 'Project not found') {
      throw createError({ statusCode: 404, message: 'Project not found' });
    }
    throw e;
  }
});
