import { and, eq, or, isNull } from 'drizzle-orm';
import { subscriptions, notificationChannels, notificationDeliveries } from '../../database/schema';
import type { NotificationEvent, NotificationPayload, RunFinishedPayload } from '../../../shared/notification-events';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

interface SubscriptionFilters {
  branches?: string[];
  tags?: string[];
  statuses?: string[];
  defaultBranchOnly?: boolean;
  flakinessThreshold?: number;
  perfRegressionPct?: number;
}

function parseDigestHHMM(digestAt: string | null | undefined): { hour: number; minute: number } | null {
  if (!digestAt) return null;
  const match = digestAt.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return { hour: parseInt(match[1]!), minute: parseInt(match[2]!) };
}

function nextDigestTime(digestAt: string): Date {
  const parsed = parseDigestHHMM(digestAt);
  if (!parsed) return new Date(Date.now() + 24 * 60 * 60 * 1000);
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), parsed.hour, parsed.minute, 0, 0),
  );
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function passesFilters(
  filters: SubscriptionFilters | null | undefined,
  event: NotificationEvent,
  payload: NotificationPayload,
): boolean {
  if (!filters) return true;

  const runPayload = payload as RunFinishedPayload;

  if (filters.defaultBranchOnly && event.startsWith('run.')) {
    if (!runPayload.isDefaultBranch) return false;
  }
  if (filters.branches?.length && event.startsWith('run.') && runPayload.branch) {
    if (!filters.branches.includes(runPayload.branch)) return false;
  }
  if (filters.statuses?.length && event.startsWith('run.') && runPayload.status) {
    if (!filters.statuses.includes(runPayload.status)) return false;
  }
  if (filters.flakinessThreshold != null && event === 'flakiness.spike') {
    const rate = runPayload.flakinessRate ?? 0;
    if (rate < filters.flakinessThreshold) return false;
  }

  return true;
}

/**
 * For a given event+payload, find matching subscriptions and enqueue delivery rows.
 * Uses INSERT OR IGNORE (via unique dedupeKey) to make it idempotent.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function matchAndEnqueue(
  db: LibSQLDatabase<any>,
  event: NotificationEvent,
  payload: NotificationPayload,
): Promise<number> {
  const projectId = (payload as { projectId: number }).projectId;

  const rows = await db
    .select({ sub: subscriptions, channel: notificationChannels })
    .from(subscriptions)
    .innerJoin(notificationChannels, eq(subscriptions.channelId, notificationChannels.id))
    .where(
      and(eq(subscriptions.active, true), or(isNull(subscriptions.projectId), eq(subscriptions.projectId, projectId))),
    );

  let enqueued = 0;
  const now = new Date();

  for (const { sub, channel } of rows) {
    // Check event is subscribed
    const events = (sub.events as string[] | null) ?? [];
    if (!events.includes(event)) continue;

    // Check mute
    if (sub.mutedUntil && new Date(sub.mutedUntil) > now) continue;

    // Check filters
    const filters = sub.filters as SubscriptionFilters | null;
    if (!passesFilters(filters, event, payload)) continue;

    const runId = (payload as { runId?: number }).runId;
    const dedupeKey = `${event}:${runId ?? 'x'}:${channel.id}`;
    const scheduledFor = sub.mode === 'digest' && sub.digestAt ? nextDigestTime(sub.digestAt) : now;

    try {
      await db.insert(notificationDeliveries).values({
        subscriptionId: sub.id,
        channelId: channel.id,
        event,
        payload: payload as unknown as Record<string, unknown>,
        dedupeKey,
        status: 'pending',
        scheduledFor,
        createdAt: now,
      });
      enqueued++;
    } catch {
      // Unique constraint on dedupeKey → duplicate, skip silently
    }
  }

  return enqueued;
}
