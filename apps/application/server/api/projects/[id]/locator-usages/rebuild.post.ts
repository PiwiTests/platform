import { getDatabase } from '../../../../database';
import { backfillLocatorUsages } from '../../../../utils/locator-usages';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Rebuild a project’s locator index from stored runs',
    description:
      'Empties the project’s locator index, then reads one stored execution per test case, Playwright project and branch (the latest passed one, else the latest; up to 5000) and indexes the locator chains its steps used. Uses of executions no longer stored are dropped. New runs are indexed on ingest, and the server builds each project’s index from its history once at startup, so this is only needed to start over, for instance to split history indexed before branches were recorded.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);

  const db = await getDatabase();
  return backfillLocatorUsages(db, id, { reset: true });
});
