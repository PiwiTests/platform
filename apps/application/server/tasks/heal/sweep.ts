import { getDatabase } from '../../database';
import { sweepHealActions } from '../../utils/heal/dispatch';

export default defineTask({
  meta: {
    name: 'heal:sweep',
    description: 'Open queued auto-heal pull requests (durable outbox with retry/backoff)',
  },
  async run() {
    const db = await getDatabase();
    const { opened, failed, skipped } = await sweepHealActions(db);
    if (opened > 0 || failed > 0 || skipped > 0) {
      console.info(`[heal:sweep] opened=${opened} failed=${failed} skipped=${skipped}`);
    }
    return { result: { opened, failed, skipped } };
  },
});
