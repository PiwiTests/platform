import { getExecutionSteps } from '#shared/handlers/test-cases';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Flattened steps for a test case execution',
    description:
      "Returns this execution's flattened step list (the `steps` column) with each step's category, target, params, duration and absolute start time, plus the execution's own start time and duration. Powers the workers timeline's per-test step waterfall, loaded on demand when a row is expanded. Omitted from the run detail payload to keep it light.",
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');

  // Authorize by the execution's own project: this id may be opened from the
  // cluster page, where it can belong to a run in another project.
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  return getExecutionSteps(db, id);
});
