import { Role } from '#shared/types';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { recordProbeResults, type ProbeResultInput } from '#shared/handlers/probes';

defineRouteMeta({
  openAPI: {
    tags: ['Scenario gaps'],
    summary: 'Record the outcomes of a probe run',
    description:
      'Writes the probe ledger and a `checks` edge per (test, route) pair from a `piwi probe` run: whether the test noticed the injected fault. Requires a reporter API key.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId, [Role.ADMINISTRATOR, Role.REPORTER]);

  const body = await readBody<{ runId?: number | null; results?: ProbeResultInput[] }>(event);
  const results = Array.isArray(body?.results) ? body.results : [];
  const runId = typeof body?.runId === 'number' ? body.runId : null;

  const clean = results.filter(
    (r): r is ProbeResultInput =>
      !!r && typeof r.testCaseId === 'number' && typeof r.routeKey === 'string' && typeof r.fault === 'string',
  );

  const db = await getDatabase();
  const { recorded } = await recordProbeResults(db, projectId, runId, clean);
  return { success: true, recorded };
});
