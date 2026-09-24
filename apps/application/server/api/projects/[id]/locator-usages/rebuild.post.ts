import { getDatabase } from '../../../../database';
import { backfillLocatorUsages } from '../../../../utils/locator-usages';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Rebuild a project’s locator index from stored runs',
    description:
      'Reads one stored execution per test case and Playwright project (the latest passed one, else the latest; up to 5000) and indexes the locator chains its steps used. Idempotent. New runs are indexed on ingest, and the server builds each project’s index from its history once at startup, so this is only needed to refresh it.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);

  const db = await getDatabase();
  return backfillLocatorUsages(db, id);
});
