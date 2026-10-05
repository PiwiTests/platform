import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { syncTrackerLinks, type SyncResult } from '../../utils/integrations/sync';

defineRouteMeta({
  openAPI: {
    tags: ['Integrations'],
    summary: 'Refresh tracker statuses now',
    description:
      'Runs one status-sync sweep immediately — the same pass the scheduled `integrations:sync` task makes — and returns how many links it refreshed, failed and skipped. Requires `connections:manage` (administrators only).',
    'x-required-permission': 'connections:manage',
  },
});

export default eventHandler(async (event): Promise<SyncResult> => {
  await requireAuth(event);
  const db = await getDatabase();
  return await syncTrackerLinks(db);
});
