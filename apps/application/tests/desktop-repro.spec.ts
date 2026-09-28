import type { Page, Request } from '@playwright/test';
import { test, expect } from './fixtures';
import { waitForHydration, retryPost } from './utils';
import { PROJECT } from '#shared/test-project-names';
import { couponBugReport } from './utils/bug-report-sample';

/**
 * A repro request from Piwi Picker, as the desktop window shows it: driven
 * against the regular web build with a faked Tauri bridge and the desktop
 * endpoints routed (they answer 404 outside the desktop build). Covers the
 * confirmation, the run through `desktop_run_repro`, and the verdict recorded
 * on the request; the spec's writing and the run itself are the shell's
 * (`src-tauri/src/repro.rs`).
 */

interface FakeInvocation {
  cmd: string;
  args: Record<string, unknown> | undefined;
}

declare global {
  interface Window {
    __piwiFakeTauri: { invocations: FakeInvocation[] };
  }
}

const REQUEST_ID = 'a1b2c3d4e5f60718';

async function installFakeBridge(page: Page, linkedProjectId: number) {
  await page.addInitScript((linked: string) => {
    const listeners: ((event: { payload: unknown }) => void)[] = [];
    const emit = (payload: unknown) => {
      for (const cb of listeners) cb({ payload });
    };
    const state = { invocations: [] as FakeInvocation[], lastRunId: 20 };
    Object.assign(window, { __piwiFakeTauri: state });
    Object.assign(window, {
      __TAURI__: {
        core: {
          invoke: async (cmd: string, args?: Record<string, unknown>) => {
            state.invocations.push({ cmd, args });
            switch (cmd) {
              case 'desktop_get_project_link':
                return String(args?.projectId) === linked ? { path: '/home/dev/shop', exists: true } : null;
              case 'desktop_run_repro': {
                const id = ++state.lastRunId;
                setTimeout(() => {
                  emit({ id, kind: 'stdout', line: 'Running 1 test using 1 worker', code: null });
                  emit({
                    id,
                    kind: 'repro',
                    repro: {
                      status: 'failed',
                      line: 11,
                      message: 'Error: expect(locator).toHaveText(expected) failed\n\nReceived string: "Total: 40"',
                    },
                  });
                  emit({ id, kind: 'exit', line: null, code: 1 });
                }, 50);
                return id;
              }
              case 'desktop_bring_to_front':
              case 'desktop_notify':
              case 'desktop_set_activity':
              case 'desktop_set_run_progress':
                return null;
              default:
                throw new Error(`unexpected command: ${cmd}`);
            }
          },
        },
        event: {
          listen: async (name: string, cb: (event: { payload: unknown }) => void) => {
            if (name === 'piwi:local-run') listeners.push(cb);
            return () => {};
          },
        },
        window: { getCurrentWindow: () => ({ label: 'main' }) },
      },
    });
  }, String(linkedProjectId));
}

/** The desktop event stream, answering the request once, then nothing, as the server resends only waiting ones. */
async function routeDesktop(page: Page, patches: unknown[]) {
  const steps = couponBugReport().steps;
  const request = {
    id: REQUEST_ID,
    title: steps.title,
    steps,
    options: { headed: true, trace: true, project: null, repeatEach: 1 },
    bugReportId: 37,
    instanceUrl: 'https://piwi.example.com',
    status: 'waiting',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    projectId: null,
    verdict: null,
    runId: null,
  };
  let sent = false;
  await page.route('**/api/desktop/events', (route) => {
    const body = sent ? ': idle\n\n' : `data: ${JSON.stringify({ type: 'repro-request', request })}\n\n`;
    sent = true;
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body });
  });
  await page.route(`**/api/desktop/repro-requests/${REQUEST_ID}/spec*`, (route) =>
    route.fulfill({ json: { code: '', stepLines: [4, 5, 6, 8], warnings: [] } }),
  );
  await page.route(`**/api/desktop/repro-requests/${REQUEST_ID}`, (route, req: Request) => {
    patches.push(req.postDataJSON());
    return route.fulfill({ json: { ...request, ...req.postDataJSON() } });
  });
}

test.describe('Desktop repro request', () => {
  let projectId: number;

  test.beforeAll(async ({ request }) => {
    const res = await retryPost(request, '/api/test-runs/submit', {
      data: {
        projectName: PROJECT.DESKTOP_REPRO,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [{ title: 'cart loads', status: 'passed', duration: 1000, location: 'tests/cart.spec.ts:3:1' }],
      },
    });
    expect(res.ok()).toBeTruthy();
    projectId = (await res.json()).projectId;
  });

  test('waits for the click, runs in the linked project and records the verdict', async ({ page }) => {
    const patches: unknown[] = [];
    await installFakeBridge(page, projectId);
    await routeDesktop(page, patches);
    await page.goto('/setup');
    await waitForHydration(page);

    const dialog = page.getByRole('dialog', { name: 'Run a bug report with Playwright' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Coupon not applied to the total')).toBeVisible();
    await expect(dialog.getByText('/home/dev/shop')).toBeVisible();
    await expect(dialog.getByText(`<testDir>/piwi-repro/bug-${REQUEST_ID}.spec.ts --headed --trace=on`)).toBeVisible();
    // Nothing ran before the click.
    expect(
      await page.evaluate(() => window.__piwiFakeTauri.invocations.some((i) => i.cmd === 'desktop_run_repro')),
    ).toBe(false);

    await dialog.getByRole('button', { name: 'Run with Playwright' }).click();
    await expect(dialog).toHaveCount(0);

    const tray = page.getByRole('region', { name: 'Local runs' });
    await expect(tray.getByText('Running 1 test using 1 worker')).toBeVisible();
    await expect(page.getByText('Bug reproduced').first()).toBeVisible();
    const runs = await page.evaluate(() =>
      window.__piwiFakeTauri.invocations.filter((i) => i.cmd === 'desktop_run_repro'),
    );
    expect(runs).toEqual([
      {
        cmd: 'desktop_run_repro',
        args: { projectId: String(projectId), requestId: REQUEST_ID, args: ['--headed', '--trace=on'] },
      },
    ]);
    await expect.poll(() => patches.length).toBe(2);
    expect(patches[0]).toEqual({ status: 'running', projectId });
    expect(patches[1]).toMatchObject({
      status: 'done',
      verdict: { kind: 'reproduced', step: 3, found: '"Total: 40"' },
    });
  });

  test('declining runs nothing and says so to the request', async ({ page }) => {
    const patches: unknown[] = [];
    await installFakeBridge(page, projectId);
    await routeDesktop(page, patches);
    await page.goto('/setup');
    await waitForHydration(page);

    const dialog = page.getByRole('dialog', { name: 'Run a bug report with Playwright' });
    await dialog.getByRole('button', { name: 'Decline' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => patches).toEqual([{ status: 'declined' }]);
    expect(
      await page.evaluate(() => window.__piwiFakeTauri.invocations.some((i) => i.cmd === 'desktop_run_repro')),
    ).toBe(false);
  });
});
