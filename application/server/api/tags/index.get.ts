import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { tags } from '../../database/schema';
import { asc } from 'drizzle-orm';
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
  const db = await getDatabase();
  const allTags = await db.select().from(tags).orderBy(asc(tags.text));
  return { tags: allTags };
});
