/**
 * Perfetto (Trace Event Format) export of a run and of an execution.
 *
 * The point is that the downloaded file opens in ui.perfetto.dev, so these
 * assert the envelope Perfetto reads (traceEvents + displayTimeUnit + metadata),
 * that shards map to processes and workers to threads, and that every execution
 * is a slice carrying its steps.
 */

import { test, expect, type APIRequestContext } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

const NOW = Date.now();

async function submitShardedRun(request: APIRequestContext): Promise<number> {
  const res = await request.post('/api/test-runs/submit', {
    data: {
      projectName: PROJECT.PERFETTO_EXPORT,
      status: 'failed',
      startTime: new Date(NOW).toISOString(),
      duration: 4000,
      totalTests: 2,
      passedTests: 1,
      failedTests: 1,
      skippedTests: 0,
      testCases: [
        {
          title: 'adds an item to the cart',
          status: 'passed',
          duration: 2000,
          location: 'tests/cart.spec.ts:12:5',
          workerIndex: 0,
          shardIndex: 1,
          startedAt: NOW,
          tags: ['smoke'],
          steps: [
            {
              title: 'Navigate',
              subtitle: 'https://shop.test/cart',
              category: 'navigation',
              duration: 500,
              startTime: NOW + 10,
            },
          ],
        },
        {
          title: 'checks out',
          status: 'failed',
          error: 'TimeoutError: locator.click: Timeout 30000ms exceeded.',
          duration: 1500,
          location: 'tests/checkout.spec.ts:8:3',
          workerIndex: 0,
          shardIndex: 2,
          startedAt: NOW + 100,
          steps: [
            {
              title: 'Expect',
              subtitle: "getByText('Thank you')",
              category: 'expect',
              duration: 1200,
              startTime: NOW + 200,
              failed: true,
              error: { message: 'Timed out' },
            },
          ],
        },
      ],
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).runId ?? (await res.json()).id;
}

test.describe('perfetto export', () => {
  test('exports the whole run as a Trace Event Format file', async ({ request }) => {
    const runId = await submitShardedRun(request);

    const res = await request.get(`/api/test-runs/${runId}/perfetto`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(res.headers()['content-disposition']).toContain('attachment');
    expect(res.headers()['content-disposition']).toContain(`piwi-run-${runId}-perfetto.json`);

    const trace = await res.json();
    expect(trace.displayTimeUnit).toBe('ms');
    expect(Array.isArray(trace.traceEvents)).toBe(true);
    expect(trace.metadata.source).toBe('piwi');
    expect(trace.metadata['run-id']).toBe(runId);

    // Two shards → two processes; each execution is a complete slice.
    const processNames = trace.traceEvents
      .filter((e: { name: string }) => e.name === 'process_name')
      .map((e: { args: { name: string } }) => e.args.name)
      .sort();
    expect(processNames).toEqual(['Shard 1', 'Shard 2']);

    const slices = trace.traceEvents.filter((e: { ph: string; cat: string }) => e.ph === 'X' && e.cat === 'test');
    expect(slices.map((e: { name: string }) => e.name).sort()).toEqual(['adds an item to the cart', 'checks out']);

    // The failing execution contributes an instant "moment of failure" event.
    const instant = trace.traceEvents.find((e: { ph: string }) => e.ph === 'i');
    expect(instant?.name).toBe('failed');

    // A step is nested under its execution, named with its subtitle.
    const nav = trace.traceEvents.find((e: { name: string }) => e.name.startsWith('Navigate'));
    expect(nav?.name).toBe('Navigate https://shop.test/cart');
  });

  test('exports one execution as a Trace Event Format file', async ({ request }) => {
    const runId = await submitShardedRun(request);
    const detail = await (await request.get(`/api/test-runs/${runId}`)).json();
    const execution = detail.testCases.find((c: { title: string }) => c.title === 'checks out');
    expect(execution, 'the run should have the checkout execution').toBeTruthy();

    const res = await request.get(`/api/test-run-cases/${execution.executionId}/perfetto`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-disposition']).toContain(`piwi-execution-${execution.executionId}-perfetto.json`);

    const trace = await res.json();
    expect(trace.metadata.scope).toBe('execution');
    const slice = trace.traceEvents.find((e: { cat: string; ph: string }) => e.cat === 'test' && e.ph === 'X');
    expect(slice.name).toBe('checks out');
    expect(slice.args.status).toBe('failed');
    expect(slice.args.url).toContain(`/test-run-cases/${execution.executionId}`);
  });

  test('404s for a run that does not exist', async ({ request }) => {
    const missing = await request.get('/api/test-runs/99999999/perfetto');
    expect(missing.status()).toBe(404);
  });
});
