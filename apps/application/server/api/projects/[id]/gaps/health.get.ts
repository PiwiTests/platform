import { getDatabase } from '../../../../database';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getMapHealth } from '#shared/handlers/map-health';

defineRouteMeta({
  openAPI: {
    tags: ['Scenario gaps'],
    summary: 'How complete the Test Map is, per input',
    description:
      'One row per optional input of the Test Map, on the default branch: `{ id, have, of, wakes, ranks? }`. `inventory` counts the reached pages holding a page inventory, `locator-pages` the tests whose locator calls name their page, `handlers` the observed routes with a handler, `probes` the reached routes a probe checked, each `of` its denominator; `declared` (declared routes and pages), `changes` (commits whose changed files a run recorded) and `catalog` (catalog methods and helpers) are counts with `of: null`. `wakes` lists the detectors that read the input, and `ranks` marks an input that also ranks gaps.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'project:read',
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);
  const db = await getDatabase();
  return { items: await getMapHealth(db, projectId) };
});
