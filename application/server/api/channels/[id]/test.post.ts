import { eq } from 'drizzle-orm';
import { getDatabase } from '../../../database';
import { notificationChannels, users } from '../../../database/schema';
import { requireAuth, isAuthEnabled } from '../../../utils/auth';
import { decryptSecret, getEncryptionKey } from '../../../utils/crypto';
import { sendEmail, renderTestEmail, isEmailConfigured } from '../../../utils/email';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Notifications'],
    summary: 'Send test notification',
    description: 'Sends a test notification through the specified channel.',
    'x-required-roles': REQUIRED_ROLES,
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) throw createError({ statusCode: 400, message: 'Authentication not enabled' });
  const user = await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid channel ID' });

  const db = await getDatabase();
  const [channel] = await db.select().from(notificationChannels).where(eq(notificationChannels.id, id));
  if (!channel) throw createError({ statusCode: 404, message: 'Channel not found' });

  const isAdmin = user.role === Role.ADMINISTRATOR;
  if (channel.userId !== user.id && channel.userId !== null && !isAdmin) {
    throw createError({ statusCode: 403, message: 'Not authorized' });
  }

  const config = (channel.config ?? {}) as Record<string, unknown>;

  try {
    if (channel.type === 'personal_email') {
      if (!channel.userId) throw new Error('Personal email channel has no owner');
      if (!isEmailConfigured()) throw new Error('SMTP not configured');
      const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, channel.userId));
      if (!owner?.email) throw new Error('Account has no email address');
      const { html, text } = renderTestEmail(owner.email);
      await sendEmail({ to: owner.email, subject: 'Test notification — Piwi Dashboard', html, text });
    } else if (channel.type === 'email') {
      const to = config.address as string;
      if (!to) throw new Error('No email address configured');
      if (!isEmailConfigured()) throw new Error('SMTP not configured');
      const { html, text } = renderTestEmail(to);
      await sendEmail({ to, subject: 'Test notification — Piwi Dashboard', html, text });
    } else if (channel.type === 'slack') {
      const webhookUrl = config.webhookUrl as string;
      if (!webhookUrl) throw new Error('No Slack webhook URL');
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: ':bell: Test notification from Piwi Dashboard' }),
      });
      if (!res.ok) throw new Error(`Slack returned ${res.status}`);
    } else if (channel.type === 'webhook') {
      const url = config.url as string;
      if (!url) throw new Error('No webhook URL');
      const encryptedSecret = config.secret as string | undefined;
      const secret = encryptedSecret ? decryptSecret(encryptedSecret, getEncryptionKey()) : null;
      const body = JSON.stringify({ event: 'test', payload: {}, timestamp: new Date().toISOString() });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secret) {
        const { createHmac } = await import('node:crypto');
        headers['X-Piwi-Signature'] = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
      }
      const res = await fetch(url, { method: 'POST', headers, body });
      if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});
