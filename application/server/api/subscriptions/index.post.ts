import { getDatabase } from '../../database';
import { subscriptions, notificationChannels } from '../../database/schema';
import { requireAuth, isAuthEnabled } from '../../utils/auth';
import { NOTIFICATION_EVENTS } from '../../../shared/notification-events';
import { Role } from '../../../shared/types';
import { z } from 'zod';
import { eq } from 'drizzle-orm';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Notifications'],
    summary: 'Create a subscription',
    description: 'Creates a new subscription for the current user.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

const schema = z.object({
  channelId: z.number().int(),
  projectId: z.number().int().nullable().optional(),
  events: z.array(z.enum(NOTIFICATION_EVENTS)).min(1),
  filters: z
    .object({
      branches: z.array(z.string()).optional(),
      statuses: z.array(z.string()).optional(),
      defaultBranchOnly: z.boolean().optional(),
      flakinessThreshold: z.number().min(0).max(1).optional(),
      perfRegressionPct: z.number().min(0).optional(),
    })
    .optional(),
  mode: z.enum(['realtime', 'digest']).optional(),
  digestAt: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/)
    .optional(),
});

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event))
    throw createError({ statusCode: 400, message: 'Enable authentication to use notifications' });
  const user = await requireAuth(event);
  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  const { channelId, projectId, events, filters, mode, digestAt } = parsed.data;

  const db = await getDatabase();
  const [channel] = await db.select().from(notificationChannels).where(eq(notificationChannels.id, channelId));
  if (!channel) throw createError({ statusCode: 400, message: 'Channel not found' });

  const isAdmin = user.role === Role.ADMINISTRATOR;
  if (channel.userId !== null && channel.userId !== user.id && !isAdmin) {
    throw createError({ statusCode: 403, message: "Cannot subscribe to another user's channel" });
  }

  const [sub] = await db
    .insert(subscriptions)
    .values({
      userId: user.id,
      channelId,
      projectId: projectId ?? null,
      events: events as unknown as string[],
      filters: (filters as unknown as Record<string, unknown>) ?? null,
      mode: mode || 'realtime',
      digestAt: digestAt || null,
      active: true,
    })
    .returning({ id: subscriptions.id });

  return { success: true, subscriptionId: sub?.id };
});
