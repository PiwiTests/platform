import { eq, and, or, isNull } from 'drizzle-orm';
import { requireAuth, isAuthEnabled } from '../../utils/auth';
import { getProjectScope, scopeAllows } from '../../utils/project-access';
import { runEventBus } from '../../utils/run-events';
import { createSSEEndpoint } from '../../utils/sse';
import { getDatabase } from '../../database';
import { notificationChannels, subscriptions } from '../../database/schema';

defineRouteMeta({
  openAPI: {
    tags: ['Notifications'],
    summary: 'Notification event stream',
    description:
      "Server-sent events stream (text/event-stream) of the signed-in user's browser notifications, filtered to their subscriptions and project scope.",
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

/** How long a connection's loaded browser subscriptions stay fresh. */
const SUBSCRIPTIONS_TTL_MS = 60_000;

interface BrowserSubscription {
  events: string[];
  projectId: number | null;
  mutedUntil: Date | null;
}

export default eventHandler(async (event) => {
  const user = await requireAuth(event);

  // With auth disabled the instance is single-user, so there is no cross-project
  // boundary to enforce — stream every notification; the client's cookie
  // preferences gate which events raise browser notifications.
  if (!isAuthEnabled()) {
    return createSSEEndpoint(event, (controller, encoder) =>
      runEventBus.subscribeNotifications((notificationEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(notificationEvent)}\n\n`));
        } catch {
          // Stream closed — unsubscribe is handled by SSE helper
        }
      }),
    );
  }

  const db = await getDatabase();

  // The user's active browser-channel subscriptions (own + global) decide which
  // events this connection streams.
  const loadSubscriptions = async (): Promise<BrowserSubscription[]> => {
    const rows = await db
      .select({
        events: subscriptions.events,
        projectId: subscriptions.projectId,
        mutedUntil: subscriptions.mutedUntil,
      })
      .from(subscriptions)
      .innerJoin(notificationChannels, eq(subscriptions.channelId, notificationChannels.id))
      .where(
        and(
          eq(notificationChannels.type, 'browser'),
          eq(subscriptions.active, true),
          or(isNull(subscriptions.userId), eq(subscriptions.userId, user.id)),
        ),
      );
    return rows.map((r) => ({
      events: (r.events as string[] | null) ?? [],
      projectId: r.projectId,
      mutedUntil: r.mutedUntil,
    }));
  };

  // No early close on an empty subscription set: an event can still be targeted
  // at this user by id (e.g. cluster.fixed to the author of the fix), and that
  // must reach them even with nothing subscribed. Such a connection stays quiet
  // until an event is addressed to them.
  let subs = await loadSubscriptions();

  // Compute the caller's project scope once for the life of the connection, and
  // never stream an event for a project they cannot access.
  const scope = await getProjectScope(db, user);

  let loadedAt = Date.now();
  let refreshing = false;

  const matchesSubscription = (type: string, projectId: number): boolean => {
    const now = new Date();
    return subs.some(
      (s) =>
        s.events.includes(type) &&
        (s.projectId == null || s.projectId === projectId) &&
        (!s.mutedUntil || s.mutedUntil <= now),
    );
  };

  return createSSEEndpoint(event, (controller, encoder) => {
    return runEventBus.subscribeNotifications((notificationEvent) => {
      const projectId = notificationEvent.projectId as number | undefined;
      if (typeof projectId === 'number' && !scopeAllows(scope, projectId)) return;

      // Refresh the subscription snapshot in the background when stale, so
      // event/mute changes apply to long-lived connections without a reconnect.
      if (Date.now() - loadedAt > SUBSCRIPTIONS_TTL_MS && !refreshing) {
        refreshing = true;
        loadSubscriptions()
          .then((next) => {
            subs = next;
            loadedAt = Date.now();
          })
          .catch(() => {})
          .finally(() => {
            refreshing = false;
          });
      }

      // A targeted event (e.g. cluster.fixed addressed at the author of the fix)
      // is delivered to that one user regardless of their subscriptions; every
      // other connection falls back to normal subscription matching.
      const targetUserId = notificationEvent.targetUserId as number | undefined;
      const targetedAtMe = typeof targetUserId === 'number' && targetUserId === user.id;

      const type = notificationEvent.type as string | undefined;
      if (!targetedAtMe && typeof projectId === 'number' && type && !matchesSubscription(type, projectId)) return;

      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(notificationEvent)}\n\n`));
      } catch {
        // Stream closed — unsubscribe is handled by SSE helper
      }
    });
  });
});
