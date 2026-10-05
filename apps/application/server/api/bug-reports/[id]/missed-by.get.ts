import { requireResolvedProjectAccess, requireRouteId, resolveBugReportProjectId } from '../../../utils/project-access';
import { apiError } from '../../../utils/api-error';
import { resolveOwners } from '../../../utils/scm/ownership';
import { getBugReportMissedBy } from '#shared/handlers/bug-reports';

defineRouteMeta({
  openAPI: {
    tags: ['Bug reports'],
    summary: 'Why the suite missed a reported bug',
    description:
      'From the project’s locator index: the tests that visit the report’s page, those whose locators reach each element the reporter marked and what they assert, a one-line `summary`, and the `owner` of the spec file whose tests visit the page most (CODEOWNERS, or its `piwi:owner`).',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'project:read',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'bug report ID');
  const { db, projectId } = await requireResolvedProjectAccess(event, id, resolveBugReportProjectId, 'Bug report');
  const missed = await getBugReportMissedBy(db, id);
  if (!missed) throw apiError({ statusCode: 404, message: 'Bug report not found' });
  let owner: string | null = null;
  if (missed.mainFile) {
    const main = { filePath: missed.mainFile, owner: null as string | null };
    owner = (await resolveOwners(db, projectId, [main]).catch(() => new Map())).get(main)?.owner ?? null;
  }
  return { ...missed, owner };
});
