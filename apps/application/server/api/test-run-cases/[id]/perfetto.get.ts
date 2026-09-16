import { collectExecutionPerfetto } from '#shared/handlers/perfetto';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';
import { sendPerfetto } from '../../../utils/perfetto-request';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Export one execution as a Perfetto trace',
    description:
      'Downloads a single execution in Trace Event Format: a slice for the execution with its hooks, fixtures and steps nested underneath, and an instant event at the moment it failed. Open the file at ui.perfetto.dev or in Chrome’s chrome://tracing. Attachments are referenced by URL, not embedded.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  const input = await collectExecutionPerfetto(db, id);
  if (!input) {
    throw apiError({ statusCode: 404, message: 'Test run case not found' });
  }

  return sendPerfetto(event, input, 'execution', `piwi-execution-${id}-perfetto.json`);
});
