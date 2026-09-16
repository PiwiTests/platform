import { collectRunPerfetto } from '#shared/handlers/perfetto';
import { requireResolvedProjectAccess, requireRouteId, resolveRunProjectId } from '../../../utils/project-access';
import { sendPerfetto } from '../../../utils/perfetto-request';

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Export a run as a Perfetto trace',
    description:
      'Downloads the whole run in Trace Event Format: one process per shard, one thread per worker, and a slice for every execution with its hooks, fixtures and steps nested underneath. Open the file at ui.perfetto.dev or in Chrome’s chrome://tracing. Attachments are referenced by URL, not embedded.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveRunProjectId, 'Test run');

  const input = await collectRunPerfetto(db, id);
  if (!input) {
    throw apiError({ statusCode: 404, message: 'Test run not found' });
  }

  return sendPerfetto(event, input, 'run', `piwi-run-${id}-perfetto.json`);
});
