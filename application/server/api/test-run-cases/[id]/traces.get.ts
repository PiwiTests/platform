import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { testRunsCases, files } from '../../../database/schema';
import { eq, sql } from 'drizzle-orm';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Get trace files for a test run case',
    description: 'Returns a list of trace files associated with a specific test run case (one execution).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid test run case ID',
    });
  }

  const db = await getDatabase();

  const testRunsCaseResults = await db.select().from(testRunsCases).where(eq(testRunsCases.id, id));
  const testRunsCase = testRunsCaseResults[0];

  if (!testRunsCase) {
    throw createError({
      statusCode: 404,
      message: 'Test run case not found',
    });
  }

  const traceRows = await db
    .select()
    .from(files)
    .where(sql`${files.testRunsCaseId} = ${id} AND ${files.type} = 'trace'`);

  return traceRows.map((t) => ({
    id: t.id,
    filePath: t.path,
    createdAt: t.createdAt,
  }));
});
