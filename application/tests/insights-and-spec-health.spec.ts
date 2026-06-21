import { test, expect } from './fixtures';

test.describe.serial('New API endpoints', () => {
  test('insights, spec-health, and classify return expected status codes', async ({ request }) => {
    // Insights: unknown run → 404
    const insRes = await request.get('/api/test-runs/9999999/insights');
    expect(insRes.status()).toBe(404);

    // Flaky classify: missing testCaseId → 400
    const classifyRes = await request.post('/api/projects/1/flaky-classify', { data: {} });
    expect(classifyRes.status()).toBe(400);

    // Stability trend: unknown test case → 404
    const trendRes = await request.get('/api/test-cases/9999999/stability-trend');
    expect(trendRes.status()).toBe(404);
  });
});
