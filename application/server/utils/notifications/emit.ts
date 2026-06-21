import { isAuthEnabled } from '../auth';
import { matchAndEnqueue } from './match';
import { sweepOutbox } from './dispatch';
import type { NotificationEvent, NotificationPayload } from '../../../shared/notification-events';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

/**
 * Entry point: match subscriptions for an event, enqueue deliveries, then
 * kick the outbox sweeper to deliver realtime deliveries immediately.
 * Gated on auth being enabled (subscriptions require a real user identity).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function emitNotification(
  db: LibSQLDatabase<any>,
  event: NotificationEvent,
  payload: NotificationPayload,
): Promise<void> {
  if (!isAuthEnabled()) return; // notifications require auth

  try {
    const enqueued = await matchAndEnqueue(db, event, payload);
    if (enqueued > 0) {
      // Best-effort immediate delivery; sweeper handles failures/retries
      sweepOutbox(db).catch((e) => console.error('[notifications] sweep after emit failed', e));
    }
  } catch (e) {
    console.error('[notifications] emitNotification failed', e);
  }
}
