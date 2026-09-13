import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { syncTrackerLinks, type SyncResult } from '../../utils/integrations/sync';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Refresh tracker statuses now',
    description:
      'Runs one status-sync sweep immediately — the same pass the scheduled `integrations:sync` task makes — and returns how many links it refreshed, failed and skipped. Requires administrator role.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event): Promise<SyncResult> => {
  await requireAuth(event, [Role.ADMINISTRATOR]);
  const db = await getDatabase();
  return await syncTrackerLinks(db);
});
