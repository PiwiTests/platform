import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { mintAccountToken } from '../../utils/account-tokens';
import { isEmailConfigured, sendEmail, renderVerifyEmail } from '../../utils/email';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Send email verification link',
    description: "Sends a verification link to the authenticated user's email address.",
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  if (!user.email) throw createError({ statusCode: 400, message: 'No email address on this account' });
  if (!isEmailConfigured()) throw createError({ statusCode: 503, message: 'SMTP is not configured' });

  const db = await getDatabase();
  const token = await mintAccountToken(db, user.id, 'verify');
  const { html, text } = renderVerifyEmail(token);

  try {
    await sendEmail({ to: user.email, subject: 'Verify your email — Piwi Dashboard', html, text });
    return { success: true };
  } catch {
    throw createError({ statusCode: 500, message: 'Failed to send verification email' });
  }
});
