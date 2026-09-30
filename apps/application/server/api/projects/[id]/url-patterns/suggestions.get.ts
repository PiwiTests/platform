import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { suggestUrlPatterns } from '#shared/handlers/url-patterns';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Suggest URL patterns for a project',
    description:
      'One `https://host/**` pattern per origin the project’s suite visited, most visited first: the Playwright `baseURL` of recent runs, including the newest few of each environment, and the project’s route origins (`base-url`), the full addresses its tests opened with `page.goto` in runs that recorded no `baseURL` (`navigation`), the page nodes of the Test Map (`test-map`), and the absolute pages its locators ran on (`locator-pages`). An origin a run visited carries the `environment` most of those runs were reported with. Origins an existing pattern covers are left out and counted in `covered`.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);
  return suggestUrlPatterns(await getDatabase(), id);
});
