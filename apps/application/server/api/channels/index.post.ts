import { getDatabase } from '../../database';
import { notificationChannels } from '../../database/schema';
import { requireAuth, isAuthEnabled } from '../../utils/auth';
import { encryptSecret, getEncryptionKey } from '../../utils/crypto';
import { sanitizeChannelConfig } from '../../utils/channels';
import { Role } from '#shared/types';
import { z } from 'zod';

defineRouteMeta({
  openAPI: {
    tags: ['Notifications'],
    summary: 'Create a notification channel',
    description:
      'Creates a new notification channel. Webhook secrets are encrypted at rest. Administrators can create global channels; with authentication disabled every channel is global.',
    'x-required-roles': [],
  },
});

const schema = z.object({
  name: z.string().min(1),
  type: z.enum(['email', 'slack', 'webhook', 'browser']),
  config: z.record(z.string(), z.unknown()),
  global: z.boolean().optional(), // admin only: create a global (userId=null) channel
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  const { name, type, config, global: requestedGlobal } = parsed.data;

  if (requestedGlobal && user.role !== Role.ADMINISTRATOR) {
    throw apiError({ statusCode: 403, message: 'Only administrators can create global channels' });
  }

  // Without auth there is no user row to own a channel — everything is global.
  const isGlobal = requestedGlobal || !isAuthEnabled(event);

  // Encrypt webhook secret if present
  let storedConfig: Record<string, unknown> = { ...config };
  if (type === 'webhook' && typeof config.secret === 'string' && config.secret) {
    storedConfig = { ...config, secret: encryptSecret(config.secret, getEncryptionKey()) };
  }

  const db = await getDatabase();
  const [channel] = await db
    .insert(notificationChannels)
    .values({
      name,
      type,
      config: storedConfig,
      userId: isGlobal ? null : user.id,
      verified: false,
    })
    .returning();

  return {
    success: true,
    channel: {
      id: channel?.id,
      name: channel?.name,
      type: channel?.type,
      userId: channel?.userId ?? null,
      verified: Boolean(channel?.verified),
      createdAt: channel?.createdAt,
      updatedAt: channel?.updatedAt,
      config: sanitizeChannelConfig((channel?.config ?? {}) as Record<string, unknown>),
    },
  };
});
