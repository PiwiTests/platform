import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { listTags } from '~~/shared/handlers/tags';
import { Role } from '../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Tags'],
    summary: 'List all tags',
    description: 'Returns a list of all tags ordered alphabetically.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  return listTags(await getDatabase());
});
