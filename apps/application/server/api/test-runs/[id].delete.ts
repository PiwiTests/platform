import { isRunKept, keptRunDeleteMessage } from '#shared/handlers/run-keep';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../utils/project-access';
import { deleteRunsByIds } from '../../utils/retention';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Delete a test run',
    description:
      'Permanently delete a test run and all associated data including reports, traces, files, and failure clusters. A kept run is refused with 409 until it is released. Administrator access required.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run ID');
  // Resolves the run's project (404 if the run is gone) and authorizes the caller.
  const { db } = await requireResolvedProjectAccess(event, id, resolveRunProjectId, 'Test run');

  if (await isRunKept(db, id)) {
    throw apiError({ statusCode: 409, message: keptRunDeleteMessage(id) });
  }

  // One deletion path for the endpoint and the nightly sweep: removes the run's
  // files, frees any trace blob it was the last to reference, clears every
  // dependent row and recomputes affected cluster counters.
  const { deletedRuns } = await deleteRunsByIds(db, [id]);
  if (deletedRuns === 0) {
    throw apiError({ statusCode: 404, message: 'Test run not found' });
  }

  return { success: true };
});
