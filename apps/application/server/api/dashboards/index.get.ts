import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { dashboardActor, dashboardRoute } from '../../utils/dashboards';
import { listDashboards } from '#shared/handlers/dashboards';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'List dashboards',
    description:
      'Every dashboard the caller may open: the built-in dashboards (Overview first; the gaps digest only where the Test Map is not declined), then the shared saved dashboards and the caller’s private ones, most recently saved first. Each item says whether the caller may edit it and whether it is unused (a shared dashboard nobody opened for 90 days). Also returns the instance default dashboard, and whether the caller may share dashboards and set the default.',
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  return dashboardRoute(() => listDashboards(db as any, dashboardActor(event, user as any)));
});
