import { eq, or, isNull } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { notificationChannels, users } from '../../database/schema';
import { requireAuth, isAuthEnabled } from '../../utils/auth';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Notifications'],
    summary: 'List notification channels',
    description:
      'Returns channels owned by the current user and global (admin-managed) channels. Auto-creates a personal email channel if the user has an account email set.',
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) {
    throw createError({
      statusCode: 400,
      message: 'Enable authentication to use notifications (PIWI_AUTH_ENABLED=true)',
    });
  }
  const user = await requireAuth(event);
  const db = await getDatabase();

  // Fetch live user record for email / emailVerified (session may be stale)
  const [dbUser] = await db
    .select({ email: users.email, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, user.id));

  const isAdmin = user.role === Role.ADMINISTRATOR;
  const rows = await db
    .select()
    .from(notificationChannels)
    .where(isAdmin ? undefined : or(isNull(notificationChannels.userId), eq(notificationChannels.userId, user.id)));

  // Auto-create a personal_email channel for users who have an account email but no channel yet
  if (dbUser?.email) {
    const hasPersonal = rows.some((c) => c.type === 'personal_email' && c.userId === user.id);
    if (!hasPersonal) {
      const [created] = await db
        .insert(notificationChannels)
        .values({
          name: 'Account email',
          type: 'personal_email',
          config: {},
          userId: user.id,
          verified: Boolean(dbUser.emailVerified),
        })
        .returning();
      if (created) rows.push(created);
    }
  }

  return {
    channels: rows.map((c) => {
      // For the user's own personal_email channel: always reflect live account state
      const isOwnPersonal = c.type === 'personal_email' && c.userId === user.id;
      const config = isOwnPersonal
        ? { address: dbUser?.email ?? '' }
        : sanitizeConfig(c.type, (c.config ?? {}) as Record<string, unknown>);
      const verified = isOwnPersonal ? Boolean(dbUser?.emailVerified) : Boolean(c.verified);

      return {
        id: c.id,
        name: c.name,
        type: c.type,
        userId: c.userId,
        verified,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        config,
      };
    }),
  };
});

function sanitizeConfig(type: string, config: Record<string, unknown>): Record<string, unknown> {
  if (type === 'webhook') return { url: config.url }; // redact secret
  return config;
}
