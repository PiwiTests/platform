import { getDatabase } from '../../database';
import { syncTrackerLinks } from '../../utils/integrations/sync';

export default defineTask({
  meta: {
    name: 'integrations:sync',
    description: 'Refresh tracker link statuses and apply the resolve/reopen policies',
  },
  async run() {
    const db = await getDatabase();
    const { refreshed, failed, skipped } = await syncTrackerLinks(db);
    if (refreshed > 0 || failed > 0) {
      console.info(`[integrations:sync] refreshed=${refreshed} failed=${failed} skipped=${skipped}`);
    }
    return { result: { refreshed, failed, skipped } };
  },
});
