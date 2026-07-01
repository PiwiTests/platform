import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { testCases, testRunsCases, testRuns } from '../../../database/schema';
import { eq, and, desc } from 'drizzle-orm';
import { Role } from '#shared/types';
import { classifyFlakyRootCause, type FlakyRootCause } from '../../../utils/flaky-classify';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Classify flaky test root cause',
    description:
      'Analyzes a flaky test case and classifies its root cause as timing, network, assertion, environment, or other',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { testCaseId: { type: 'integer' } },
            required: ['testCaseId'],
          },
        },
      },
    },
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, projectId, REQUIRED_ROLES);

  const body = await readBody<{ testCaseId: number }>(event);
  if (!body?.testCaseId) throw createError({ statusCode: 400, message: 'testCaseId is required' });

  const db = await getDatabase();

  // Verify the test case belongs to this project
  const tcRows: any[] = await db
    .select({ id: testCases.id })
    .from(testCases)
    .where(and(eq(testCases.id, body.testCaseId), eq(testCases.projectId, projectId)));
  if (tcRows.length === 0) throw createError({ statusCode: 404, message: 'Test case not found' });

  // Fetch recent failure data for this test case
  const recentFailures: any[] = await db
    .select({
      id: testRunsCases.id,
      status: testRunsCases.status,
      error: testRunsCases.error,
      duration: testRunsCases.duration,
      steps: testRunsCases.steps,
      browser: testRunsCases.browser,
      testRunId: testRunsCases.testRunId,
    })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
    .where(and(eq(testRunsCases.testCaseId, body.testCaseId), eq(testRuns.status, 'failed')))
    .orderBy(desc(testRunsCases.createdAt))
    .limit(50);

  if (recentFailures.length === 0) {
    return { testCaseId: body.testCaseId, rootCause: 'other' as FlakyRootCause };
  }

  const errorMessages: string[] = [];
  const stepErrors: string[] = [];
  const stepNames: string[] = [];
  let networkErrorCount = 0;
  let status5xxCount = 0;
  const browserDistribution: Record<string, number> = {};

  for (const row of recentFailures) {
    if (row.error) errorMessages.push(row.error);
    const steps = row.steps as Array<{ title: string; category: string; duration: number }> | null;
    if (steps) {
      for (const s of steps) {
        stepNames.push(s.title);
        if (s.title.toLowerCase().includes('error') || s.title.toLowerCase().includes('fail')) {
          stepErrors.push(s.title);
        }
      }
    }
    const b = row.browser as Record<string, unknown> | null;
    const browserKey = (b?.projectName as string) ?? (b?.browserName as string) ?? '';
    if (browserKey) {
      browserDistribution[browserKey] = (browserDistribution[browserKey] ?? 0) + 1;
    }
  }

  const rootCause = classifyFlakyRootCause({
    errorMessages,
    stepErrors,
    stepNames,
    networkErrorCount,
    status5xxCount,
    browserDistribution,
  });

  // Persist the classification
  await db
    .update(testCases)
    .set({ flakyRootCause: rootCause, updatedAt: new Date() })
    .where(eq(testCases.id, body.testCaseId));

  return { testCaseId: body.testCaseId, rootCause };
});
