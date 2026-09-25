/**
 * Saved dashboards:
 *   /api/analytics/dashboards …          — CRUD, duplicate, the save precondition, widget data, preview
 *   /analytics, /analytics/d/<id>        — Overview unchanged, duplicate, edit, save, reload, TV mode
 *   deletion                              — names the schedules rendering the dashboard, which go inactive
 *   access (auth server, CI only)         — a USER-role viewer of a shared dashboard sees only their projects
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { PROJECT } from '#shared/test-project-names';
import type { DashboardView } from '#shared/handlers/dashboards';

let openProjectId = 0;
let restrictedProjectId = 0;
let channelId = 0;
const createdDashboards: string[] = [];
const createdSchedules: number[] = [];

async function submitRun(request: import('@playwright/test').APIRequestContext, projectName: string, passed: number) {
  const res = await request.post('/api/test-runs/submit', {
    data: {
      projectName,
      status: passed === 2 ? 'passed' : 'failed',
      startTime: new Date(Date.now() - 60_000).toISOString(),
      duration: 20_000,
      totalTests: 2,
      passedTests: passed,
      failedTests: 2 - passed,
      skippedTests: 0,
      testCases: [
        { title: 'adds to cart', status: 'passed', duration: 400, location: 'tests/cart.spec.ts:1:1' },
        {
          title: 'pays',
          status: passed === 2 ? 'passed' : 'failed',
          duration: 900,
          location: 'tests/pay.spec.ts:1:1',
          ...(passed === 2 ? {} : { error: 'Error: expect(received).toBe(expected)' }),
        },
      ],
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).projectId as number;
}

test.beforeAll(async ({ request }) => {
  openProjectId = await submitRun(request, PROJECT.DASHBOARDS_OPEN, 2);
  restrictedProjectId = await submitRun(request, PROJECT.DASHBOARDS_RESTRICTED, 1);
  const channel = await request.post('/api/channels', {
    data: { name: 'Saved dashboards test', type: 'email', config: { address: 'dashboards@example.test' } },
  });
  expect(channel.ok()).toBeTruthy();
  channelId = (await channel.json()).channel.id;
});

test.afterAll(async ({ request }) => {
  for (const id of createdSchedules) await request.delete(`/api/reports/schedules/${id}`);
  for (const id of createdDashboards) await request.delete(`/api/analytics/dashboards/${id}`);
  if (channelId) await request.delete(`/api/channels/${channelId}`);
});

function definition(projectIds: number[]) {
  return {
    v: 1,
    scope: { period: { kind: 'rolling', days: 30 }, projectIds },
    bands: [
      {
        title: 'Numbers',
        widgets: [
          { key: 'pass', type: 'metric', size: 'full', options: { metric: 'test-pass-rate', display: 'stat' } },
          {
            key: 'by-project',
            type: 'metric',
            size: 'full',
            options: { metric: 'test-pass-rate', display: 'table', breakdown: 'project' },
          },
        ],
      },
    ],
  };
}

async function createDashboard(request: import('@playwright/test').APIRequestContext, name: string) {
  const res = await request.post('/api/analytics/dashboards', {
    data: { name, visibility: 'shared', definition: definition([openProjectId, restrictedProjectId]) },
  });
  expect(res.status(), await res.text()).toBe(201);
  const view: DashboardView = await res.json();
  createdDashboards.push(view.id);
  return view;
}

/** The dashboard is on screen and hydrated: the scope line comes from a client-side fetch. */
async function waitForDashboard(page: Page) {
  await expect(page.getByTestId('dashboard-switcher')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('analytics-scope-line')).toContainText('compared with', { timeout: 30_000 });
}

test.describe('Dashboards API', () => {
  test('the list starts with Overview, and a saved dashboard reads its widgets', async ({ request }) => {
    const view = await createDashboard(request, 'API dashboard');
    const list = await (await request.get('/api/analytics/dashboards')).json();
    expect(list.items[0].id).toBe('overview');
    expect(list.items.map((d: { id: string }) => d.id)).toContain(view.id);

    const pass = await (await request.get(`/api/analytics/dashboards/${view.id}/widgets/pass`)).json();
    expect(pass.value.value).toBe(75);
    const byProject = await (await request.get(`/api/analytics/dashboards/${view.id}/widgets/by-project`)).json();
    expect(byProject.breakdown.groups).toHaveLength(2);

    const narrowed = await (
      await request.get(`/api/analytics/dashboards/${view.id}/widgets/pass?period=last-30d&projects=${openProjectId}`)
    ).json();
    expect(narrowed.value.value).toBe(100);
  });

  test('a save carries the updatedAt it started from; a stale one gets a 409', async ({ request }) => {
    const view = await createDashboard(request, 'Race dashboard');
    const first = await request.patch(`/api/analytics/dashboards/${view.id}`, {
      data: { name: 'Race dashboard, renamed', updatedAt: view.updatedAt },
    });
    expect(first.ok()).toBeTruthy();
    const stale = await request.patch(`/api/analytics/dashboards/${view.id}`, {
      data: { name: 'Lost update', updatedAt: view.updatedAt },
    });
    expect(stale.status()).toBe(409);
  });

  test('a built-in dashboard is duplicated, never saved', async ({ request }) => {
    const refused = await request.patch('/api/analytics/dashboards/overview', {
      data: { name: 'Mine', updatedAt: new Date().toISOString() },
    });
    expect(refused.status()).toBe(403);
    const copy = await request.post('/api/analytics/dashboards/overview/duplicate', { data: {} });
    expect(copy.status()).toBe(201);
    const view: DashboardView = await copy.json();
    createdDashboards.push(view.id);
    expect(view.name).toBe('Copy of Overview');
  });

  test('the preview runs an unsaved widget, and refuses a bad one', async ({ request }) => {
    const ok = await request.post('/api/analytics/widgets/preview', {
      data: {
        widget: { type: 'metric', options: { display: 'stat' } },
        scope: { period: 'last-30d', projects: String(restrictedProjectId) },
      },
    });
    expect(ok.ok()).toBeTruthy();
    expect((await ok.json()).value.value).toBe(50);
    const bad = await request.post('/api/analytics/widgets/preview', {
      data: { widget: { type: 'metric', options: { metric: 'nope' } }, scope: {} },
    });
    expect(bad.status()).toBe(400);
  });

  test('a text widget escapes raw HTML', async ({ request }) => {
    const res = await request.post('/api/analytics/widgets/preview', {
      data: { widget: { type: 'text', options: { markdown: '**Hi** <script>alert(1)</script>' } }, scope: {} },
    });
    const note = await res.json();
    expect(note.html).toContain('<strong>Hi</strong>');
    expect(note.html).not.toContain('<script>');
  });
});

test.describe('Dashboards UI', () => {
  test.setTimeout(120_000);

  test('/analytics still opens Overview, with its four bands', async ({ page }) => {
    await page.goto('/analytics');
    await waitForDashboard(page);
    await expect(page.getByTestId('dashboard-switcher')).toHaveText(/Overview/);
    for (const band of ['Where things stand', 'Where the pain is', 'Which way it is going', 'Detail']) {
      await expect(page.getByRole('heading', { name: band, exact: true })).toBeVisible();
    }
  });

  test('duplicate Overview, add a metric widget, save, reload and reopen from the link', async ({ page }) => {
    await page.goto('/analytics');
    await waitForDashboard(page);
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect(page).toHaveURL(/\/analytics\/d\/\d+/, { timeout: 30_000 });
    const id = page.url().match(/\/analytics\/d\/(\d+)/)![1]!;
    createdDashboards.push(id);
    await expect(page.getByText('Editing this dashboard')).toBeVisible();

    await page.getByTestId('add-widget-button-0').click();
    await page.getByTestId('add-widget-metric').click();
    await expect(page.getByTestId('widget-config')).toBeVisible();
    await page.getByTestId('widget-title').fill('Pass rate this week');
    await page.getByTestId('widget-config-apply').click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Dashboard saved').first()).toBeVisible();

    await page.reload();
    await waitForDashboard(page);
    await expect(page.getByText('Pass rate this week')).toBeVisible();

    await page.goto(`/analytics/d/${id}?period=last-7d`);
    await waitForDashboard(page);
    await expect(page.getByRole('button', { name: /Last 7 days/ })).toBeVisible();
  });

  test('a concurrent save is answered with the conflict prompt', async ({ page, request }) => {
    const view = await createDashboard(request, 'Conflict dashboard');
    await page.goto(`/analytics/d/${view.id}`);
    await waitForDashboard(page);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const other = await request.patch(`/api/analytics/dashboards/${view.id}`, {
      data: { name: 'Saved elsewhere', updatedAt: view.updatedAt },
    });
    expect(other.ok()).toBeTruthy();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved by someone else')).toBeVisible();
    await expect(page.getByTestId('conflict-save-copy')).toBeVisible();
  });

  test('TV mode shows the dashboard without the navigation', async ({ page, request }) => {
    const view = await createDashboard(request, 'Wall dashboard');
    await page.goto(`/analytics/d/${view.id}?tv=1`);
    await expect(page.getByTestId('dashboard-tv')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Wall dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Quality reports' })).toHaveCount(0);
  });

  test('deleting a scheduled dashboard names the schedule, which then shows inactive', async ({ page, request }) => {
    const view = await createDashboard(request, 'Scheduled dashboard');
    const schedule = await request.post('/api/reports/schedules', {
      data: {
        name: 'Weekly saved dashboard',
        dashboard: view.id,
        cadence: 'weekly',
        anchor: 1,
        at: '08:00',
        channelIds: [channelId],
      },
    });
    expect(schedule.status(), await schedule.text()).toBe(201);
    const scheduleId = (await schedule.json()).id as number;
    createdSchedules.push(scheduleId);

    await page.goto(`/analytics/d/${view.id}`);
    await waitForDashboard(page);
    await page.getByTestId('dashboard-more').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.getByTestId('delete-dashboard')).toContainText('Weekly saved dashboard');
    await page.getByTestId('delete-dashboard-confirm').click();
    await expect(page).toHaveURL(/\/analytics\/dashboards/);

    await page.goto('/reports');
    // The first visit compiles the page on a dev server.
    await expect(page.getByTestId(`schedule-${scheduleId}`)).toContainText('Inactive', { timeout: 60_000 });
    await expect(page.getByTestId(`schedule-${scheduleId}`)).toContainText('saved dashboard was deleted');
  });
});

// ── Access, on the auth-enabled server (CI only) ─────────────────────────────

const AUTH_BASE = 'http://localhost:3097';
const ADMIN = { username: 'admin', password: 'adminpassword123' };
const VIEWER = { username: 'dashboards-viewer', password: 'viewerpassword123' };

async function authApi(method: string, path: string, body?: unknown, cookie?: string) {
  return fetch(`${AUTH_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function loginAs(username: string, password: string): Promise<string> {
  const res = await authApi('POST', '/api/auth/login', { username, password });
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

test.describe.serial('Dashboards access', () => {
  test.skip(!process.env.CI, 'The auth-enabled server runs in CI only (see playwright.config.ts webServer)');

  test('a USER-role viewer of a shared dashboard sees only the project they can open', async ({ browser }) => {
    await authApi('POST', '/api/auth/setup', { ...ADMIN, name: 'Admin' });
    const admin = await loginAs(ADMIN.username, ADMIN.password);
    const ids: number[] = [];
    for (const [name, passed] of [
      [PROJECT.DASHBOARDS_OPEN, 2],
      [PROJECT.DASHBOARDS_RESTRICTED, 1],
    ] as const) {
      const res = await authApi(
        'POST',
        '/api/test-runs/submit',
        {
          projectName: name,
          status: passed === 2 ? 'passed' : 'failed',
          startTime: new Date(Date.now() - 60_000).toISOString(),
          duration: 1000,
          totalTests: 2,
          passedTests: passed,
          failedTests: 2 - passed,
          skippedTests: 0,
          testCases: [],
        },
        admin,
      );
      ids.push(((await res.json()) as { projectId: number }).projectId);
    }
    const created = await authApi(
      'POST',
      '/api/analytics/dashboards',
      { name: 'Checkout team (access)', visibility: 'shared', definition: definition(ids) },
      admin,
    );
    expect(created.status).toBe(201);
    const view = (await created.json()) as DashboardView;

    const user = await authApi('POST', '/api/users', { ...VIEWER, role: 'user' }, admin);
    expect([200, 201, 400, 409]).toContain(user.status);
    const users = (await (await authApi('GET', '/api/users', undefined, admin)).json()) as {
      items?: Array<{ id: number; username: string }>;
    };
    const viewerId = (users.items ?? (users as unknown as Array<{ id: number; username: string }>)).find(
      (u) => u.username === VIEWER.username,
    )!.id;
    await authApi('PUT', `/api/users/${viewerId}/projects`, { global: false, projectIds: [ids[0]] }, admin);
    const viewer = await loginAs(VIEWER.username, VIEWER.password);

    const seen = (await (
      await authApi('GET', `/api/analytics/dashboards/${view.id}`, undefined, viewer)
    ).json()) as DashboardView;
    expect(seen.hiddenProjects).toBe(1);
    expect(seen.canEdit).toBe(false);
    const pass = (await (
      await authApi('GET', `/api/analytics/dashboards/${view.id}/widgets/pass`, undefined, viewer)
    ).json()) as { value: { value: number } };
    expect(pass.value.value).toBe(100);

    const share = await authApi('POST', '/api/analytics/dashboards', { name: 'Mine', visibility: 'shared' }, viewer);
    expect(share.status).toBe(403);

    const context = await browser.newContext({ baseURL: AUTH_BASE });
    const [name, value] = viewer.split('=');
    await context.addCookies([{ name: name!, value: value!, url: AUTH_BASE }]);
    const page = await context.newPage();
    await page.goto(`/analytics/d/${view.id}`);
    await expect(page.getByTestId('dashboard-hidden-projects')).toContainText('1 project hidden (no access)', {
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Duplicate', exact: true })).toBeVisible();
    await context.close();
    await authApi('DELETE', `/api/analytics/dashboards/${view.id}`, undefined, admin);
  });
});
