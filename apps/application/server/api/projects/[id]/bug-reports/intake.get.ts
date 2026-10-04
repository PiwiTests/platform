import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { bugReportIntake } from '../../../../utils/integrations/bug-reports';
import { BUG_REPORT_LIMITS } from '#shared/handlers/bug-reports';

defineRouteMeta({
  openAPI: {
    tags: ['Bug reports'],
    summary: 'What sending a bug report will do',
    description:
      'Asked by Piwi Picker before it shows the Send to Piwi preview: `{ tracker, projectKey, locale, canCreate, fileEvery, stepShots }`. `tracker` is `jira` when the project is bound to a tracker, else null; `canCreate` says whether the caller’s role may create issues (administrator or reporter); `fileEvery` whether the project files an issue for every report, whoever sends it; `stepShots` how many step screenshots a send may carry, which tells the extension this instance takes them.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  const user = await requireProjectAccess(event, id);
  const db = await getDatabase();
  return { ...(await bugReportIntake(db, id, user.role)), stepShots: BUG_REPORT_LIMITS.stepShots };
});
