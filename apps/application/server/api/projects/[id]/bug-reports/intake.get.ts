import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { getRequestAccess } from '../../../../utils/auth';
import { bugReportIntake } from '../../../../utils/integrations/bug-reports';
import { BUG_REPORT_LIMITS } from '#shared/handlers/bug-reports';
import { can } from '#shared/permissions';

defineRouteMeta({
  openAPI: {
    tags: ['Bug reports'],
    summary: 'What sending a bug report will do',
    description:
      'Asked by Piwi Picker before it shows the Send to Piwi preview: `{ tracker, projectKey, locale, canCreate, fileEvery, stepShots }`. `tracker` is `jira` when the project is bound to a tracker, else null; `canCreate` says whether the caller holds `issue:create` on the project (Contributor and above); `fileEvery` whether the project files an issue for every report, whoever sends it; `stepShots` how many step screenshots a send may carry, which tells the extension this instance takes them.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-permission': 'project:read',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);
  const db = await getDatabase();
  const canCreate = can(await getRequestAccess(event), 'issue:create', id);
  return { ...(await bugReportIntake(db, id, canCreate)), stepShots: BUG_REPORT_LIMITS.stepShots };
});
