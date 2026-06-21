import { getDatabase } from '../../database';
import { sweepOutbox } from '../../utils/notifications/dispatch';

export default defineTask({
  meta: {
    name: 'notifications:sweep',
    description: 'Process pending notification deliveries (outbox sweeper with retry/backoff)',
  },
  async run() {
    const db = await getDatabase();
    const { sent, failed } = await sweepOutbox(db);
    if (sent > 0 || failed > 0) {
      console.info(`[notifications:sweep] sent=${sent} failed=${failed}`);
    }
    return { result: { sent, failed } };
  },
});
