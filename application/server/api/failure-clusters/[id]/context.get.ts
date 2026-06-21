import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { failureClusters } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { buildDiagnosisContext } from '../../../utils/ai-context';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Get AI diagnosis context preview',
    description:
      'Returns a preview of the full AI context that would be sent for diagnosis. Supports ?format=json for a structured response with per-section breakdown, token estimate, and coverage metadata.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['json'] } },
    ],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' });

  const db = await getDatabase();
  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, id));
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  const query = getQuery(event);
  const baseCommit = query.baseCommit as string | undefined;
  const selectedCommitShasRaw = query.selectedCommitShas;
  const selectedCommitShas = Array.isArray(selectedCommitShasRaw)
    ? selectedCommitShasRaw.map(String)
    : selectedCommitShasRaw
      ? [String(selectedCommitShasRaw)]
      : undefined;
  const format = query.format as string | undefined;

  const ctx = await buildDiagnosisContext(db, {
    kind: 'cluster',
    clusterId: id,
    baseCommit,
    selectedCommitShas,
  });

  if (format === 'json') {
    return {
      scope: ctx.scope,
      text: ctx.text,
      sections: ctx.sections,
      coverage: ctx.coverage,
      scmChanges: ctx.scmChanges,
      tokenEstimate: ctx.tokenEstimate,
      cluster: ctx.cluster,
    };
  }

  return { context: ctx.text, coverage: ctx.coverage, scmChanges: ctx.scmChanges };
});
