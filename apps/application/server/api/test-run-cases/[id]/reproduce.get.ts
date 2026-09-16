import { buildExecutionReproduce } from '#shared/handlers/reproduce';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'A local reproduction recipe and a generated git bisect for an execution',
    description:
      "Turns this failure into a copy-paste way to reproduce it locally — check out the failing commit, install the run's Playwright version and browser, and run exactly this test — and, when the regression window is known, a generated `git bisect` between the last green commit and the failing one. Every command comes in a Linux/macOS and a Windows (PowerShell) form. The bisect degrades to `available: false` with a reason when there is no last-green commit or SCM metadata.",
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');

  // Authorize by the execution's own project — the id may be opened from a
  // cluster page whose run belongs to another project.
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  const result = await buildExecutionReproduce(db, id);
  if (!result) throw apiError({ statusCode: 404, message: 'Test run case not found' });
  return result;
});
