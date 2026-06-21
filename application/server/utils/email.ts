import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

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

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

let _transport: Transporter | null = null;

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
  const configured = Boolean(host && user && pass && from);

  return { host, port, user, from, fromName, hasPassword: Boolean(pass), secure, configured, envManaged: true };
}

export function isEmailConfigured(): boolean {
  return getSmtpConfig().configured;
}

function getTransport(): Transporter {
  if (_transport) return _transport;
  const cfg = getSmtpConfig();
  _transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: process.env.PIWI_SMTP_PASS || '' },
  });
  return _transport;
}

export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const cfg = getSmtpConfig();
  if (!cfg.configured) {
    console.warn('[email] SMTP not configured — skipping send to', opts.to);
    return;
  }
  const transport = getTransport();
  const from = cfg.fromName ? `"${cfg.fromName}" <${cfg.from}>` : cfg.from;
  await transport.sendMail({ from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text });
  console.info('[email] Sent "%s" to %s', opts.subject, opts.to);
}

// ── Email templates ───────────────────────────────────────────────────────────

const siteUrl = () => process.env.PIWI_SITE_URL?.replace(/\/$/, '') || 'http://localhost:3000';

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

export function renderRunNotificationEmail(opts: {
  projectName: string;
  runId: number;
  status: string;
  totalTests: number;
  failedTests: number;
  branch?: string;
}): { html: string; text: string } {
  const url = `${siteUrl()}/test-runs/${opts.runId}`;
  const statusColor = opts.status === 'passed' ? '#22c55e' : '#ef4444';
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">Test run ${opts.status}</h2>
    <p style="margin:0 0 24px;color:#52525b;font-size:14px;">${opts.projectName}${opts.branch ? ` · ${opts.branch}` : ''}</p>
    <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="padding:8px 16px;background:#f4f4f5;border-radius:6px;font-size:14px;">
          Status: <strong style="color:${statusColor};">${opts.status}</strong>
          &nbsp;·&nbsp; ${opts.totalTests} tests
          ${opts.failedTests > 0 ? `&nbsp;·&nbsp; <strong style="color:#ef4444;">${opts.failedTests} failed</strong>` : ''}
        </td>
      </tr>
    </table>
    <a href="${url}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">View run</a>`;
  const { html } = emailLayout(`Test run ${opts.status} — ${opts.projectName}`, body);
  const text = `Test run ${opts.status}: ${opts.projectName}${opts.branch ? ` (${opts.branch})` : ''}\n${opts.totalTests} tests${opts.failedTests > 0 ? `, ${opts.failedTests} failed` : ''}\n\nView run: ${url}`;
  return { html, text };
}

export function renderNewClusterEmail(opts: { projectName: string; clusterId: number; signature: string }): {
  html: string;
  text: string;
} {
  const url = `${siteUrl()}/failure-clusters/${opts.clusterId}`;
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">New failure cluster</h2>
    <p style="margin:0 0 24px;color:#52525b;font-size:14px;">${opts.projectName}</p>
    <p style="margin:0 0 24px;font-family:monospace;font-size:13px;background:#f4f4f5;padding:12px;border-radius:6px;overflow:auto;">${opts.signature}</p>
    <a href="${url}" style="display:inline-block;background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">View cluster</a>`;
  const { html } = emailLayout(`New failure cluster — ${opts.projectName}`, body);
  const text = `New failure cluster in ${opts.projectName}\n\n${opts.signature}\n\nView: ${url}`;
  return { html, text };
}
