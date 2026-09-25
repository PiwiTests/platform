import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { STATUS_COLORS } from '#shared/status-colors';
import { renderEventSubject, notificationTargetPath, failureTargetPath } from '#shared/notification-events';
import type {
  NotificationEvent,
  NotificationPayload,
  RunFinishedPayload,
  TopFailure,
} from '#shared/notification-events';
import { reportWidgets, type ReportBlock, type ReportBundle, type ReportTone } from '#shared/reports/types';
import { seriesColor } from '#shared/reports/chart';
import { sentencesFor } from '#shared/reports/sentences';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  from: string;
  fromName: string;
  hasPassword: boolean;
  secure: boolean;
  configured: boolean;
  envManaged: true;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
  /** Content id: an inline image the HTML shows as `<img src="cid:…">`. */
  cid?: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

let _transport: Transporter | null = null;
let _warnedMissingSiteUrl = false;

export function getSmtpConfig(): SmtpConfig {
  const host = process.env.PIWI_SMTP_HOST || '';
  const user = process.env.PIWI_SMTP_USER || '';
  const pass = process.env.PIWI_SMTP_PASS || '';
  const from = process.env.PIWI_SMTP_FROM || '';
  const fromName = process.env.PIWI_SMTP_FROM_NAME || 'Piwi Dashboard';
  const port = parseInt(process.env.PIWI_SMTP_PORT || '587', 10);
  // Default secure to true only for port 465; explicit PIWI_SMTP_SECURE overrides
  const secureDefault = port === 465;
  const secure =
    process.env.PIWI_SMTP_SECURE === 'true' || (process.env.PIWI_SMTP_SECURE === undefined && secureDefault);
  // Credentials are optional — a relay that accepts unauthenticated mail only
  // needs host + from.
  const configured = Boolean(host && from);

  return { host, port, user, from, fromName, hasPassword: Boolean(pass), secure, configured, envManaged: true };
}

export function isEmailConfigured(): boolean {
  return getSmtpConfig().configured;
}

function getTransport(): Transporter {
  if (_transport) return _transport;
  const cfg = getSmtpConfig();
  const pass = process.env.PIWI_SMTP_PASS || '';
  _transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    // Only authenticate when credentials are set; an auth block with empty
    // values would make nodemailer attempt AUTH against auth-less relays.
    ...(cfg.user && pass ? { auth: { user: cfg.user, pass } } : {}),
  });
  return _transport;
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const cfg = getSmtpConfig();
  if (!cfg.configured) {
    console.warn('[email] SMTP not configured — skipping send to', opts.to);
    return;
  }
  if (!process.env.PIWI_SITE_URL && !_warnedMissingSiteUrl) {
    _warnedMissingSiteUrl = true;
    console.warn(
      '[email] PIWI_SITE_URL is not set — links in outgoing emails will point at http://localhost:3000. ' +
        'Set PIWI_SITE_URL to the public URL of this dashboard.',
    );
  }
  const transport = getTransport();
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.from}>` : cfg.from;
  await transport.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
    ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
  });
  console.info('[email] Sent "%s" to %s', opts.subject, opts.to);
}

// ── Email templates ───────────────────────────────────────────────────────────

const siteUrl = () => process.env.PIWI_SITE_URL?.replace(/\/$/, '') || 'http://localhost:3000';

/** Passed and failed text colors: the dashboard's outcome colors, as in the HTML export. */
const PASSED_COLOR = STATUS_COLORS.passed.text;
const FAILED_COLOR = STATUS_COLORS.failed.text;

/** Escape user-controlled text (test titles, error messages) for HTML emails. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function emailLayout(title: string, body: string): { html: string; text: string } {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
        <tr><td style="background:#18181b;padding:20px 32px;">
          <span style="color:#fff;font-size:18px;font-weight:700;">Piwi Dashboard</span>
        </td></tr>
        <tr><td style="padding:32px;">${body}</td></tr>
        <tr><td style="padding:16px 32px;background:#f4f4f5;font-size:12px;color:#71717a;text-align:center;">
          This is an automated message from <a href="${siteUrl()}" style="color:#18181b;">${siteUrl()}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { html, text: title };
}

export function renderPasswordResetEmail(token: string): { html: string; text: string } {
  const url = `${siteUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#18181b;">Reset your password</h2>
    <p style="margin:0 0 24px;color:#52525b;">Click the button below to reset your password. This link expires in 1 hour.</p>
    <a href="${url}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Reset password</a>
    <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;">If you didn't request this, ignore this email — your account is safe.</p>
    <p style="margin:8px 0 0;font-size:12px;color:#a1a1aa;">Link: <a href="${url}" style="color:#18181b;">${url}</a></p>`;
  const { html } = emailLayout('Reset your password', body);
  const text = `Reset your password\n\nClick the link below to reset your password. This link expires in 1 hour.\n\n${url}\n\nIf you didn't request this, ignore this email.`;
  return { html, text };
}

export function renderInviteEmail(token: string, invitedBy?: string): { html: string; text: string } {
  const url = `${siteUrl()}/reset-password?token=${encodeURIComponent(token)}&mode=invite`;
  const byLine = invitedBy
    ? `<p style="margin:0 0 24px;color:#52525b;">You were invited by <strong>${invitedBy}</strong>. Click the button below to set your password and activate your account. This link expires in 72 hours.</p>`
    : `<p style="margin:0 0 24px;color:#52525b;">Click the button below to set your password and activate your account. This link expires in 72 hours.</p>`;
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#18181b;">You've been invited to Piwi Dashboard</h2>
    ${byLine}
    <a href="${url}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Set password &amp; activate</a>
    <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;">Link: <a href="${url}" style="color:#18181b;">${url}</a></p>`;
  const { html } = emailLayout("You've been invited to Piwi Dashboard", body);
  const text = `You've been invited to Piwi Dashboard\n\nClick the link below to set your password and activate your account. This link expires in 72 hours.\n\n${url}`;
  return { html, text };
}

export function renderVerifyEmail(token: string): { html: string; text: string } {
  const url = `${siteUrl()}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#18181b;">Verify your email</h2>
    <p style="margin:0 0 24px;color:#52525b;">Click the button below to verify your email address.</p>
    <a href="${url}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Verify email</a>
    <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;">Link: <a href="${url}" style="color:#18181b;">${url}</a></p>`;
  const { html } = emailLayout('Verify your email', body);
  const text = `Verify your email\n\nClick the link below to verify your email address.\n\n${url}`;
  return { html, text };
}

export function renderTestEmail(to: string): { html: string; text: string } {
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#18181b;">Test email</h2>
    <p style="margin:0 0 8px;color:#52525b;">This is a test email from Piwi Dashboard. If you received this, SMTP is configured correctly.</p>
    <p style="margin:0;color:#a1a1aa;font-size:12px;">Sent to: ${to}</p>`;
  const { html } = emailLayout('Test email — Piwi Dashboard', body);
  const text = `Test email from Piwi Dashboard. SMTP is configured correctly. Sent to: ${to}`;
  return { html, text };
}

/** Where a failing test links to: its execution, else its history, else the run. */
function failureUrl(failure: TopFailure, runUrl: string): string {
  const path = failureTargetPath(failure);
  return path ? `${siteUrl()}${path}` : runUrl;
}

export function renderRunNotificationEmail(opts: {
  projectName: string;
  runId: number;
  status: string;
  totalTests: number;
  failedTests: number;
  branch?: string;
  topFailures?: TopFailure[];
}): { html: string; text: string } {
  const url = `${siteUrl()}/test-runs/${opts.runId}`;
  const statusColor = opts.status === 'passed' ? PASSED_COLOR : FAILED_COLOR;

  const failures = opts.topFailures ?? [];
  let failuresHtml = '';
  let failuresText = '';
  if (failures.length > 0) {
    const rows = failures
      .map((f) => {
        const caseUrl = failureUrl(f, url);
        const title = escapeHtml(f.title);
        const titleHtml = `<a href="${caseUrl}" style="color:#18181b;font-weight:600;text-decoration:none;">${title}</a>`;
        const loc = f.filePath ? `<div style="color:#a1a1aa;font-size:12px;">${escapeHtml(f.filePath)}</div>` : '';
        const headline = f.headline
          ? `<div style="margin-top:4px;color:#18181b;font-size:14px;">${escapeHtml(f.headline)}</div>`
          : '';
        const excerpt = f.errorExcerpt
          ? `<pre style="margin:6px 0 0;white-space:pre-wrap;word-break:break-word;font-size:12px;color:#52525b;background:#fafafa;padding:8px;border-radius:4px;">${escapeHtml(f.errorExcerpt)}</pre>`
          : '';
        return `<li style="margin-bottom:12px;list-style:none;">${titleHtml}${loc}${headline}${excerpt}</li>`;
      })
      .join('');
    failuresHtml = `<ul style="margin:0 0 24px;padding:0;">${rows}</ul>`;
    failuresText = failures
      .map((f) => {
        const caseUrl = failureUrl(f, url);
        const loc = f.filePath ? ` (${f.filePath})` : '';
        const headline = f.headline ? `\n  ${f.headline}` : '';
        const excerpt = f.errorExcerpt ? `\n    ${f.errorExcerpt.replace(/\n/g, '\n    ')}` : '';
        return `- ${f.title}${loc}${headline}\n  ${caseUrl}${excerpt}`;
      })
      .join('\n');
  }

  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">Test run ${opts.status}</h2>
    <p style="margin:0 0 24px;color:#52525b;font-size:14px;">${escapeHtml(opts.projectName)}${opts.branch ? ` · ${escapeHtml(opts.branch)}` : ''}</p>
    <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="padding:8px 16px;background:#f4f4f5;border-radius:6px;font-size:14px;">
          Status: <strong style="color:${statusColor};">${opts.status}</strong>
          &nbsp;·&nbsp; ${opts.totalTests} tests
          ${opts.failedTests > 0 ? `&nbsp;·&nbsp; <strong style="color:${FAILED_COLOR};">${opts.failedTests} failed</strong>` : ''}
        </td>
      </tr>
    </table>
    ${failuresHtml}
    <a href="${url}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">View run</a>`;
  const { html } = emailLayout(`Test run ${opts.status} — ${opts.projectName}`, body);
  const text = `Test run ${opts.status}: ${opts.projectName}${opts.branch ? ` (${opts.branch})` : ''}\n${opts.totalTests} tests${opts.failedTests > 0 ? `, ${opts.failedTests} failed` : ''}${failuresText ? `\n\n${failuresText}` : ''}\n\nView run: ${url}`;
  return { html, text };
}

export function renderNewClusterEmail(opts: {
  projectName: string;
  clusterId: number;
  signature: string;
  /** Display name shown above the signature when it adds something. */
  title?: string | null;
  sampleErrorExcerpt?: string;
  affectedCases?: number;
  /** The tracker issue the cluster is known by, named when set. */
  knownIssue?: { key: string; url: string };
}): {
  html: string;
  text: string;
} {
  const url = `${siteUrl()}/failure-clusters/${opts.clusterId}`;
  const tracked = opts.knownIssue
    ? `<p style="margin:0 0 16px;color:#52525b;font-size:13px;">Tracked in <a href="${opts.knownIssue.url}" style="color:#18181b;font-weight:600;">${escapeHtml(opts.knownIssue.key)}</a></p>`
    : '';
  const affected =
    opts.affectedCases && opts.affectedCases > 0
      ? `<p style="margin:0 0 16px;color:#52525b;font-size:13px;">${opts.affectedCases} affected test${opts.affectedCases === 1 ? '' : 's'} in this run</p>`
      : '';
  const excerpt = opts.sampleErrorExcerpt
    ? `<pre style="margin:0 0 24px;white-space:pre-wrap;word-break:break-word;font-size:12px;color:#52525b;background:#fafafa;padding:12px;border-radius:6px;">${escapeHtml(opts.sampleErrorExcerpt)}</pre>`
    : '';
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">New failure cluster</h2>
    <p style="margin:0 0 24px;color:#52525b;font-size:14px;">${escapeHtml(opts.projectName)}</p>
    ${opts.title && opts.title !== opts.signature ? `<p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#18181b;">${escapeHtml(opts.title)}</p>` : ''}
    <p style="margin:0 0 16px;font-family:monospace;font-size:13px;background:#f4f4f5;padding:12px;border-radius:6px;overflow:auto;">${escapeHtml(opts.signature)}</p>
    ${affected}
    ${excerpt}
    ${tracked}
    <a href="${url}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">View cluster</a>`;
  const { html } = emailLayout(`New failure cluster — ${opts.projectName}`, body);
  const text = `New failure cluster in ${opts.projectName}${opts.affectedCases ? ` (${opts.affectedCases} affected)` : ''}\n\n${opts.title && opts.title !== opts.signature ? `${opts.title}\n` : ''}${opts.signature}${opts.sampleErrorExcerpt ? `\n\n${opts.sampleErrorExcerpt}` : ''}${opts.knownIssue ? `\n\nTracked in ${opts.knownIssue.key}: ${opts.knownIssue.url}` : ''}\n\nView: ${url}`;
  return { html, text };
}

/** One event queued for a digest send. */
export interface DigestItem {
  event: NotificationEvent;
  payload: NotificationPayload;
}

/**
 * One email summarizing every notification a digest-mode subscription batched
 * since the previous send: subject line + link per item, with run stats where
 * the payload carries them.
 */
export function renderDigestEmail(items: DigestItem[]): { subject: string; html: string; text: string } {
  const subject = `Piwi digest — ${items.length} notification${items.length === 1 ? '' : 's'}`;

  const rows = items
    .map(({ event, payload }) => {
      const line = renderEventSubject(event, payload);
      const path = notificationTargetPath(event, payload);
      const url = path ? `${siteUrl()}${path}` : null;
      const run = payload as RunFinishedPayload;
      const stats =
        event.startsWith('run.') && run.totalTests != null
          ? `<div style="color:#71717a;font-size:12px;">${run.totalTests} tests${run.failedTests ? ` · <span style="color:${FAILED_COLOR};">${run.failedTests} failed</span>` : ''}</div>`
          : '';
      const title = url
        ? `<a href="${url}" style="color:#18181b;font-weight:600;text-decoration:none;">${escapeHtml(line)}</a>`
        : `<span style="font-weight:600;">${escapeHtml(line)}</span>`;
      return `<li style="margin-bottom:12px;list-style:none;">${title}${stats}</li>`;
    })
    .join('');

  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#18181b;">Your notification digest</h2>
    <ul style="margin:0;padding:0;">${rows}</ul>`;
  const { html } = emailLayout(subject, body);

  const text = items
    .map(({ event, payload }) => {
      const path = notificationTargetPath(event, payload);
      return `- ${renderEventSubject(event, payload)}${path ? `\n  ${siteUrl()}${path}` : ''}`;
    })
    .join('\n');
  return { subject, html, text: `${subject}\n\n${text}` };
}

// ── Quality report ────────────────────────────────────────────────────────────

type SeriesBlock = Extract<ReportBlock, { kind: 'series' }>;

/** The trend a quality report email draws: the first series of the report, the pass rate over time on the built-ins. */
export function emailTrendBlock(bundle: ReportBundle): SeriesBlock | null {
  for (const widget of reportWidgets(bundle)) {
    for (const block of widget.blocks) if (block.kind === 'series') return block;
  }
  return null;
}

const TONE_COLORS: Record<ReportTone, string> = {
  good: PASSED_COLOR,
  bad: FAILED_COLOR,
  neutral: '#71717a',
};

/**
 * A quality report as an email: the verdict, the headline numbers, the trend
 * as an inline PNG (`cid:trend`, attached by the caller) with its labels as
 * HTML text, what changed, and a link to the snapshot. Tables and inline
 * styles only, so the body stays well under the clipping size of common
 * mail clients.
 */
export function renderQualityReportEmail(
  bundle: ReportBundle,
  opts: { url: string; chartCid: string | null },
): { subject: string; html: string; text: string } {
  const s = sentencesFor(bundle.language);
  const subject = `${s.labels.qualityReport}: ${bundle.title}`;
  const widgets = reportWidgets(bundle);
  const tiles = widgets.flatMap((w) => w.blocks).find((b) => b.kind === 'stats');
  const trend = emailTrendBlock(bundle);
  const changes = widgets.find((w) => w.type === 'insights')?.blocks.find((b) => b.kind === 'list');
  const p = (text: string, style = '') =>
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#18181b;${style}">${text}</p>`;
  const meta = (text: string) => `<span style="font-size:12px;color:#71717a;">${text}</span>`;

  const parts: string[] = [
    `<h2 style="margin:0 0 4px;font-size:20px;color:#18181b;">${escapeHtml(bundle.title)}</h2>`,
    p(meta(escapeHtml(bundle.period.label))),
    p(escapeHtml(bundle.verdict.sentence)),
  ];
  const textParts: string[] = [bundle.title, bundle.period.label, '', bundle.verdict.sentence, ''];

  if (tiles && tiles.kind === 'stats') {
    const cells = tiles.tiles.map((t) => {
      const change = t.change
        ? ` <span style="font-size:12px;color:${TONE_COLORS[t.tone]};">${escapeHtml(t.change)}</span>`
        : '';
      const note = t.note ? `<br>${meta(escapeHtml(t.note))}` : '';
      return `<td width="50%" valign="top" style="padding:8px 8px 8px 0;">${meta(escapeHtml(t.label))}<br><span style="font-size:18px;font-weight:700;color:#18181b;">${escapeHtml(t.value)}</span>${change}${note}</td>`;
    });
    const rows: string[] = [];
    for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cells[i]}${cells[i + 1] ?? '<td></td>'}</tr>`);
    parts.push(`<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">${rows.join('')}</table>`);
    for (const t of tiles.tiles) textParts.push(`${t.label}: ${t.value}${t.change ? ` (${t.change})` : ''}`);
    textParts.push('');
  }

  if (trend && opts.chartCid) {
    const dates = trend.series[0]?.points.map((pt) => pt.date) ?? [];
    const legend = trend.series
      .map(
        (series) =>
          `<span style="display:inline-block;margin-right:12px;font-size:12px;color:#71717a;"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${seriesColor(series.color, series.faint)};margin-right:4px;"></span>${escapeHtml(series.label)}</span>`,
      )
      .join('');
    parts.push(
      `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;"><tr><td><img src="cid:${opts.chartCid}" width="496" height="140" alt="${escapeHtml(trend.summary ?? '')}" style="display:block;width:100%;max-width:496px;height:auto;border:0;"></td></tr>`,
      `<tr><td style="padding-top:4px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="left">${meta(escapeHtml(dates[0] ?? ''))}</td><td align="right">${meta(escapeHtml(dates[dates.length - 1] ?? ''))}</td></tr></table></td></tr></table>`,
      p(`${legend}`, 'margin-bottom:4px;'),
    );
    if (trend.summary) parts.push(p(meta(escapeHtml(trend.summary))));
    if (trend.markers.length > 0) {
      parts.push(p(meta(trend.markers.map((m) => `${escapeHtml(m.date)}: ${escapeHtml(m.label)}`).join(' · '))));
    }
    if (trend.summary) textParts.push(trend.summary, '');
  }

  if (changes && changes.kind === 'list' && changes.items.length > 0) {
    const items = changes.items
      .slice(0, 6)
      .map(
        (item) =>
          `<li style="margin:0 0 6px;font-size:14px;line-height:1.5;color:#18181b;">${escapeHtml(item.text)}</li>`,
      )
      .join('');
    parts.push(
      `<h3 style="margin:16px 0 8px;font-size:15px;color:#18181b;">${escapeHtml(s.title('What changed'))}</h3><ul style="margin:0 0 16px;padding-left:18px;">${items}</ul>`,
    );
    for (const item of changes.items.slice(0, 6)) textParts.push(`- ${item.text}`);
    textParts.push('');
  }

  parts.push(
    `<p style="margin:16px 0;"><a href="${escapeHtml(opts.url)}" style="display:inline-block;background:#18181b;color:#ffffff;padding:10px 16px;border-radius:6px;font-size:14px;text-decoration:none;">${escapeHtml(s.labels.openInPiwi)}</a></p>`,
    p(
      meta(
        [bundle.scopeText.projects, bundle.scopeText.branches, bundle.scopeText.runs, bundle.scopeText.tests]
          .filter(Boolean)
          .map((v) => escapeHtml(v!))
          .join(' · '),
      ),
    ),
  );
  textParts.push(`${s.labels.openInPiwi}: ${opts.url}`);

  const { html } = emailLayout(escapeHtml(subject), parts.join('\n'));
  return { subject, html, text: textParts.join('\n') };
}
