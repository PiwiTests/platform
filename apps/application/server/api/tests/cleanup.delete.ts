import { getDatabase } from '../../database';
import { projects, tags, projectTags } from '../../database/schema';
import { eq, inArray, like } from 'drizzle-orm';
import { requireAuth } from '../../utils/auth';
import { TEST_PROJECT_NAMES } from '#shared/test-project-names';
import { deleteProject } from '../../utils/delete-project';

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Clean up test data',
    description:
      'Deletes all test projects and test tags by known names. Requires the administrator role, and a non-production environment unless PIWI_TEST_CLEANUP_ENABLED is set.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  // This endpoint is only intended for test suites — guard against accidental
  // use in production by requiring administrator role AND a non-production env
  await requireAuth(event);

  // CI drives the E2E suite against a production build, so the environment
  // check alone would refuse the global setup/teardown cleanup and leave the
  // known test projects behind. An explicit opt-in re-enables it there; real
  // deployments never set it and keep the guard.
  const cleanupOptIn = process.env.PIWI_TEST_CLEANUP_ENABLED === 'true';

  if (process.env.NODE_ENV === 'production' && !cleanupOptIn) {
    throw apiError({
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
