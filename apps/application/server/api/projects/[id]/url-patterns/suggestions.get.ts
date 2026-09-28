import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { suggestUrlPatterns } from '#shared/handlers/url-patterns';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Suggest URL patterns for a project',
    description:
      'One `https://host/**` pattern per origin the project’s suite visited, most visited first: the Playwright `baseURL` of recent runs and the project’s route origins (`base-url`), the page nodes of the Test Map (`test-map`), and the absolute pages its locators ran on (`locator-pages`). Origins an existing pattern covers are left out.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);
  return { items: await suggestUrlPatterns(await getDatabase(), id) };
});
