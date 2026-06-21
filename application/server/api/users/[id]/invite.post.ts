import { eq } from 'drizzle-orm';
import { getDatabase } from '../../../database';
import { users } from '../../../database/schema';
import { requireAuth } from '../../../utils/auth';
import { mintAccountToken } from '../../../utils/account-tokens';
import { isEmailConfigured, sendEmail, renderInviteEmail } from '../../../utils/email';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR];

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'Send invite email',
    description:
      'Sends an invite email to a user with a link to set their password. Requires the user to have an email address set. Requires administrator role.',
    'x-required-roles': REQUIRED_ROLES,
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const admin = await requireAuth(event, REQUIRED_ROLES);
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid user ID' });

  const db = await getDatabase();
  const userRows = await db.select().from(users).where(eq(users.id, id));
  const user = userRows[0];
  if (!user) throw createError({ statusCode: 404, message: 'User not found' });
  if (!user.email) throw createError({ statusCode: 400, message: 'User has no email address' });

  if (!isEmailConfigured()) throw createError({ statusCode: 503, message: 'SMTP is not configured' });

  const token = await mintAccountToken(db, user.id, 'invite');
  const { html, text } = renderInviteEmail(token, admin.name || admin.username);

  try {
    await sendEmail({ to: user.email, subject: "You've been invited to Piwi Dashboard", html, text });
    console.info('[users/invite] Invite sent to user %d (%s)', user.id, user.email);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[users/invite] Failed to send invite:', message);
    throw createError({ statusCode: 500, message: 'Failed to send invite email' });
  }
});
