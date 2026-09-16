import type { subscriptions, notificationChannels } from '../database/schema';

type SubscriptionRow = typeof subscriptions.$inferSelect;
type ChannelRef = Pick<typeof notificationChannels.$inferSelect, 'id' | 'name' | 'type'>;

/**
 * Wire shape of a subscription — the single projection returned by the list,
 * create, and update endpoints so every subscription-returning endpoint speaks
 * the same shape. The channel is inlined as a lightweight reference; secrets in
 * the channel config are never part of this projection.
 */
export function formatSubscription(sub: SubscriptionRow, channel: ChannelRef) {
  return {
    id: sub.id,
    userId: sub.userId,
    projectId: sub.projectId,
    events: sub.events,
    filters: sub.filters,
    mode: sub.mode,
    digestAt: sub.digestAt,
    mutedUntil: sub.mutedUntil,
    active: sub.active,
    createdAt: sub.createdAt,
    channel: { id: channel.id, name: channel.name, type: channel.type },
  };
}
