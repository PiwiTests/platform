/**
 * Report share links and live dashboard links:
 *   /api/reports/snapshots/:id/share-links    — mint and list a report share link
 *   /api/dashboards/:id/share-links — mint and list a live dashboard link
 *   /share/:token, /chart.png, /badge.svg      — the anonymous views, and their 404 once revoked
 *   the snapshot page's Share button          — minting from the dialog, with the badge
 */
import { test, expect } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

test.describe.configure({ mode: 'serial' });

let projectId: number;
let snapshotId: number;
let dashboardId: number;

test.beforeAll(async ({ request }) => {
  const submit = await request.post('/api/test-runs/submit', {
    data: {
      projectName: PROJECT.REPORT_SHARE_LINKS,
      status: 'passed',
      startTime: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
      duration: 10_000,
      totalTests: 2,
      passedTests: 2,
      failedTests: 0,
      skippedTests: 0,
      testCases: [
        { title: 'shares a report', status: 'passed', duration: 300, location: 'tests/share.spec.ts:1:1' },
        { title: 'opens <b>a</b> link', status: 'passed', duration: 200, location: 'tests/share.spec.ts:8:1' },
      ],
    },
  });
  expect(submit.ok()).toBeTruthy();
  projectId = (await submit.json()).projectId;

  const snapshot = await request.post('/api/reports/snapshots', {
    data: { dashboard: 'executive', projects: String(projectId), period: 'last-7d' },
  });
  expect(snapshot.status()).toBe(201);
  snapshotId = (await snapshot.json()).id;

  const dashboard = await request.post('/api/dashboards', {
    data: {
      name: 'Share links wall screen',
      visibility: 'shared',
      definition: {
        v: 1,
        scope: { projectIds: [projectId], period: { kind: 'rolling', days: 7 } },
        bands: [
          {
            title: 'Where things stand',
            widgets: [
              { key: 'headline', type: 'stats', size: 'full', options: { metrics: ['test-pass-rate', 'runs'] } },
              { key: 'trend', type: 'metric', size: 'full', options: { metric: 'test-pass-rate', display: 'line' } },
            ],
          },
        ],
      },
    },
  });
  expect(dashboard.status(), await dashboard.text()).toBe(201);
  dashboardId = (await dashboard.json()).id;
});

test.afterAll(async ({ request }) => {
  if (dashboardId) await request.delete(`/api/dashboards/${dashboardId}`);
});

test.describe('Report share links', () => {
  test('a snapshot link renders the stored report, its chart and its badge, and dies when revoked', async ({
    request,
    browser,
  }) => {
    const res = await request.post(`/api/reports/snapshots/${snapshotId}/share-links`, { data: { ttlDays: 7 } });
    expect(res.ok(), await res.text()).toBeTruthy();
    const minted = await res.json();
    expect(minted.token).toMatch(/^psl_[0-9a-f]{64}$/);
    expect(minted.badgeUrl).toBe(`${minted.url}/badge.svg`);
    expect(minted.chartUrl).toBe(`${minted.url}/chart.png`);

    const list = await (await request.get(`/api/reports/snapshots/${snapshotId}/share-links`)).json();
    expect(list.items.map((l: { id: number }) => l.id)).toContain(minted.link.id);

    // A fresh context: no session cookie at all.
    const anon = await browser.newContext();
    const page = await anon.newPage();
    const response = await page.goto(minted.url);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['content-security-policy']).toContain('sandbox');
    expect(response?.headers()['cache-control']).toBe('no-store');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(PROJECT.REPORT_SHARE_LINKS);

    const badge = await anon.request.get(minted.badgeUrl);
    expect(badge.status()).toBe(200);
    expect(badge.headers()['content-type']).toContain('image/svg+xml');
    // Image proxies (GitHub's, Slack's) may cache an image for a few minutes; the page never.
    expect(badge.headers()['cache-control']).toBe('public, max-age=300');
    expect(await badge.text()).toMatch(/tests on default branch/);

    const chart = await anon.request.get(minted.chartUrl);
    expect(chart.status()).toBe(200);
    expect(chart.headers()['content-type']).toBe('image/png');
    expect(chart.headers()['cache-control']).toBe('public, max-age=300');

    const revoke = await request.delete(`/api/share-links/${minted.link.id}`);
    expect(revoke.ok()).toBeTruthy();
    expect((await anon.request.get(minted.url)).status()).toBe(404);
    expect((await anon.request.get(minted.badgeUrl)).status()).toBe(404);
    expect((await anon.request.get(minted.chartUrl)).status()).toBe(404);
    await anon.close();
  });

  test('the snapshot page mints a link and shows its badge', async ({ page }) => {
    await page.goto(`/reports/${snapshotId}`);
    await expect(page.getByTestId('snapshot-delivery')).toBeVisible({ timeout: 60_000 });
    await expect(async () => {
      await page.getByRole('button', { name: 'Share', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Share this quality report' })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Create link' }).click();
    await expect(page.getByTestId('minted-share-url')).toHaveValue(/\/share\/psl_[0-9a-f]{64}$/);
    await expect(page.getByTestId('minted-badge').getByRole('img', { name: 'Status badge' })).toBeVisible();
  });
});

test.describe('A schedule that includes a share link', () => {
  test('mints one link per snapshot, expiring a week after the next report', async ({ request }) => {
    const channel = await request.post('/api/channels', {
      data: { name: 'Report share links test', type: 'email', config: { address: 'share@example.test' } },
    });
    expect(channel.ok()).toBeTruthy();
    const channelId = (await channel.json()).channel.id;
    const created = await request.post('/api/reports/schedules', {
      data: {
        name: 'Shared weekly report',
        dashboard: 'executive',
        scope: { projects: String(projectId) },
        cadence: 'weekly',
        anchor: 1,
        at: '08:00',
        channelIds: [channelId],
        includeShareLink: true,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const schedule = await created.json();
    expect(schedule.includeShareLink).toBe(true);
    try {
      const run = await (await request.post(`/api/reports/schedules/${schedule.id}/run`)).json();
      const links = await (await request.get(`/api/reports/snapshots/${run.snapshotId}/share-links`)).json();
      expect(links.items).toHaveLength(1);
      const expiresAt = Date.parse(links.items[0].expiresAt);
      // The next weekly firing is at most 7 days away, plus the 7-day grace.
      expect(expiresAt).toBeGreaterThan(Date.now() + 7 * 24 * 3600 * 1000);
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 15 * 24 * 3600 * 1000);
    } finally {
      await request.delete(`/api/reports/schedules/${schedule.id}`);
      await request.delete(`/api/channels/${channelId}`);
    }
  });
});

test.describe('Live dashboard links', () => {
  test('a dashboard link renders the dashboard live, reloading itself, until revoked', async ({ request, browser }) => {
    const res = await request.post(`/api/dashboards/${dashboardId}/share-links`, { data: {} });
    expect(res.ok(), await res.text()).toBeTruthy();
    const minted = await res.json();

    const anon = await browser.newContext();
    const response = await anon.request.get(minted.url);
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain('http-equiv="refresh"');
    expect(body).toContain('Share links wall screen');
    expect(body).toContain('Live dashboard');
    expect(body).not.toContain('<b>a</b>');

    await request.delete(`/api/share-links/${minted.link.id}`);
    expect((await anon.request.get(minted.url)).status()).toBe(404);
    await anon.close();
  });

  test('a built-in dashboard has no live link: it must be duplicated first', async ({ request }) => {
    const res = await request.post('/api/dashboards/overview/share-links', { data: {} });
    expect(res.status()).toBe(400);
  });

  test('the dashboard menu opens the live dashboard links dialog', async ({ page }) => {
    await page.goto(`/analytics/d/${dashboardId}`);
    await expect(page.getByTestId('dashboard-switcher')).toBeVisible({ timeout: 60_000 });
    await expect(async () => {
      await page.getByRole('button', { name: 'More dashboard actions' }).click();
      await page.getByRole('menuitem', { name: 'Live dashboard links' }).click({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByRole('dialog', { name: 'Live dashboard links' })).toBeVisible();
  });
});
