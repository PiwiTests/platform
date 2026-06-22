import { requireAuth } from '../utils/auth';
import { getProjectScope } from '../utils/project-access';
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
  const user = await requireAuth(event);
  const db = await getDatabase();
  const scope = await getProjectScope(db, user as any);
  const result = await listProjects(db, scope);
  return result.map((p: any) => {
    const { scmToken: _scm, ...rest } = p;
    return rest;
  });
});
