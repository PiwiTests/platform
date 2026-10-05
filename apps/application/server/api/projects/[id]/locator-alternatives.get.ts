import { getDatabase } from '../../../database';
import { getLocatorAlternatives } from '../../../utils/locator-alternatives';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'List the stored alternatives of a file’s locator call sites',
    description:
      'For each locator call site in one test or page-object file (`file`, a project-relative path or a path suffix), the ranked alternative locators the capture fixtures stored the last time it passed: `{ testCaseId, location, method, alternatives, lastSeenAt }`, newest capture first, at most 10 alternatives each. Editors offer them as the replacement for a brittle locator.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'file',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'Project-relative path, or a path suffix.',
      },
    ],
    'x-required-permission': 'project:read',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);
  const file = String(getQuery(event).file ?? '').trim();
  if (!file || file.length > 500)
    throw apiError({ statusCode: 400, message: 'file is required (at most 500 characters)' });
  return { items: await getLocatorAlternatives(await getDatabase(), id, file) };
});
