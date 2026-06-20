import { requireAuth } from '../utils/auth';
import { getDatabase } from '../database';
import { listProjects } from '~~/shared/handlers/projects';
import { Role } from '../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'List all projects with stats',
    description: 'Returns all projects with their latest run, total runs count, total test cases, and tags',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();
  const result = await listProjects(db);
  return result.map((p: any) => {
    const { scmToken: _scm, ...rest } = p;
    return rest;
  });
});
