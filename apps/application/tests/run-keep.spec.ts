import { test, expect } from './fixtures';
import type { APIRequestContext } from '@playwright/test';
import { PROJECT } from '#shared/test-project-names';

/** Submit a one-test run and return its id and project id. */
async function submitRun(request: APIRequestContext, projectName: string, extra: Record<string, unknown> = {}) {
  const response = await request.post('/api/test-runs/submit', {
    data: {
      projectName,
      status: 'passed',
      startTime: new Date().toISOString(),
      duration: 1000,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      skippedTests: 0,
      testCases: [{ title: 'keeps', status: 'passed', duration: 10, location: 'tests/keep.spec.ts:1:1' }],
      ...extra,
    },
  });
  expect(response.ok()).toBeTruthy();
  const { runId } = await response.json();
  const run = await (await request.get(`/api/test-runs/${runId}`)).json();
  return { runId: runId as number, projectId: run.projectId as number };
}

test.describe.serial('Keeping runs forever', () => {
  test('the reporter keeps a run at ingest with keep: true', async ({ request }) => {
    const { runId } = await submitRun(request, PROJECT.RUN_KEEP, { keep: true });
    const run = await (await request.get(`/api/test-runs/${runId}`)).json();
    expect(run.keptAt).toBeTruthy();
    expect(run.keepSource).toBe('reporter');
  });

  test('a kept run lists, refuses deletion, and deletes once released', async ({ request }) => {
    const { runId, projectId } = await submitRun(request, PROJECT.RUN_KEEP);

    const kept = await request.patch(`/api/test-runs/${runId}`, {
      data: { keep: true, keepReason: 'v2.3.1 release' },
    });
    expect(kept.ok()).toBeTruthy();
    const run = await (await request.get(`/api/test-runs/${runId}`)).json();
    expect(run).toMatchObject({ keepSource: 'user', keepReason: 'v2.3.1 release' });

    const list = await (await request.get(`/api/projects/${projectId}/kept-runs`)).json();
    expect(list.items.map((r: { id: number }) => r.id)).toContain(runId);

    const refused = await request.delete(`/api/test-runs/${runId}`);
    expect(refused.status()).toBe(409);

    const released = await request.patch(`/api/test-runs/${runId}`, { data: { keep: false } });
    expect(released.ok()).toBeTruthy();
    expect((await (await request.get(`/api/test-runs/${runId}`)).json()).keptAt).toBeNull();

    expect((await request.delete(`/api/test-runs/${runId}`)).ok()).toBeTruthy();
  });

  test('a malformed keep patch is refused', async ({ request }) => {
    const { runId } = await submitRun(request, PROJECT.RUN_KEEP);
    const response = await request.patch(`/api/test-runs/${runId}`, { data: { keepReason: 'no keep' } });
    expect(response.status()).toBe(400);
  });

  test('a release marker keeps its run; a run of another project is refused', async ({ request }) => {
    const { runId, projectId } = await submitRun(request, PROJECT.RUN_KEEP);
    const other = await submitRun(request, PROJECT.RUN_KEEP_OTHER);

    const wrongProject = await request.post(`/api/projects/${projectId}/markers`, {
      data: { label: 'v9', category: 'release', occurredAt: new Date().toISOString(), runId: other.runId },
    });
    expect(wrongProject.status()).toBe(400);

    const created = await request.post(`/api/projects/${projectId}/markers`, {
      data: { label: 'v2.4.0', category: 'release', occurredAt: new Date().toISOString(), runId },
    });
    expect(created.ok()).toBeTruthy();
    const { marker } = await created.json();
    expect(await (await request.get(`/api/test-runs/${runId}`)).json()).toMatchObject({
      keepSource: 'marker',
      keepReason: 'v2.4.0',
    });

    expect((await request.delete(`/api/markers/${marker.id}`)).ok()).toBeTruthy();
    expect((await (await request.get(`/api/test-runs/${runId}`)).json()).keptAt).toBeNull();
  });

  test('the run page and the runs table show a kept run', async ({ page, request }) => {
    const { runId, projectId } = await submitRun(request, PROJECT.RUN_KEEP);
    await request.patch(`/api/test-runs/${runId}`, { data: { keep: true, keepReason: 'audit' } });

    await page.goto(`/test-runs/${runId}`);
    await expect(page.locator('[data-shot="run-kept"]')).toBeVisible();

    await page.goto(`/projects/${projectId}`);
    await expect(page.getByLabel(`Run #${runId} is kept forever`).first()).toBeAttached();
    await page.locator('[data-shot="kept-runs-toggle"]').click();
    await expect(page.getByText(`Run #${runId}`).first()).toBeVisible();
  });
});
