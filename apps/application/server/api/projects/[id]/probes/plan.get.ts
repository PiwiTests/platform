import { Role } from '#shared/types';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { buildProbePlanForProject, DEFAULT_PROBE_BUDGET } from '#shared/handlers/probes';

defineRouteMeta({
  openAPI: {
    tags: ['Scenario gaps'],
    summary: 'The probe plan for the next probe run',
    description:
      'Returns the (test, route, fault) pairs a `piwi probe` run should apply tonight, chosen by exposure with never-probed pairs first, one fault per test, capped at the budget (default 50). Requires a reporter API key.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'budget', in: 'query', required: false, schema: { type: 'integer' } },
    ],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId, [Role.ADMINISTRATOR, Role.REPORTER]);

  const rawBudget = getQuery(event).budget;
  const budget = rawBudget != null && Number.isFinite(Number(rawBudget)) ? Number(rawBudget) : DEFAULT_PROBE_BUDGET;

  const db = await getDatabase();
  // The level-two server items drop out when the project declined `server-probes`
  // or has no backend for it to be applicable; the client plan is unaffected.
  return buildProbePlanForProject(db, projectId, { budget });
});
