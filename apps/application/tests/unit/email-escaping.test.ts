import { describe, test, expect } from 'vitest';
import { renderInviteEmail, renderTestEmail, renderRunNotificationEmail } from '../../server/utils/email';

const PAYLOAD = '<a href="https://evil.example/reset">Reset password</a>';

describe('email templates escape the values they interpolate', () => {
  test('the test email escapes its recipient', () => {
    const { html } = renderTestEmail(`x<victim@corp.example>${PAYLOAD}`);
    expect(html).not.toContain(PAYLOAD);
    expect(html).toContain('&lt;a href=&quot;https://evil.example/reset&quot;&gt;');
  });

  test('the invite email escapes who sent it', () => {
    expect(renderInviteEmail('token', PAYLOAD).html).not.toContain(PAYLOAD);
  });

  test('the run email escapes the reported status', () => {
    const { html } = renderRunNotificationEmail({
      projectName: 'Alpha',
      runId: 1,
      status: PAYLOAD,
      totalTests: 1,
      failedTests: 0,
    });
    expect(html).not.toContain(PAYLOAD);
  });
});
