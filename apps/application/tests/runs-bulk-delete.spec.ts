import { test, expect, type APIRequestContext } from './fixtures';
import { waitForHydration } from './utils';
import { PROJECT } from '#shared/test-project-names';

/**
 * Deleting runs from the project's runs list: select them with the row
 * checkboxes (or all at once), delete the selection, and follow each run as it
 * goes. Kept runs are skipped, a deletion of several runs can be stopped after
 * the current one, and a run that fails to delete keeps the modal open on its
 * error.
 */

async function submitRun(request: APIRequestContext, minutesAgo: number) {
  const response = await request.post('/api/test-runs/submit', {
    data: {
      projectName: PROJECT.RUN_DELETE_MANY,
      status: 'passed',
      startTime: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      duration: 1000,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      skippedTests: 0,
      testCases: [{ title: 'bulk delete case', status: 'passed', duration: 100, location: 'tests/bulk.spec.ts:1:1' }],
    },
  });
  expect(response.ok(), `submit failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  return (await response.json()) as { runId: number; projectId: number };
}

const runIdOf = (url: string) => Number(new URL(url).pathname.split('/').pop());

test.describe.serial('Delete a selection of runs', () => {
  let projectId: number;
  const runIds: number[] = [];
  let keptRunId: number;
  let survivorId: number;

  test.beforeAll(async ({ request }) => {
    for (const minutesAgo of [40, 30, 20, 10]) {
      const run = await submitRun(request, minutesAgo);
      projectId = run.projectId;
      runIds.push(run.runId);
    }
    keptRunId = runIds[0]!;
    const keep = await request.patch(`/api/test-runs/${keptRunId}`, { data: { keep: true } });
    expect(keep.ok(), `keep failed: ${keep.status()} ${await keep.text()}`).toBeTruthy();
  });

  test('select all, follow each run as it is deleted, and stop after the current one', async ({ page, request }) => {
    // Hold the second DELETE so the in-between state stays on screen.
    const deleted: number[] = [];
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/test-runs/*', async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      deleted.push(runIdOf(route.request().url()));
      if (deleted.length === 2) await released;
      await route.continue();
    });

    await page.goto(`/projects/${projectId}`);
    await waitForHydration(page);
    await page.getByRole('checkbox', { name: 'Select all runs' }).check();
    await expect(page.getByText('4 runs selected')).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Delete 3 runs' })).toBeVisible();
    await expect(dialog).toContainText(`Run #${keptRunId} is kept forever and will be skipped.`);
    await dialog.getByRole('button', { name: 'Delete 3 runs' }).click();

    await expect(dialog.getByRole('heading', { name: 'Deleting 3 runs' })).toBeVisible();
    const lines = dialog.getByTestId('runs-delete-lines');
    await expect(lines.locator('[data-state="ok"]')).toHaveCount(1);
    await expect(lines.locator('[data-state="pending"]')).toHaveCount(1);
    await expect(lines.locator('[data-state="waiting"]')).toHaveCount(1);
    await expect(dialog).toContainText('1 of 3 done');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Stop' }).click();
    await expect(dialog.getByRole('button', { name: 'Stopping…' })).toBeDisabled();
    release();

    await expect(page.getByText('Stopped — 2 of 3 runs deleted', { exact: true })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(deleted).toHaveLength(2);
    for (const id of deleted) expect((await request.get(`/api/test-runs/${id}`)).status()).toBe(404);
    survivorId = runIds.find((id) => id !== keptRunId && !deleted.includes(id))!;
    expect((await request.get(`/api/test-runs/${survivorId}`)).ok()).toBeTruthy();
    expect((await request.get(`/api/test-runs/${keptRunId}`)).ok()).toBeTruthy();
    // The deleted runs leave the selection; the two left stay selected.
    await expect(page.getByText('2 runs selected')).toBeVisible();
  });

  test('a run that fails to delete keeps the modal open on its error', async ({ page, request }) => {
    await page.route(`**/api/test-runs/${survivorId}`, (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({ status: 500, json: { message: 'Storage is unavailable' } })
        : route.fallback(),
    );

    await page.goto(`/projects/${projectId}`);
    await waitForHydration(page);
    await page.getByRole('button', { name: `Run #${survivorId} actions` }).click();
    await page.getByRole('menuitem', { name: 'Delete run' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(dialog.getByRole('heading', { name: `Run #${survivorId} was not deleted` })).toBeVisible();
    await expect(dialog.getByTestId('runs-delete-lines').locator('[data-state="error"]')).toContainText(
      'Storage is unavailable',
    );
    await dialog.locator('[data-slot="footer"]').getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);

    // Without the failure, the same run deletes and the modal closes on a toast.
    await page.unroute(`**/api/test-runs/${survivorId}`);
    await page.getByRole('button', { name: `Run #${survivorId} actions` }).click();
    await page.getByRole('menuitem', { name: 'Delete run' }).click();
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText(`Run #${survivorId} deleted`, { exact: true })).toBeVisible();
    expect((await request.get(`/api/test-runs/${survivorId}`)).status()).toBe(404);
  });
});
