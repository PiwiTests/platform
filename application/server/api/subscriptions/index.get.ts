import { eq, and, or, isNull } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { subscriptions, notificationChannels } from '../../database/schema';
import { requireAuth, isAuthEnabled } from '../../utils/auth';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Notifications'],
    summary: 'List subscriptions',
    description: "Returns the current user's subscriptions (admins can see all).",
    'x-required-roles': REQUIRED_ROLES,
    parameters: [{ name: 'projectId', in: 'query', schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event))
    throw createError({ statusCode: 400, message: 'Enable authentication to use notifications' });
  const user = await requireAuth(event);
  const db = await getDatabase();

  const projectIdParam = getQuery(event).projectId;
  const projectId = projectIdParam ? parseInt(String(projectIdParam)) : null;

  const isAdmin = user.role === Role.ADMINISTRATOR;

  const rows = await db
    .select({ sub: subscriptions, channel: notificationChannels })
    .from(subscriptions)
    .innerJoin(notificationChannels, eq(subscriptions.channelId, notificationChannels.id))
    .where(
      and(
        isAdmin ? undefined : or(isNull(subscriptions.userId), eq(subscriptions.userId, user.id)),
        projectId ? eq(subscriptions.projectId, projectId) : undefined,
      ),
    );

  return {
    subscriptions: rows.map(({ sub, channel }) => ({
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
    })),
  };
});
