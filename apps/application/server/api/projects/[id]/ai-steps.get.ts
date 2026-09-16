import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { optionalIntQuery } from '../../../utils/query-params';
import { getDatabase } from '../../../database';
import { getProjectAiStepCoverage } from '#shared/handlers/projects';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'AI-step coverage overview',
    description:
      'Aggregates AI-step liveness over the last N days: for each committed AI-step artifact (page.piwiLocator / page.piwiRun) that was replayed, how many distinct tests exercise it, how often, and when it was last seen.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'days', in: 'query', schema: { type: 'integer', default: 30 } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');

  await requireProjectAccess(event, projectId);

  const days = optionalIntQuery(event, 'days', { default: 30, min: 1, max: 90 });

  const db = await getDatabase();

  try {
    return await getProjectAiStepCoverage(db, projectId, days);
  } catch (err) {
    if (err instanceof Error && err.message === 'Project not found') {
      throw apiError({ statusCode: 404, message: 'Project not found' });
    }
    throw err;
  }
});
