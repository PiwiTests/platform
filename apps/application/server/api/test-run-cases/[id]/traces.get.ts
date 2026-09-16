import { testRunsCases } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { getTestRunCaseTraces } from '#shared/handlers/test-cases';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Get trace files for a test run case',
    description: 'Returns a list of trace files associated with a specific test run case (one execution).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  const [exists] = await db.select({ id: testRunsCases.id }).from(testRunsCases).where(eq(testRunsCases.id, id));
  if (!exists) {
    throw apiError({ statusCode: 404, message: 'Test run case not found' });
  }
  return { items: await getTestRunCaseTraces(db, id) };
});
