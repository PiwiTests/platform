/**
 * The frame every Piwi email shares: the dark header, the white card and the
 * footer naming the instance. Pure, so the schedule form can show a quality
 * report email exactly as the server sends it.
 */

/** Escape user-controlled text (test titles, error messages) for HTML emails. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The footer line before the instance's address, in the email's language. */
const AUTOMATED_MESSAGE = {
  en: 'This is an automated message from',
  fr: 'Message automatique envoyé par',
} as const;

/**
 * An email document: `title` (already escaped) in its head, `body` in the
 * card, `siteUrl` in the footer. A quality report email is written in its
 * report's language; the other emails in English.
 */
export function emailLayout(
  title: string,
  body: string,
  siteUrl: string,
  language: keyof typeof AUTOMATED_MESSAGE = 'en',
): string {
  const site = escapeHtml(siteUrl);
  return `<!DOCTYPE html>
<html lang="${language}">
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
          ${AUTOMATED_MESSAGE[language]} <a href="${site}" style="color:#18181b;">${site}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
