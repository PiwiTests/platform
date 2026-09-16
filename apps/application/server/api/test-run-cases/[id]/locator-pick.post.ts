import { saveLocatorPick, type LocatorPickInput } from '../../../utils/locator-healing';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Save a user-picked locator for a failing test case',
    description:
      'Saves a locator picked by a user from the interactive DOM snapshot picker. The pick is keyed to the failing locator call site (location and signature re-derived server-side from the stored error) and appears first in subsequent locator-healing responses. Any authenticated project member may save a pick.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Test run case id' },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['pickedLocator'],
            properties: {
              failingLocator: {
                type: 'object',
                description:
                  'The failing locator as displayed in the panel — identity fallback when the stored error cannot be re-parsed.',
                properties: {
                  method: { type: 'string' },
                  args: { type: 'object' },
                },
              },
              pickedLocator: {
                type: 'object',
                properties: {
                  locator: { type: 'string' },
                  method: { type: 'string' },
                  args: { type: 'object' },
                  score: { type: 'number' },
                },
              },
              element: {
                type: 'object',
                description:
                  'The picked element as probed in the DOM snapshot: tagName, attributes, textContent, accessibleName, center.',
              },
            },
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');

  // Authorize by the execution's own project: this id may be opened from the
  // cluster page, where it can belong to a run in another project.
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  const body = await readBody<LocatorPickInput>(event);
  if (!body?.pickedLocator?.locator) {
    throw apiError({ statusCode: 400, message: 'Missing pickedLocator' });
  }

  const result = await saveLocatorPick(db, id, body);
  if (result.status === 'not-found') {
    throw apiError({ statusCode: 404, message: 'Test run case not found' });
  }
  return result;
});
