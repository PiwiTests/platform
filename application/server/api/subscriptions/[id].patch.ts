import { eq, and, or, isNull } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { subscriptions, notificationChannels } from '../../database/schema';
import { requireAuth, isAuthEnabled } from '../../utils/auth';
import { NOTIFICATION_EVENTS } from '#shared/notification-events';
import { Role } from '#shared/types';
import { z } from 'zod';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Notifications'],
    summary: 'Update a subscription',
    description: 'Updates events, filters, mode, muting, or active state.',
    'x-required-roles': REQUIRED_ROLES,
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

const schema = z.object({
  channelId: z.number().int().positive().optional(),
  events: z.array(z.enum(NOTIFICATION_EVENTS)).optional(),
  filters: z.record(z.string(), z.unknown()).nullable().optional(),
  mode: z.enum(['realtime', 'digest']).optional(),
  digestAt: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/)
    .nullable()
    .optional(),
  mutedUntil: z.string().datetime().nullable().optional(),
  active: z.boolean().optional(),
});

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) throw createError({ statusCode: 400, message: 'Authentication not enabled' });
  const user = await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid subscription ID' });

  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Invalid request body' });

  const db = await getDatabase();
  const isAdmin = user.role === Role.ADMINISTRATOR;
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(isAdmin ? eq(subscriptions.id, id) : and(eq(subscriptions.id, id), eq(subscriptions.userId, user.id)));
  if (!sub) throw createError({ statusCode: 404, message: 'Subscription not found' });

  const update: Record<string, unknown> = { updatedAt: new Date() };
  const d = parsed.data;

  if (d.channelId !== undefined) {
    // Ensure the target channel is owned by this user or is global
    const [ch] = await db
      .select({ id: notificationChannels.id })
      .from(notificationChannels)
      .where(
        and(
          eq(notificationChannels.id, d.channelId),
          isAdmin ? undefined : or(isNull(notificationChannels.userId), eq(notificationChannels.userId, user.id)),
        ),
      );
    if (!ch) throw createError({ statusCode: 403, message: 'Channel not found or not accessible' });
    update.channelId = d.channelId;
  }

  if (d.events !== undefined) update.events = d.events;
  if (d.filters !== undefined) update.filters = d.filters;
  if (d.mode !== undefined) update.mode = d.mode;
  if (d.digestAt !== undefined) update.digestAt = d.digestAt;
  if (d.mutedUntil !== undefined) update.mutedUntil = d.mutedUntil ? new Date(d.mutedUntil) : null;
  if (d.active !== undefined) update.active = d.active;

  await db.update(subscriptions).set(update).where(eq(subscriptions.id, id));
  return { success: true };
});
