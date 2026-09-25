import { and, eq, lte, lt } from 'drizzle-orm';
import { notificationDeliveries, notificationChannels, subscriptions, users } from '../../database/schema';
import {
  sendEmail,
  renderRunNotificationEmail,
  renderNewClusterEmail,
  renderDigestEmail,
  isEmailConfigured,
  type DigestItem,
} from '../email';
import { decryptSecret, getEncryptionKey } from '../crypto';
import { safeFetch } from '../safe-fetch';
import type {
  ClusterFixedPayload,
  ClusterRegressedPayload,
  NotificationEvent,
  NotificationPayload,
  RunFinishedPayload,
  ClusterNewPayload,
} from '#shared/notification-events';
import { renderEventSubject, notificationTargetPath, failureTargetPath } from '#shared/notification-events';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { nextAttempt, OUTBOX_MAX_ATTEMPTS } from '../outbox';
import { REPORT_READY_EVENT, type ReportReadyPayload } from '#shared/notification-events';
import {
  loadReportForDelivery,
  publishReportNotification,
  reportSlackMessage,
  reportWebhookBody,
  sendReportEmail,
  snapshotUrl,
} from '../reports/deliver';

const MAX_ATTEMPTS = OUTBOX_MAX_ATTEMPTS;
/** Slack digest messages list at most this many items; the rest are counted. */
const SLACK_DIGEST_MAX_ITEMS = 20;

const siteBase = () => process.env.PIWI_SITE_URL?.replace(/\/$/, '') || 'http://localhost:3000';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = LibSQLDatabase<any>;

interface ChannelRow {
  id: number;
  type: string;
  userId: number | null;
  config: unknown;
}

interface DeliveryRow {
  id: number;
  event: string;
  payload: unknown;
  attempts: number | null;
  scheduledFor: Date | null;
}

/** Resolve the destination address for an email or personal_email channel. */
async function resolveEmailAddress(db: Db, channel: ChannelRow): Promise<string> {
  if (channel.type === 'personal_email') {
    if (!channel.userId) throw new Error('Personal email channel has no owner');
    const [owner] = await db.select({ email: users.email }).from(users).where(eq(users.id, channel.userId));
    if (!owner?.email) throw new Error('Account has no email address');
    return owner.email;
  }
  const to = (channel.config as Record<string, unknown> | null)?.address as string;
  if (!to) throw new Error('No email address configured');
  return to;
}

async function sendToEmail(to: string, event: NotificationEvent, payload: NotificationPayload) {
  if (!isEmailConfigured()) throw new Error('SMTP not configured');

  let html: string;
  let text: string;

  if (event.startsWith('run.')) {
    const p = payload as RunFinishedPayload;
    ({ html, text } = renderRunNotificationEmail({
      projectName: p.projectName,
      runId: p.runId,
      status: p.status,
      totalTests: p.totalTests,
      failedTests: p.failedTests,
      branch: p.branch,
      topFailures: p.topFailures,
    }));
  } else if (event === 'cluster.new') {
    const p = payload as ClusterNewPayload;
    ({ html, text } = renderNewClusterEmail({
      projectName: p.projectName,
      clusterId: p.clusterId,
      signature: p.signature,
      title: p.title,
      sampleErrorExcerpt: p.sampleErrorExcerpt,
      affectedCases: p.affectedCases,
      knownIssue: p.knownIssue,
    }));
  } else {
    const subject = renderEventSubject(event, payload);
    html = `<p>${subject}</p>`;
    text = subject;
  }

  await sendEmail({ to, subject: renderEventSubject(event, payload), html, text });
}

async function postToSlack(webhookUrl: string, body: Record<string, unknown>) {
  const res = await safeFetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`);
}

async function sendToSlack(config: Record<string, unknown>, event: NotificationEvent, payload: NotificationPayload) {
  const webhookUrl = config.webhookUrl as string;
  if (!webhookUrl) throw new Error('No Slack webhook URL configured');

  const text = renderEventSubject(event, payload);
  let emoji = ':bell:';
  if (event.startsWith('run.failed')) emoji = ':x:';
  else if (event === 'cluster.new') emoji = ':bug:';
  else if (event === 'cluster.fixed') emoji = ':white_check_mark:';
  else if (event === 'cluster.regressed') emoji = ':rotating_light:';
  else if (event === 'flakiness.spike') emoji = ':game_die:';

  const base = siteBase();
  // Slack section text is capped at 3000 chars; keep excerpts short.
  const slackExcerpt = (s: string) => (s.length > 600 ? s.slice(0, 600) + '…' : s);

  const blocks: Record<string, unknown>[] = [{ type: 'section', text: { type: 'mrkdwn', text: `${emoji} *${text}*` } }];

  if (event.startsWith('run.')) {
    const p = payload as RunFinishedPayload;
    for (const f of p.topFailures ?? []) {
      const path = failureTargetPath(f);
      const link = path ? `<${base}${path}|${f.title}>` : f.title;
      const headline = f.headline ? `\n${slackExcerpt(f.headline)}` : '';
      const excerpt = f.errorExcerpt ? `\n\`\`\`${slackExcerpt(f.errorExcerpt)}\`\`\`` : '';
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `• *${link}*${headline}${excerpt}` } });
    }
  } else if (event === 'cluster.new') {
    const p = payload as ClusterNewPayload;
    const parts: string[] = [];
    if (p.title && p.title !== p.signature) parts.push(`*${p.title}*`);
    parts.push(`\`${slackExcerpt(p.signature)}\``);
    if (p.affectedCases) parts.push(`${p.affectedCases} affected test${p.affectedCases === 1 ? '' : 's'}`);
    if (p.sampleErrorExcerpt) parts.push(`\`\`\`${slackExcerpt(p.sampleErrorExcerpt)}\`\`\``);
    if (p.knownIssue) parts.push(`Tracked in <${p.knownIssue.url}|${p.knownIssue.key}>`);
    parts.push(`<${base}/failure-clusters/${p.clusterId}|View cluster>`);
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: parts.join('\n') } });
  } else if (event === 'cluster.fixed' || event === 'cluster.regressed') {
    const p = payload as ClusterFixedPayload | ClusterRegressedPayload;
    const parts: string[] = [p.title || `\`${slackExcerpt(p.signature)}\``];
    if (event === 'cluster.fixed') {
      const fixed = p as ClusterFixedPayload;
      if (fixed.resolved) parts.push('Triage status set to resolved.');
    } else if ((p as ClusterRegressedPayload).reopened) {
      parts.push('Triage status set back to open.');
    }
    if (p.knownIssue) parts.push(`Tracked in <${p.knownIssue.url}|${p.knownIssue.key}>`);
    parts.push(`<${base}/failure-clusters/${p.clusterId}|View cluster>`);
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: parts.join('\n') } });
  }

  await postToSlack(webhookUrl, { text: `${emoji} *${text}*`, blocks });
}

async function sendSlackDigest(config: Record<string, unknown>, items: DigestItem[]) {
  const webhookUrl = config.webhookUrl as string;
  if (!webhookUrl) throw new Error('No Slack webhook URL configured');

  const base = siteBase();
  const header = `:bell: Piwi digest — ${items.length} notification${items.length === 1 ? '' : 's'}`;
  const blocks: Record<string, unknown>[] = [{ type: 'section', text: { type: 'mrkdwn', text: `*${header}*` } }];

  for (const { event, payload } of items.slice(0, SLACK_DIGEST_MAX_ITEMS)) {
    const line = renderEventSubject(event, payload);
    const path = notificationTargetPath(event, payload);
    const text = path ? `• <${base}${path}|${line}>` : `• ${line}`;
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text } });
  }
  if (items.length > SLACK_DIGEST_MAX_ITEMS) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `…and ${items.length - SLACK_DIGEST_MAX_ITEMS} more` },
    });
  }

  await postToSlack(webhookUrl, { text: header, blocks });
}

async function sendToWebhook(config: Record<string, unknown>, event: NotificationEvent, payload: NotificationPayload) {
  await postSignedWebhook(config, JSON.stringify({ event, payload, timestamp: new Date().toISOString() }));
}

/** POST a JSON body to a webhook channel, HMAC-SHA256 signed in `X-Piwi-Signature` when it has a secret. */
async function postSignedWebhook(config: Record<string, unknown>, body: string) {
  const url = config.url as string;
  if (!url) throw new Error('No webhook URL configured');

  const encryptedSecret = config.secret as string | undefined;
  const secret = encryptedSecret ? decryptSecret(encryptedSecret, getEncryptionKey()) : null;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (secret) {
    // HMAC-SHA256 signature in X-Piwi-Signature
    const { createHmac } = await import('node:crypto');
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    headers['X-Piwi-Signature'] = `sha256=${sig}`;
  }

  const res = await safeFetch(url, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
}

/**
 * Deliver a quality report (`report.ready`, queued by a report schedule):
 * the snapshot rendered for the channel type.
 */
async function sendQualityReport(db: Db, d: DeliveryRow, c: ChannelRow) {
  const config = (c.config ?? {}) as Record<string, unknown>;
  const payload = (d.payload ?? {}) as ReportReadyPayload;
  const { bundle, projectIds } = await loadReportForDelivery(db as any, payload);
  if (c.type === 'personal_email' || c.type === 'email') {
    await sendReportEmail(await resolveEmailAddress(db, c), bundle, payload);
  } else if (c.type === 'slack') {
    const webhookUrl = config.webhookUrl as string;
    if (!webhookUrl) throw new Error('No Slack webhook URL configured');
    await postToSlack(webhookUrl, reportSlackMessage(bundle, snapshotUrl(payload.snapshotId)));
  } else if (c.type === 'webhook') {
    await postSignedWebhook(config, reportWebhookBody(bundle, payload));
  } else if (c.type === 'browser') {
    publishReportNotification(bundle, payload, c.userId, projectIds);
  } else throw new Error(`Unknown channel type: ${c.type}`);
}

/** Deliver a single outbox row through its channel. */
async function sendSingle(db: Db, d: DeliveryRow, c: ChannelRow) {
  // A quality report is not a notification event: it has its own renderers and no subject line.
  if (d.event === REPORT_READY_EVENT) return sendQualityReport(db, d, c);
  const config = (c.config ?? {}) as Record<string, unknown>;
  const event = d.event as NotificationEvent;
  const payload = (d.payload ?? {}) as NotificationPayload;

  if (c.type === 'personal_email' || c.type === 'email') {
    await sendToEmail(await resolveEmailAddress(db, c), event, payload);
  } else if (c.type === 'slack') await sendToSlack(config, event, payload);
  else if (c.type === 'webhook') await sendToWebhook(config, event, payload);
  else if (c.type === 'browser') {
    /* Delivered via SSE — the notification/stream endpoint handles this channel type */
  } else throw new Error(`Unknown channel type: ${c.type}`);
}

/** Deliver a batch of digest-mode rows through one channel as one message. */
async function sendDigest(db: Db, c: ChannelRow, rows: DeliveryRow[]) {
  const items: DigestItem[] = rows.map((d) => ({
    event: d.event as NotificationEvent,
    payload: (d.payload ?? {}) as NotificationPayload,
  }));

  if (c.type === 'personal_email' || c.type === 'email') {
    if (!isEmailConfigured()) throw new Error('SMTP not configured');
    const to = await resolveEmailAddress(db, c);
    const { subject, html, text } = renderDigestEmail(items);
    await sendEmail({ to, subject, html, text });
  } else if (c.type === 'slack') {
    await sendSlackDigest((c.config ?? {}) as Record<string, unknown>, items);
  } else {
    throw new Error(`Digest not supported for channel type: ${c.type}`);
  }
}

async function markSent(db: Db, rows: DeliveryRow[], now: Date) {
  for (const d of rows) {
    await db
      .update(notificationDeliveries)
      .set({ status: 'sent', sentAt: now, attempts: (d.attempts ?? 0) + 1, error: null })
      .where(eq(notificationDeliveries.id, d.id));
  }
}

async function markFailed(db: Db, rows: DeliveryRow[], message: string, now: Date) {
  for (const d of rows) {
    const attempts = (d.attempts ?? 0) + 1;
    const next = nextAttempt(attempts, now, d.scheduledFor);

    await db
      .update(notificationDeliveries)
      .set({
        status: next.status,
        attempts,
        error: message,
        scheduledFor: next.scheduledFor,
      })
      .where(eq(notificationDeliveries.id, d.id));

    console.error(`[notifications] Delivery ${d.id} failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${message}`);
  }
}

/**
 * Process pending deliveries that are due now (scheduledFor <= now, status = 'pending', attempts < MAX).
 *
 * Email and Slack deliveries queued by a digest-mode subscription batch into
 * one message per channel; every other delivery (realtime, webhook, browser)
 * sends individually. Returns per-row sent/failed counts.
 */
export async function sweepOutbox(db: Db): Promise<{ sent: number; failed: number }> {
  const now = new Date();
  let sent = 0;
  let failed = 0;

  const due = await db
    .select({ d: notificationDeliveries, c: notificationChannels, mode: subscriptions.mode })
    .from(notificationDeliveries)
    .innerJoin(notificationChannels, eq(notificationDeliveries.channelId, notificationChannels.id))
    .leftJoin(subscriptions, eq(notificationDeliveries.subscriptionId, subscriptions.id))
    .where(
      and(
        eq(notificationDeliveries.status, 'pending'),
        lte(notificationDeliveries.scheduledFor, now),
        lt(notificationDeliveries.attempts, MAX_ATTEMPTS),
      ),
    );

  const digestable = (row: (typeof due)[number]) =>
    row.mode === 'digest' && (row.c.type === 'email' || row.c.type === 'personal_email' || row.c.type === 'slack');

  const singles: (typeof due)[number][] = [];
  const digestGroups = new Map<number, (typeof due)[number][]>();
  for (const row of due) {
    if (!digestable(row)) {
      singles.push(row);
      continue;
    }
    const group = digestGroups.get(row.c.id);
    if (group) group.push(row);
    else digestGroups.set(row.c.id, [row]);
  }
  // A batch of one reads better as the full single-event message.
  for (const [channelId, group] of digestGroups) {
    if (group.length === 1) {
      singles.push(group[0]!);
      digestGroups.delete(channelId);
    }
  }

  for (const { d, c } of singles) {
    try {
      await sendSingle(db, d, c);
      await markSent(db, [d], now);
      sent++;
    } catch (err) {
      await markFailed(db, [d], err instanceof Error ? err.message : String(err), now);
      failed++;
    }
  }

  for (const group of digestGroups.values()) {
    const rows = group.map((g) => g.d);
    try {
      await sendDigest(db, group[0]!.c, rows);
      await markSent(db, rows, now);
      sent += rows.length;
    } catch (err) {
      await markFailed(db, rows, err instanceof Error ? err.message : String(err), now);
      failed += rows.length;
    }
  }

  return { sent, failed };
}
