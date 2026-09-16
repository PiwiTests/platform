import { eq } from 'drizzle-orm';
import { getDatabase } from '../../../database';
import { notificationChannels, users } from '../../../database/schema';
import { requireAuth } from '../../../utils/auth';
import { decryptSecret, getEncryptionKey } from '../../../utils/crypto';
import { sendEmail, renderTestEmail, isEmailConfigured } from '../../../utils/email';
import { safeFetch } from '../../../utils/safe-fetch';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Notifications'],
    summary: 'Send test notification',
    description:
      'Sends a test notification through the specified channel and marks it verified on success. Global channels can only be tested by administrators. Soft-fail: a reachable endpoint that rejects the delivery (bad webhook URL, SMTP failure, non-2xx response) returns HTTP 200 with `{ success: false, error }` — the request was processed, only the delivery attempt failed. HTTP error statuses are reserved for request-level problems (bad id, missing channel, not authorized).',
    'x-required-roles': [],
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    responses: {
      '200': {
        description: 'Delivery attempt result. `success` reports the outcome; a failed delivery still returns 200.',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['success'],
              properties: {
                success: { type: 'boolean' },
                error: { type: 'string', description: 'Present only when success is false.' },
              },
            },
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw apiError({ statusCode: 400, message: 'Invalid channel ID' });

  const db = await getDatabase();
  const [channel] = await db.select().from(notificationChannels).where(eq(notificationChannels.id, id));
  if (!channel) throw apiError({ statusCode: 404, message: 'Channel not found' });

  const isAdmin = user.role === Role.ADMINISTRATOR;
  // Global channels reach every subscriber, so only admins may fire tests at them.
  const allowed = channel.userId === null ? isAdmin : channel.userId === user.id || isAdmin;
  if (!allowed) {
    throw apiError({ statusCode: 403, message: 'Not authorized' });
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
      const res = await safeFetch(webhookUrl, {
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
      const res = await safeFetch(url, { method: 'POST', headers, body });
      if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
    }

    // A delivered test proves the destination works. personal_email stays
    // driven by account email verification instead.
    if (channel.type !== 'personal_email' && !channel.verified) {
      await db
        .update(notificationChannels)
        .set({ verified: true, updatedAt: new Date() })
        .where(eq(notificationChannels.id, id));
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});
