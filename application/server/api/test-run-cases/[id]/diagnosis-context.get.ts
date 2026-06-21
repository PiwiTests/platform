import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { testRunsCases, failureClusters } from '../../../database/schema';
import { eq, and } from 'drizzle-orm';
import { buildDiagnosisContext } from '../../../utils/ai-context';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Get execution-scoped diagnosis context preview',
    description:
      'Returns a preview of the full AI context that would be sent for diagnosing a specific test-run-case, including optional base commit and selected commit SHAs.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid test run case ID' });

  const db = await getDatabase();

  const [trc] = await db
    .select({ id: testRunsCases.id, failureClusterId: testRunsCases.failureClusterId })
    .from(testRunsCases)
    .where(eq(testRunsCases.id, id))
    .limit(1);
  if (!trc) throw createError({ statusCode: 404, message: 'Test run case not found' });

  const query = getQuery(event);
  const baseCommit = query.baseCommit as string | undefined;
  const selectedCommitShasRaw = query.selectedCommitShas;
  const selectedCommitShas = Array.isArray(selectedCommitShasRaw)
    ? selectedCommitShasRaw.map(String)
    : selectedCommitShasRaw
      ? [String(selectedCommitShasRaw)]
      : undefined;

  const ctx = await buildDiagnosisContext(db, {
    kind: 'execution',
    testRunsCaseId: id,
    clusterId: trc.failureClusterId ?? undefined,
    baseCommit,
    selectedCommitShas,
  });

  return {
    context: ctx.text,
    sections: ctx.sections,
    coverage: ctx.coverage,
    scmChanges: ctx.scmChanges,
    tokenEstimate: ctx.tokenEstimate,
    cluster: ctx.cluster,
  };
});
