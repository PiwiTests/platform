import { getDatabase } from '../../../database';
import { queryFlag } from '../../../utils/query-params';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { listQuarantine, RELEASE_AFTER_CONSECUTIVE_PASSES } from '#shared/handlers/quarantine';
import { proposeQuarantineCandidates } from '../../../utils/quarantine-candidates';

defineRouteMeta({
  openAPI: {
    tags: ['Test Cases'],
    summary: 'Quarantined tests, their exit progress, and candidates',
    description:
      'A quarantined test still runs and still reports — it is excluded from the CI gate’s verdict and nothing else. That is what makes the exit ramp work: `consecutivePasses` counts passing runs since quarantine, and `releaseProposed` turns true once a test has earned its way out. `debt` aggregates the cost of the list so it cannot quietly grow forever. `candidates` proposes tests worth quarantining, ranked by the CI time their flakiness wastes. Set `?candidates=false` to skip that computation.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'candidates',
        in: 'query',
        required: false,
        schema: { type: 'boolean', default: true },
        description: 'Include quarantine proposals derived from flaky analysis',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);

  const db = await getDatabase();
  const { entries, debt } = await listQuarantine(db, projectId);

  const wantCandidates = queryFlag(event, 'candidates', { default: true });
  const candidates = wantCandidates
    ? await proposeQuarantineCandidates(db, projectId, new Set(entries.map((e) => e.testCaseId)))
    : [];

  return { entries, debt, candidates, releaseAfterConsecutivePasses: RELEASE_AFTER_CONSECUTIVE_PASSES };
});
