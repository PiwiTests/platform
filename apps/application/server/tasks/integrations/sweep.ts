import { getDatabase } from '../../database';
import { sweepIntegrationActions } from '../../utils/integrations/actions';

export default defineTask({
  meta: {
    name: 'integrations:sweep',
    description: 'Perform queued integration actions (durable outbox with retry/backoff)',
  },
  async run() {
    const db = await getDatabase();
    const { done, failed, skipped } = await sweepIntegrationActions(db);
    if (done > 0 || failed > 0 || skipped > 0) {
      console.info(`[integrations:sweep] done=${done} failed=${failed} skipped=${skipped}`);
    }
    return { result: { done, failed, skipped } };
  },
});
