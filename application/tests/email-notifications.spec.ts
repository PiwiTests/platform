/**
 * Email & Notification integration tests.
 *
 * Prerequisites (set env vars to opt in):
 *   PIWI_MAILPIT_URL   - Mailpit base URL, e.g. http://localhost:8025
 *                        SMTP must be on port PIWI_MAILPIT_SMTP_PORT (default 1025)
 *   PIWI_EMAIL_SERVER_URL - URL of an auth-enabled Piwi server already configured
 *                           to send email via Mailpit. Defaults to http://localhost:3098.
 *
 * The playwright.config.ts webServer section starts a dedicated auth+email server
 * on port 3098 when PIWI_MAILPIT_URL is set.
 *
 * Run a quick local check:
 *   docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit
 *   PIWI_MAILPIT_URL=http://localhost:8025 npx playwright test email-notifications
 */

import { test, expect } from './fixtures';
import { MailpitClient } from './utils/mailpit';

// All tests in this file share one Mailpit inbox — must run serially.
test.describe.configure({ mode: 'serial' });

const MAILPIT_URL = process.env.PIWI_MAILPIT_URL ?? '';
const EMAIL_SERVER = process.env.PIWI_EMAIL_SERVER_URL ?? 'http://localhost:3098';
const ADMIN_CREDS = { username: 'admin', password: 'adminpassword123' };

function skip() {
  test.skip(!MAILPIT_URL, 'Set PIWI_MAILPIT_URL to run email tests (needs mailpit + dedicated auth server)');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function apiPost(path: string, body: unknown, cookie?: string) {
  return fetch(`${EMAIL_SERVER}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function adminLogin(): Promise<string> {
  const res = await apiPost('/api/auth/login', ADMIN_CREDS);
  const header = res.headers.get('set-cookie') ?? '';
  return header.split(';')[0] ?? '';
}

/** One-time admin bootstrap: call setup if no users exist yet. */
async function ensureAdmin(): Promise<void> {
  const me = await fetch(`${EMAIL_SERVER}/api/auth/me`);
  const meData = (await me.json()) as { authenticated: boolean };
  if (!meData.authenticated) {
    // Try to create admin (no-op if users already exist)
    await apiPost('/api/auth/setup', {
      username: ADMIN_CREDS.username,
      password: ADMIN_CREDS.password,
      name: 'Administrator',
    });
  }
}

// Ensure admin exists for all test suites
test.beforeAll(async () => {
  if (!MAILPIT_URL) return;
  await ensureAdmin();
});

// ── SMTP test endpoint ───────────────────────────────────────────────────────

test.describe.serial('SMTP test send', () => {
  skip();

  let mailpit: MailpitClient;

  test.beforeEach(async () => {
    mailpit = new MailpitClient(MAILPIT_URL);
    await mailpit.deleteAll();
  });

  test('admin can send a test email', async () => {
    const cookie = await adminLogin();
    const res = await apiPost('/api/settings/smtp/test', { to: 'testrecipient@example.com' }, cookie);
    expect(res.ok).toBe(true);
    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(true);

    const msg = await mailpit.waitForMessage((m) => m.To.some((t) => t.Address === 'testrecipient@example.com'));
    expect(msg.Subject).toContain('Test');
    expect(msg.From.Address).toBeTruthy();
  });

  test('non-admin cannot access smtp test endpoint', async () => {
    const res = await apiPost('/api/settings/smtp/test', { to: 'x@example.com' });
    expect(res.status).toBe(401);
  });
});

// ── Forgot / reset password ──────────────────────────────────────────────────

test.describe.serial('Forgot & reset password', () => {
  skip();

  let mailpit: MailpitClient;
  const RESET_EMAIL = 'resetuser@example.com';
  let userId: number;

  test.beforeAll(async () => {
    mailpit = new MailpitClient(MAILPIT_URL);
    const cookie = await adminLogin();

    // Create a user with email via admin
    const res = await apiPost(
      '/api/users',
      {
        username: 'resettest',
        password: 'OldPassword1!',
        role: 'user',
        email: RESET_EMAIL,
      },
      cookie,
    );
    const data = (await res.json()) as { user?: { id: number } };
    userId = data.user?.id ?? 0;
  });

  test.afterAll(async () => {
    if (!userId) return;
    const cookie = await adminLogin();
    await fetch(`${EMAIL_SERVER}/api/users/${userId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
  });

  test.beforeEach(async () => {
    await mailpit.deleteAll();
  });

  test('forgot-password does not reveal whether account exists', async () => {
    const [r1, r2] = await Promise.all([
      apiPost('/api/auth/forgot-password', { email: RESET_EMAIL }),
      apiPost('/api/auth/forgot-password', { email: 'nobody@example.com' }),
    ]);
    // Both return 200 success regardless
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    const [d1, d2] = (await Promise.all([r1.json(), r2.json()])) as [{ success: boolean }, { success: boolean }];
    expect(d1.success).toBe(true);
    expect(d2.success).toBe(true);
  });

  test('reset token is delivered by email and can be used once', async () => {
    await apiPost('/api/auth/forgot-password', { email: RESET_EMAIL });

    const msg = await mailpit.waitForMessage((m) => m.To.some((t) => t.Address === RESET_EMAIL));
    const detail = await mailpit.getMessage(msg.ID);

    // Extract reset link from email
    const linkMatch = (detail.HTML || detail.Text).match(/http[^\s"<>]+reset-password[^\s"<>]+/);
    expect(linkMatch).not.toBeNull();
    const url = new URL(linkMatch![0]!);
    const token = url.searchParams.get('token');
    expect(token).toBeTruthy();

    // Use the token to reset password
    const resetRes = await apiPost('/api/auth/reset-password', {
      token,
      password: 'NewPassword1!',
    });
    expect(resetRes.ok).toBe(true);

    // Token should be single-use: second attempt must fail
    const secondRes = await apiPost('/api/auth/reset-password', {
      token,
      password: 'AnotherPassword1!',
    });
    expect(secondRes.ok).toBe(false);
    expect(secondRes.status).toBe(400);
  });

  test('can log in with new password after reset', async () => {
    await apiPost('/api/auth/forgot-password', { email: RESET_EMAIL });
    const msg = await mailpit.waitForMessage((m) => m.To.some((t) => t.Address === RESET_EMAIL));
    const detail = await mailpit.getMessage(msg.ID);
    const linkMatch = (detail.HTML || detail.Text).match(/http[^\s"<>]+reset-password[^\s"<>]+/);
    const url = new URL(linkMatch![0]!);
    const token = url.searchParams.get('token')!;

    await apiPost('/api/auth/reset-password', { token, password: 'FinalPassword1!' });

    const loginRes = await apiPost('/api/auth/login', {
      username: 'resettest',
      password: 'FinalPassword1!',
    });
    expect(loginRes.ok).toBe(true);
  });
});

// ── Change password ──────────────────────────────────────────────────────────

test.describe.serial('Change password', () => {
  skip();

  const USERNAME = 'changepwtest';
  const INITIAL_PW = 'InitialPw1!';
  let userId: number;
  let cookie: string;

  test.beforeAll(async () => {
    const adminCookie = await adminLogin();
    const res = await apiPost(
      '/api/users',
      {
        username: USERNAME,
        password: INITIAL_PW,
        role: 'user',
      },
      adminCookie,
    );
    const data = (await res.json()) as { user?: { id: number } };
    userId = data.user?.id ?? 0;

    const loginRes = await apiPost('/api/auth/login', { username: USERNAME, password: INITIAL_PW });
    cookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? '';
  });

  test.afterAll(async () => {
    if (!userId) return;
    const adminCookie = await adminLogin();
    await fetch(`${EMAIL_SERVER}/api/users/${userId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    });
  });

  test('change password succeeds with correct current password', async () => {
    const res = await apiPost(
      '/api/auth/change-password',
      {
        currentPassword: INITIAL_PW,
        newPassword: 'Changed1!',
      },
      cookie,
    );
    expect(res.ok).toBe(true);

    // Verify old password no longer works
    const oldLoginRes = await apiPost('/api/auth/login', { username: USERNAME, password: INITIAL_PW });
    expect(oldLoginRes.ok).toBe(false);
  });

  test('change password fails with wrong current password', async () => {
    const loginRes = await apiPost('/api/auth/login', { username: USERNAME, password: 'Changed1!' });
    const freshCookie = loginRes.headers.get('set-cookie')?.split(';')[0] ?? '';

    const res = await apiPost(
      '/api/auth/change-password',
      {
        currentPassword: 'WrongPassword!',
        newPassword: 'NewPw1!',
      },
      freshCookie,
    );
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });
});

// ── Invite flow ──────────────────────────────────────────────────────────────

test.describe.serial('User invite email', () => {
  skip();

  let mailpit: MailpitClient;
  const INVITE_EMAIL = 'invitee@example.com';
  let userId: number;

  test.beforeAll(async () => {
    mailpit = new MailpitClient(MAILPIT_URL);
    const cookie = await adminLogin();
    const res = await apiPost(
      '/api/users',
      {
        username: 'invitetest',
        password: 'TempPassword1!',
        role: 'user',
        email: INVITE_EMAIL,
      },
      cookie,
    );
    const data = (await res.json()) as { user?: { id: number } };
    userId = data.user?.id ?? 0;
  });

  test.afterAll(async () => {
    if (!userId) return;
    const cookie = await adminLogin();
    await fetch(`${EMAIL_SERVER}/api/users/${userId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
  });

  test.beforeEach(async () => {
    await mailpit.deleteAll();
  });

  test('admin can send invite and invite link sets password', async () => {
    const cookie = await adminLogin();
    const inviteRes = await apiPost(`/api/users/${userId}/invite`, {}, cookie);
    expect(inviteRes.ok).toBe(true);

    const msg = await mailpit.waitForMessage((m) => m.To.some((t) => t.Address === INVITE_EMAIL));
    const detail = await mailpit.getMessage(msg.ID);
    const linkMatch = (detail.HTML || detail.Text).match(/http[^\s"<>]+reset-password[^\s"<>]+/);
    expect(linkMatch).not.toBeNull();

    const url = new URL(linkMatch![0]!);
    const token = url.searchParams.get('token');
    expect(token).toBeTruthy();

    // Invite token accepted by reset-password endpoint
    const resetRes = await apiPost('/api/auth/reset-password', {
      token,
      password: 'InviteePassword1!',
    });
    expect(resetRes.ok).toBe(true);
  });
});

// ── Notification dispatch ────────────────────────────────────────────────────

test.describe.serial('Notification dispatch', () => {
  skip();

  let mailpit: MailpitClient;
  const NOTIFY_EMAIL = 'notifyuser@example.com';
  let cookie: string;
  let userId: number;
  let channelId: number;
  let subscriptionId: number;
  let projectId: number;

  test.beforeAll(async () => {
    mailpit = new MailpitClient(MAILPIT_URL);
    cookie = await adminLogin();

    // Create a user with email
    const userRes = await apiPost(
      '/api/users',
      {
        username: 'notifytest',
        password: 'NotifyPw1!',
        role: 'user',
        email: NOTIFY_EMAIL,
      },
      cookie,
    );
    const userData = (await userRes.json()) as { id?: number; userId?: number };
    userId = userData.id ?? userData.userId ?? 0;

    // Create a project by submitting a run
    const runRes = await apiPost(
      '/api/test-runs/submit',
      {
        projectName: 'NotifyTestProject',
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [],
      },
      cookie,
    );
    const runData = (await runRes.json()) as { projectId?: number };
    projectId = runData.projectId ?? 0;

    // Create an email channel
    const chRes = await apiPost(
      '/api/channels',
      {
        name: 'Test Email',
        type: 'email',
        config: { address: NOTIFY_EMAIL },
      },
      cookie,
    );
    const chData = (await chRes.json()) as { channel?: { id: number } };
    channelId = chData.channel?.id ?? 0;

    // Subscribe to run.finished for that project
    const subRes = await apiPost(
      '/api/subscriptions',
      {
        channelId,
        projectId,
        events: ['run.finished'],
        mode: 'realtime',
      },
      cookie,
    );
    const subData = (await subRes.json()) as { subscriptionId?: number };
    subscriptionId = subData.subscriptionId ?? 0;
  });

  test.afterAll(async () => {
    if (subscriptionId)
      await fetch(`${EMAIL_SERVER}/api/subscriptions/${subscriptionId}`, {
        method: 'DELETE',
        headers: { Cookie: cookie },
      });
    if (channelId)
      await fetch(`${EMAIL_SERVER}/api/channels/${channelId}`, { method: 'DELETE', headers: { Cookie: cookie } });
    if (userId) await fetch(`${EMAIL_SERVER}/api/users/${userId}`, { method: 'DELETE', headers: { Cookie: cookie } });
  });

  test.beforeEach(async () => {
    await mailpit.deleteAll();
  });

  test('run.finished event delivers email to subscriber', async () => {
    // Submit a failing run to trigger run.finished + run.failed
    const runRes = await apiPost(
      '/api/test-runs/submit',
      {
        projectName: 'NotifyTestProject',
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 2000,
        totalTests: 3,
        passedTests: 1,
        failedTests: 2,
        skippedTests: 0,
        testCases: [
          { title: 'Test 1', status: 'passed', duration: 500, suiteName: 'Suite' },
          { title: 'Test 2', status: 'failed', duration: 800, suiteName: 'Suite', error: 'Expected x got y' },
          { title: 'Test 3', status: 'failed', duration: 700, suiteName: 'Suite', error: 'Timeout' },
        ],
      },
      cookie,
    );
    expect(runRes.ok).toBe(true);

    // Wait for email to arrive (dispatcher sweeps every minute but test server has 1-minute cron;
    // the outbox is also kicked synchronously after run finalization)
    const msg = await mailpit.waitForMessage((m) => m.To.some((t) => t.Address === NOTIFY_EMAIL), {
      timeoutMs: 15_000,
    });
    expect(msg.Subject.toLowerCase()).toMatch(/run|test|notify/i);
  });

  test('deduplication: same run does not produce duplicate deliveries', async () => {
    const runPayload = {
      projectName: 'NotifyTestProject',
      status: 'passed',
      startTime: new Date().toISOString(),
      duration: 1000,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      skippedTests: 0,
      testCases: [{ title: 'Dedup Test', status: 'passed', duration: 500, suiteName: 'Suite' }],
    };
    await apiPost('/api/test-runs/submit', runPayload, cookie);

    // Wait briefly for first delivery
    await mailpit.waitForMessage((m) => m.To.some((t) => t.Address === NOTIFY_EMAIL), { timeoutMs: 15_000 });

    // Trigger the outbox sweeper again by calling the task endpoint
    await fetch(`${EMAIL_SERVER}/api/_nitro/tasks/notifications:sweep`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });

    // Allow a moment for a potential second delivery
    await new Promise((r) => setTimeout(r, 2000));
    const msgs = await mailpit.listMessages();
    const deliveries = msgs.filter((m) => m.To.some((t) => t.Address === NOTIFY_EMAIL));
    expect(deliveries.length).toBe(1);
  });

  test('muted subscription does not deliver', async () => {
    // Mute the subscription
    await fetch(`${EMAIL_SERVER}/api/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ mutedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString() }),
    });

    const runRes = await apiPost(
      '/api/test-runs/submit',
      {
        projectName: 'NotifyTestProject',
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [],
      },
      cookie,
    );
    expect(runRes.ok).toBe(true);

    // Give dispatcher time to run
    await new Promise((r) => setTimeout(r, 3000));
    const msgs = await mailpit.listMessages();
    expect(msgs.filter((m) => m.To.some((t) => t.Address === NOTIFY_EMAIL)).length).toBe(0);

    // Unmute for subsequent tests
    await fetch(`${EMAIL_SERVER}/api/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ mutedUntil: null }),
    });
  });
});
