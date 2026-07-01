import { getDatabase } from '../../database';
import { notificationChannels } from '../../database/schema';
import { requireAuth, isAuthEnabled } from '../../utils/auth';
import { encryptSecret, getEncryptionKey } from '../../utils/crypto';
import { Role } from '#shared/types';
import { z } from 'zod';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Notifications'],
    summary: 'Create a notification channel',
    description: 'Creates a new notification channel. Webhook secrets are encrypted at rest.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

const schema = z.object({
  name: z.string().min(1),
  type: z.enum(['email', 'slack', 'webhook']),
  config: z.record(z.string(), z.unknown()),
  global: z.boolean().optional(), // admin only: create a global (userId=null) channel
});

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) {
    throw createError({ statusCode: 400, message: 'Enable authentication to use notifications' });
  }
  const user = await requireAuth(event);
  const body = await readBody(event);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  }

  const { name, type, config, global: isGlobal } = parsed.data;

  if (isGlobal && user.role !== Role.ADMINISTRATOR) {
    throw createError({ statusCode: 403, message: 'Only administrators can create global channels' });
  }

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

  return { success: true, channel: { id: channel?.id, name: channel?.name, type: channel?.type } };
});
