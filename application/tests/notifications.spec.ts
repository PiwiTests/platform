/**
 * Notifications API & UI integration tests.
 *
 * Covers channels CRUD, subscriptions CRUD (mute / unmute / filter), and the
 * Subscribe Bell UI component on the project detail page.
 *
 * Requires a dedicated auth-enabled server on port 3097, which is only started in CI.
 * All tests are skipped when CI is not set.
 *
 * To run locally: CI=1 npx playwright test notifications
 */

import { test, expect } from './fixtures';

// All tests share a single auth-enabled server — must run serially.
test.describe.configure({ mode: 'serial' });

const BASE = 'http://localhost:3097';
const ADMIN = { username: 'admin', password: 'adminpassword123' };

function skip() {
  test.skip(!process.env.CI, 'Notifications server tests only run in CI (see playwright.config.ts webServer)');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function api(method: string, path: string, body?: unknown, cookie?: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function loginAs(username: string, password: string): Promise<string> {
  const res = await api('POST', '/api/auth/login', { username, password });
  const header = res.headers.get('set-cookie') ?? '';
  return header.split(';')[0] ?? '';
}

// ── Shared state ───────────────────────────────────────────────────────────────

let adminCookie = '';
let userCookie = '';
let projectId = 0;
let channelId = 0;
let webhookChannelId = 0;
let subscriptionId = 0;

// ── Setup ──────────────────────────────────────────────────────────────────────

test.describe.serial('Setup', () => {
  test('bootstrap admin and clean state', async () => {
    skip();
    // Create admin (200 first run, 400 if already exists — both are acceptable)
    await api('POST', '/api/auth/setup', { ...ADMIN, name: 'Admin' });
    adminCookie = await loginAs(ADMIN.username, ADMIN.password);
    expect(adminCookie).toBeTruthy();

    // Delete any channels left from a previous run (cascades to subscriptions)
    const listRes = await api('GET', '/api/channels', undefined, adminCookie);
    const { channels } = (await listRes.json()) as { channels: Array<{ id: number }> };
    for (const ch of channels) {
      await api('DELETE', `/api/channels/${ch.id}`, undefined, adminCookie);
    }
  });

  test('create a test project', async () => {
    skip();
    const res = await api(
      'POST',
      '/api/test-runs/submit',
      {
        projectName: 'notif-test-project',
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 2,
        passedTests: 2,
        failedTests: 0,
        skippedTests: 0,
        testCases: [],
      },
      adminCookie,
    );
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { projectId: number };
    projectId = data.projectId;
    expect(projectId).toBeGreaterThan(0);
  });

  test('create a regular user for ownership tests', async () => {
    skip();
    const res = await api(
      'POST',
      '/api/users',
      {
        username: 'notif-user',
        password: 'userpassword123',
        role: 'user',
      },
      adminCookie,
    );
    // 200 on first run, 400/409 if already exists
    expect([200, 400, 409]).toContain(res.status);
    userCookie = await loginAs('notif-user', 'userpassword123');
    expect(userCookie).toBeTruthy();
  });
});

// ── Channels API ───────────────────────────────────────────────────────────────

test.describe.serial('Channels API', () => {
  test('GET /api/channels returns 401 without a session', async () => {
    skip();
    const res = await api('GET', '/api/channels');
    expect(res.status).toBe(401);
  });

  test('GET /api/channels returns empty list for fresh admin', async () => {
    skip();
    const res = await api('GET', '/api/channels', undefined, adminCookie);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { channels: unknown[] };
    expect(data.channels).toHaveLength(0);
  });

  test('POST /api/channels creates an email channel', async () => {
    skip();
    const res = await api(
      'POST',
      '/api/channels',
      {
        name: 'Test email channel',
        type: 'email',
        config: { address: 'notify@example.com' },
      },
      adminCookie,
    );
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { success: boolean; channel: { id: number; name: string; type: string } };
    expect(data.success).toBe(true);
    expect(data.channel.type).toBe('email');
    channelId = data.channel.id;
    expect(channelId).toBeGreaterThan(0);
  });

  test('GET /api/channels lists created channel with full config', async () => {
    skip();
    const res = await api('GET', '/api/channels', undefined, adminCookie);
    const data = (await res.json()) as {
      channels: Array<{ id: number; name: string; type: string; config: Record<string, unknown> }>;
    };
    const ch = data.channels.find((c) => c.id === channelId);
    expect(ch).toBeDefined();
    expect(ch?.name).toBe('Test email channel');
    expect(ch?.config.address).toBe('notify@example.com');
  });

  test('POST /api/channels creates a webhook channel; secret is not returned to clients', async () => {
    skip();
    const res = await api(
      'POST',
      '/api/channels',
      {
        name: 'Test webhook',
        type: 'webhook',
        config: { url: 'https://example.com/hook', secret: 'my-webhook-secret' },
      },
      adminCookie,
    );
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { success: boolean; channel: { id: number } };
    webhookChannelId = data.channel.id;

    const listRes = await api('GET', '/api/channels', undefined, adminCookie);
    const listData = (await listRes.json()) as { channels: Array<{ id: number; config: Record<string, unknown> }> };
    const wh = listData.channels.find((c) => c.id === webhookChannelId);
    expect(wh?.config.url).toBe('https://example.com/hook');
    expect(wh?.config.secret).toBeUndefined();
  });

  test('POST /api/channels/[id]/test returns SMTP-not-configured for email channel', async () => {
    skip();
    const res = await api('POST', `/api/channels/${channelId}/test`, undefined, adminCookie);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { success: boolean; error?: string };
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/SMTP/i);
  });

  test("non-owner cannot delete another user's channel", async () => {
    skip();
    const res = await api('DELETE', `/api/channels/${channelId}`, undefined, userCookie);
    expect(res.status).toBe(403);
  });

  test('POST /api/channels rejects invalid type', async () => {
    skip();
    const res = await api(
      'POST',
      '/api/channels',
      {
        name: 'Bad channel',
        type: 'carrier-pigeon',
        config: {},
      },
      adminCookie,
    );
    expect(res.status).toBe(400);
  });

  test('DELETE /api/channels/[id] removes the webhook channel', async () => {
    skip();
    const res = await api('DELETE', `/api/channels/${webhookChannelId}`, undefined, adminCookie);
    expect(res.ok).toBe(true);
    const listRes = await api('GET', '/api/channels', undefined, adminCookie);
    const data = (await listRes.json()) as { channels: Array<{ id: number }> };
    expect(data.channels.find((c) => c.id === webhookChannelId)).toBeUndefined();
  });
});

// ── Subscriptions API ──────────────────────────────────────────────────────────

test.describe.serial('Subscriptions API', () => {
  test('POST /api/subscriptions creates a subscription', async () => {
    skip();
    const res = await api(
      'POST',
      '/api/subscriptions',
      {
        channelId,
        projectId,
        events: ['run.failed', 'run.finished'],
        mode: 'realtime',
      },
      adminCookie,
    );
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { success: boolean; subscriptionId: number };
    expect(data.success).toBe(true);
    subscriptionId = data.subscriptionId;
    expect(subscriptionId).toBeGreaterThan(0);
  });

  test('POST /api/subscriptions rejects empty events array', async () => {
    skip();
    const res = await api(
      'POST',
      '/api/subscriptions',
      {
        channelId,
        projectId,
        events: [],
      },
      adminCookie,
    );
    expect(res.status).toBe(400);
  });

  test('GET /api/subscriptions lists the subscription with channel info', async () => {
    skip();
    const res = await api('GET', '/api/subscriptions', undefined, adminCookie);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as {
      subscriptions: Array<{ id: number; events: string[]; channel: { id: number; type: string } }>;
    };
    const sub = data.subscriptions.find((s) => s.id === subscriptionId);
    expect(sub).toBeDefined();
    expect(sub?.events).toContain('run.failed');
    expect(sub?.events).toContain('run.finished');
    expect(sub?.channel.id).toBe(channelId);
    expect(sub?.channel.type).toBe('email');
  });

  test('GET /api/subscriptions?projectId= filters correctly', async () => {
    skip();
    const res = await api('GET', `/api/subscriptions?projectId=${projectId}`, undefined, adminCookie);
    const data = (await res.json()) as { subscriptions: Array<{ id: number }> };
    expect(data.subscriptions.some((s) => s.id === subscriptionId)).toBe(true);

    const res2 = await api('GET', '/api/subscriptions?projectId=999999', undefined, adminCookie);
    const data2 = (await res2.json()) as { subscriptions: unknown[] };
    expect(data2.subscriptions).toHaveLength(0);
  });

  test('PATCH /api/subscriptions/[id] mutes subscription for 7 days', async () => {
    skip();
    const mutedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await api('PATCH', `/api/subscriptions/${subscriptionId}`, { mutedUntil }, adminCookie);
    expect(res.ok).toBe(true);

    const listRes = await api('GET', '/api/subscriptions', undefined, adminCookie);
    const data = (await listRes.json()) as { subscriptions: Array<{ id: number; mutedUntil: string | null }> };
    const sub = data.subscriptions.find((s) => s.id === subscriptionId);
    expect(sub?.mutedUntil).toBeTruthy();
    expect(new Date(sub!.mutedUntil!).getTime()).toBeGreaterThan(Date.now());
  });

  test('PATCH /api/subscriptions/[id] unmutes subscription', async () => {
    skip();
    const res = await api('PATCH', `/api/subscriptions/${subscriptionId}`, { mutedUntil: null }, adminCookie);
    expect(res.ok).toBe(true);

    const listRes = await api('GET', '/api/subscriptions', undefined, adminCookie);
    const data = (await listRes.json()) as { subscriptions: Array<{ id: number; mutedUntil: string | null }> };
    const sub = data.subscriptions.find((s) => s.id === subscriptionId);
    expect(sub?.mutedUntil).toBeNull();
  });

  test("non-owner gets 404 when deleting another user's subscription", async () => {
    skip();
    // userCookie belongs to notif-user who did not create this subscription
    const res = await api('DELETE', `/api/subscriptions/${subscriptionId}`, undefined, userCookie);
    expect(res.status).toBe(404);
  });

  test('DELETE /api/subscriptions/[id] removes the subscription', async () => {
    skip();
    const res = await api('DELETE', `/api/subscriptions/${subscriptionId}`, undefined, adminCookie);
    expect(res.ok).toBe(true);

    const listRes = await api('GET', '/api/subscriptions', undefined, adminCookie);
    const data = (await listRes.json()) as { subscriptions: Array<{ id: number }> };
    expect(data.subscriptions.find((s) => s.id === subscriptionId)).toBeUndefined();
  });
});

// ── Subscribe Bell UI ──────────────────────────────────────────────────────────

test.describe.serial('Subscribe Bell UI', () => {
  async function loginBrowser(page: import('@playwright/test').Page) {
    // Log in via the browser context so the session cookie is shared with page navigation
    await page.context().request.post(`${BASE}/api/auth/login`, { data: ADMIN });
  }

  test('bell is not visible when not authenticated', async ({ page }) => {
    skip();
    await page.goto(`${BASE}/projects/${projectId}`);
    await expect(page.getByTitle('Notification subscriptions for this project')).not.toBeVisible();
  });

  test('bell is visible when authenticated', async ({ page }) => {
    skip();
    await loginBrowser(page);
    await page.goto(`${BASE}/projects/${projectId}`);
    await expect(page.getByTitle('Notification subscriptions for this project')).toBeVisible();
  });

  test('bell popover shows "no channels" hint when no channels are configured', async ({ page }) => {
    skip();
    // Delete all channels first so the hint appears
    await api('DELETE', `/api/channels/${channelId}`, undefined, adminCookie);

    await loginBrowser(page);
    await page.goto(`${BASE}/projects/${projectId}`);
    const bell = page.getByTitle('Notification subscriptions for this project');
    await bell.click();
    await expect(page.getByText('No channels configured')).toBeVisible();

    // Restore the channel for subsequent tests
    const res = await api(
      'POST',
      '/api/channels',
      {
        name: 'Test email channel',
        type: 'email',
        config: { address: 'notify@example.com' },
      },
      adminCookie,
    );
    const data = (await res.json()) as { channel: { id: number } };
    channelId = data.channel.id;
  });

  test('subscribe via bell popover creates a subscription', async ({ page }) => {
    skip();
    await loginBrowser(page);
    await page.goto(`${BASE}/projects/${projectId}`);

    const bell = page.getByTitle('Notification subscriptions for this project');
    await bell.click();
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('button', { name: 'Subscribe' })).toBeVisible();
    await page.getByRole('button', { name: 'Subscribe' }).click();

    // Wait for success toast
    await expect(page.getByText('Subscribed')).toBeVisible();

    // Verify via API that subscription was created
    const res = await api('GET', `/api/subscriptions?projectId=${projectId}`, undefined, adminCookie);
    const data = (await res.json()) as { subscriptions: Array<{ id: number }> };
    expect(data.subscriptions.length).toBeGreaterThan(0);
    subscriptionId = data.subscriptions[0]!.id;
  });

  test('bell shows subscription and unsubscribe button after subscribing', async ({ page }) => {
    skip();
    await loginBrowser(page);
    await page.goto(`${BASE}/projects/${projectId}`);

    const bell = page.getByTitle('Notification subscriptions for this project');
    await bell.click();
    // The subscription row and unsubscribe button should be visible
    await expect(page.getByTitle('Unsubscribe')).toBeVisible();
  });

  test('unsubscribe via bell popover removes subscription', async ({ page }) => {
    skip();
    await loginBrowser(page);
    await page.goto(`${BASE}/projects/${projectId}`);

    const bell = page.getByTitle('Notification subscriptions for this project');
    await bell.click();
    await page.getByTitle('Unsubscribe').first().click();

    // Wait for success toast
    await expect(page.getByText('Unsubscribed')).toBeVisible();

    // Verify via API that subscription was removed
    const res = await api('GET', `/api/subscriptions?projectId=${projectId}`, undefined, adminCookie);
    const data = (await res.json()) as { subscriptions: unknown[] };
    expect(data.subscriptions).toHaveLength(0);
  });

  test('notifications settings page shows SMTP unconfigured state', async ({ page }) => {
    skip();
    await loginBrowser(page);
    await page.goto(`${BASE}/settings/notifications`);
    await expect(page.getByText('Not configured')).toBeVisible();
    await expect(page.getByText('PIWI_SMTP_HOST')).toBeVisible();
  });

  test('notifications settings page shows channels section when auth enabled', async ({ page }) => {
    skip();
    await loginBrowser(page);
    await page.goto(`${BASE}/settings/notifications`);
    await expect(page.getByText('Notification channels')).toBeVisible();
    await expect(page.getByText('My subscriptions')).toBeVisible();
  });
});
