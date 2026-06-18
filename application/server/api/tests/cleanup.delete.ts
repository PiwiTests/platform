import { getDatabase } from '../../database';
import { projects, tags, projectTags } from '../../database/schema';
import { eq, inArray, like } from 'drizzle-orm';
import { requireAuth } from '../../utils/auth';
import { Role } from '../../../shared/types';
import { deleteProject } from '../../utils/delete-project';
import { TEST_PROJECT_NAMES } from '../../../shared/test-project-names';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Clean up test data',
    description:
      'Deletes all test projects and test tags by known names. Only available in non-production environments with administrator role.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  // This endpoint is only intended for test suites — guard against accidental
  // use in production by requiring administrator role AND a non-production env
  await requireAuth(event, REQUIRED_ROLES);

  if (process.env.NODE_ENV === 'production') {
    throw createError({
      statusCode: 403,
      message: 'Cleanup endpoint is disabled in production',
    });
  }

  const db = await getDatabase();

  // Delete test projects by name
  const projectRows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(inArray(projects.name, TEST_PROJECT_NAMES));

  for (const project of projectRows) {
    await deleteProject(project.id);
  }

  // Delete test tags with known prefixes
  const testTagPatterns = ['ui-test-tag%', 'delete-me-tag%'];
  for (const pattern of testTagPatterns) {
    const tagRows = await db.select().from(tags).where(like(tags.text, pattern));
    for (const tag of tagRows) {
      await db.delete(projectTags).where(eq(projectTags.tagId, tag.id));
      await db.delete(tags).where(eq(tags.id, tag.id));
    }
  }

  return {
    success: true,
    projectsDeleted: projectRows.length,
  };
});
