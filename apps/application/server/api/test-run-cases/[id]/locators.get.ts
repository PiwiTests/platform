import { getExecutionLocators } from '../../../utils/locator-usages';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'List the locators an execution used',
    description:
      'Returns every locator chain the execution used, in step order, read from its stored steps: the action, the call site, the containers the chain searches inside, and how many tests in the project use the same chain or the same target. Builds the project’s locator index from stored runs on first use.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');
  const result = await getExecutionLocators(db, id);
  if (!result) throw apiError({ statusCode: 404, message: 'Test run case not found' });
  return result;
});
