import { test, expect } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

/**
 * Tests for the live-streaming lifecycle:
 *   POST /api/test-runs/start       – create a run in 'running' state
 *   POST /api/test-runs/:id/events  – push test-case results (batch)
 *   POST /api/test-runs/:id/finish  – finalize the run
 *   GET  /api/test-runs/:id/stream  – SSE endpoint (init event check)
 *   GET  /api/test-runs/:id         – streamToken must NOT appear in response
 */
test.describe.serial('Streaming API Tests', () => {
  let runId: number;
  let streamToken: string;

  // ── /start ──────────────────────────────────────────────────────────────────

  test('POST /api/test-runs/start creates a run with running status', async ({ request }) => {
    const response = await request.post('/api/test-runs/start', {
      data: {
        projectName: PROJECT.STREAMING_TEST,
        startTime: new Date().toISOString(),
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(typeof data.runId).toBe('number');
    expect(typeof data.streamToken).toBe('string');
    expect(data.streamToken.length).toBeGreaterThan(0);

    runId = data.runId;
    streamToken = data.streamToken;
  });

  test('GET /api/test-runs/:id returns running status and no streamToken', async ({ request }) => {
    const response = await request.get(`/api/test-runs/${runId}`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.status).toBe('running');
    // streamToken must never be exposed to clients
    expect(data.streamToken).toBeUndefined();
  });

  // ── /events ─────────────────────────────────────────────────────────────────

  test('POST /api/test-runs/:id/events accepts a batch of test cases', async ({ request }) => {
    const response = await request.post(`/api/test-runs/${runId}/events`, {
      data: {
        streamToken,
        testCases: [
          {
            type: 'complete',
            title: 'streaming test 1',
            status: 'passed',
            duration: 1200,
            location: 'tests/streaming.spec.ts:5:3',
            retries: 0,
          },
          {
            type: 'complete',
            title: 'streaming test 2',
            status: 'failed',
            duration: 800,
            location: 'tests/streaming.spec.ts:12:3',
            error: 'Expected true but got false',
            retries: 1,
            attempts: [
              { retry: 0, status: 'failed', duration: 500, startedAt: 1700000000000 },
              { retry: 1, status: 'failed', duration: 800, startedAt: 1700000001000 },
            ],
          },
        ],
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.processed).toBe(2);
  });

  test('POST /api/test-runs/:id/events updates run counters atomically', async ({ request }) => {
    const runResponse = await request.get(`/api/test-runs/${runId}`);
    expect(runResponse.ok()).toBeTruthy();
    const run = await runResponse.json();

    expect(run.totalTests).toBe(2);
    expect(run.passedTests).toBe(1);
    expect(run.failedTests).toBe(1);
  });

  test('POST /api/test-runs/:id/events persists per-attempt outcomes', async ({ request }) => {
    const runResponse = await request.get(`/api/test-runs/${runId}`);
    expect(runResponse.ok()).toBeTruthy();
    const run = await runResponse.json();

    const failing = run.testCases.find((tc: { title: string }) => tc.title === 'streaming test 2');
    expect(failing).toBeDefined();
    expect(failing.attempts).toEqual([
      { retry: 0, status: 'failed', duration: 500, startedAt: 1700000000000 },
      { retry: 1, status: 'failed', duration: 800, startedAt: 1700000001000 },
    ]);
  });

  test('POST /api/test-runs/:id/events rejects a wrong stream token', async ({ request }) => {
    const response = await request.post(`/api/test-runs/${runId}/events`, {
      data: {
        streamToken: 'wrong-token',
        testCases: [{ title: 'sneaky test', status: 'passed', duration: 100, location: 'x.spec.ts:1:1' }],
      },
    });

    expect(response.status()).toBe(403);
  });

  test('POST /api/test-runs/:id/events rejects a missing stream token', async ({ request }) => {
    const response = await request.post(`/api/test-runs/${runId}/events`, {
      data: {
        testCases: [{ title: 'sneaky test', status: 'passed', duration: 100, location: 'x.spec.ts:1:1' }],
      },
    });

    expect(response.status()).toBe(401);
  });

  test('POST /api/test-runs/:id/events handles Windows-style paths correctly', async ({ request }) => {
    const response = await request.post(`/api/test-runs/${runId}/events`, {
      data: {
        streamToken,
        testCases: [
          {
            type: 'complete',
            title: 'windows path test',
            status: 'passed',
            duration: 500,
            // Simulate a Windows-style path; the `:` in `C:` must not be confused with line/column
            location: 'C:\\repo\\tests\\windows.spec.ts:20:5',
            retries: 0,
          },
        ],
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.processed).toBe(1);
  });

  // ── /stream (SSE) ───────────────────────────────────────────────────────────

  test('streamed test-completed events carry the persisted execution id', async ({ request, baseURL }) => {
    // Subscribe before posting so the in-memory bus has a live listener.
    const controller = new AbortController();
    const response = await fetch(`${baseURL}/api/test-runs/${runId}/stream`, {
      signal: controller.signal,
    });
    expect(response.ok).toBeTruthy();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let streamed: { executionId: number | null; testCaseId: number | null } | null = null;

    try {
      const postRes = await request.post(`/api/test-runs/${runId}/events`, {
        data: {
          streamToken,
          testCases: [
            {
              type: 'complete',
              title: 'streamed deep-link test',
              status: 'failed',
              duration: 300,
              location: 'tests/streaming.spec.ts:30:3',
              error: 'Expected true but got false',
              retries: 0,
            },
          ],
        },
      });
      expect(postRes.ok()).toBeTruthy();

      while (streamed === null) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        for (const chunk of text.split('\n\n')) {
          const line = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          let parsed: { type?: string; data?: Record<string, unknown> };
          try {
            parsed = JSON.parse(line.slice('data:'.length).trim());
          } catch {
            continue;
          }
          if (parsed.type === 'test-completed' && parsed.data?.title === 'streamed deep-link test') {
            streamed = {
              executionId: typeof parsed.data.executionId === 'number' ? parsed.data.executionId : null,
              testCaseId: typeof parsed.data.testCaseId === 'number' ? parsed.data.testCaseId : null,
            };
          }
        }
        // Hard cap so a regression cannot hang the suite
        if (text.length > 65536) break;
      }
    } finally {
      reader.releaseLock();
      controller.abort();
    }

    expect(streamed).not.toBeNull();
    expect(streamed!.executionId).toBeGreaterThan(0);
    expect(streamed!.testCaseId).toBeGreaterThan(0);

    // The streamed id is the same execution the run's REST payload reports.
    const runResponse = await request.get(`/api/test-runs/${runId}`);
    expect(runResponse.ok()).toBeTruthy();
    const run = await runResponse.json();
    const matching = run.testCases.find((tc: { title: string }) => tc.title === 'streamed deep-link test');
    expect(matching.executionId).toBe(streamed!.executionId);
  });

  test('GET /api/test-runs/:id/stream sends an init event', async ({ baseURL }) => {
    // Use native fetch with AbortController so we can read just the init event
    // without waiting for the infinite SSE stream to close.
    const controller = new AbortController();
    const response = await fetch(`${baseURL}/api/test-runs/${runId}/stream`, {
      signal: controller.signal,
    });

    expect(response.ok).toBeTruthy();
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    // Read chunks until we have at least one complete data line
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        // Stop as soon as we have the init event
        if (text.includes('"type":"init"')) break;
      }
    } finally {
      reader.releaseLock();
      controller.abort();
    }

    // The stream should start with a data: line containing a JSON object
    expect(text).toContain('data:');
    const firstDataLine = text.split('\n').find((l: string) => l.startsWith('data:'));
    expect(firstDataLine).toBeDefined();

    const parsed = JSON.parse(firstDataLine!.slice('data:'.length).trim());
    expect(parsed.type).toBe('init');
    expect(parsed.data.id).toBe(runId);
    expect(parsed.data.status).toBe('running');
    expect(typeof parsed.data.totalTests).toBe('number');
  });

  test('GET /api/test-runs/:id/stream forwards step events for test-attached steps', async ({ request, baseURL }) => {
    // Subscribe first — the in-memory bus only delivers to live subscribers.
    const controller = new AbortController();
    const response = await fetch(`${baseURL}/api/test-runs/${runId}/stream`, {
      signal: controller.signal,
    });
    expect(response.ok).toBeTruthy();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let sawStepBegin = false;
    let sawStepEnd = false;
    let sawHookBegin = false;
    let sawHookEnd = false;

    const postStepEvents = async () => {
      const res = await request.post(`/api/test-runs/${runId}/events`, {
        data: {
          streamToken,
          testCases: [
            {
              type: 'step-begin',
              title: 'expect(locator).toBeVisible()',
              location: 'tests/streaming.spec.ts:8:5',
              stepCategory: 'pw:expect',
              parentTitle: 'streaming test 1',
              workerIndex: 0,
              startedAt: 1700000000000,
            },
            {
              type: 'step-begin',
              title: 'beforeEach',
              location: 'tests/streaming.spec.ts:2:3',
              stepCategory: 'hook',
              parentTitle: null,
              workerIndex: 0,
              startedAt: 1700000000100,
            },
            {
              type: 'step-end',
              title: 'expect(locator).toBeVisible()',
              location: 'tests/streaming.spec.ts:8:5',
              stepCategory: 'pw:expect',
              status: 'passed',
              duration: 40,
              parentTitle: 'streaming test 1',
              workerIndex: 0,
              startedAt: 1700000000000,
            },
            {
              type: 'step-end',
              title: 'beforeEach',
              location: 'tests/streaming.spec.ts:2:3',
              stepCategory: 'hook',
              status: 'passed',
              duration: 20,
              parentTitle: null,
              workerIndex: 0,
              startedAt: 1700000000100,
            },
          ],
        },
      });
      expect(res.ok()).toBeTruthy();
    };

    try {
      await postStepEvents();
      while (!(sawStepBegin && sawStepEnd && sawHookBegin && sawHookEnd)) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.includes('"type":"step-begin"') && text.includes('expect(locator).toBeVisible()')) sawStepBegin = true;
        if (text.includes('"type":"step-end"')) sawStepEnd = true;
        if (text.includes('"type":"test-begin"') && text.includes('"filePath":"hooks"')) sawHookBegin = true;
        if (text.includes('"type":"test-completed"') && text.includes('"filePath":"hooks"')) sawHookEnd = true;
        // Hard cap so a regression cannot hang the suite
        if (text.length > 65536) break;
      }
    } finally {
      reader.releaseLock();
      controller.abort();
    }

    // Test-attached steps stream as step-begin/step-end with their category.
    expect(sawStepBegin).toBeTruthy();
    expect(sawStepEnd).toBeTruthy();
    // Suite-level hooks keep the timeline shape (test-begin/test-completed, filePath 'hooks').
    expect(sawHookBegin).toBeTruthy();
    expect(sawHookEnd).toBeTruthy();
  });

  // ── /finish ──────────────────────────────────────────────────────────────────

  test('POST /api/test-runs/:id/finish finalizes the run', async ({ request }) => {
    const response = await request.post(`/api/test-runs/${runId}/finish`, {
      data: {
        streamToken,
        status: 'failed',
        duration: 5000,
        totalTests: 3,
        passedTests: 2,
        failedTests: 1,
        skippedTests: 0,
        flakyTests: 0,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe('failed');
  });

  test('GET /api/test-runs/:id shows finalized run without streamToken', async ({ request }) => {
    const response = await request.get(`/api/test-runs/${runId}`);
    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.status).toBe('failed');
    expect(data.streamToken).toBeUndefined();
    // Counters set by /finish should be reflected
    expect(data.totalTests).toBe(3);
    expect(data.passedTests).toBe(2);
    expect(data.failedTests).toBe(1);
    expect(data.flakyTests).toBe(0);
  });

  test('POST /api/test-runs/:id/events is rejected after run is finalized', async ({ request }) => {
    const response = await request.post(`/api/test-runs/${runId}/events`, {
      data: {
        streamToken,
        testCases: [{ title: 'late test', status: 'passed', duration: 100, location: 'x.spec.ts:1:1' }],
      },
    });

    // Run is no longer 'running', so this should be rejected
    expect(response.status()).toBe(409);
  });

  // ── edge cases ───────────────────────────────────────────────────────────────

  test('POST /api/test-runs/start rejects missing projectName', async ({ request }) => {
    const response = await request.post('/api/test-runs/start', {
      data: { startTime: new Date().toISOString() },
    });

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(400);
  });

  test('POST /api/test-runs/:id/finish preserves flakyTests of 0 explicitly', async ({ request }) => {
    // Create a fresh run
    const startResp = await request.post('/api/test-runs/start', {
      data: { projectName: PROJECT.STREAMING_FLAKY, startTime: new Date().toISOString() },
    });
    const { runId: freshRunId, streamToken: freshToken } = await startResp.json();

    const finishResp = await request.post(`/api/test-runs/${freshRunId}/finish`, {
      data: {
        streamToken: freshToken,
        status: 'passed',
        duration: 1000,
        flakyTests: 0,
      },
    });
    expect(finishResp.ok()).toBeTruthy();

    const detailsResp = await request.get(`/api/test-runs/${freshRunId}`);
    const details = await detailsResp.json();
    expect(details.flakyTests).toBe(0);
  });

  test('POST /api/test-runs/:id/finish with duration 0 does not fall back to elapsed time', async ({ request }) => {
    const startResp = await request.post('/api/test-runs/start', {
      data: { projectName: PROJECT.STREAMING_DURATION, startTime: new Date().toISOString() },
    });
    const { runId: freshRunId, streamToken: freshToken } = await startResp.json();

    const finishResp = await request.post(`/api/test-runs/${freshRunId}/finish`, {
      data: {
        streamToken: freshToken,
        status: 'passed',
        duration: 0,
      },
    });
    expect(finishResp.ok()).toBeTruthy();

    const detailsResp = await request.get(`/api/test-runs/${freshRunId}`);
    const details = await detailsResp.json();
    // duration: 0 must be preserved, not replaced with elapsed time
    expect(details.duration).toBe(0);
  });
});

// ── /heartbeat ────────────────────────────────────────────────────────────────

test.describe.serial('Heartbeat API Tests', () => {
  let runId: number;
  let streamToken: string;

  test.beforeAll(async ({ request }) => {
    const startResp = await request.post('/api/test-runs/start', {
      data: { projectName: PROJECT.HEARTBEAT_TEST, startTime: new Date().toISOString() },
    });
    expect(startResp.ok()).toBeTruthy();
    const data = await startResp.json();
    runId = data.runId;
    streamToken = data.streamToken;
  });

  test('POST /api/test-runs/:id/heartbeat with a valid token bumps updatedAt and returns success', async ({
    request,
  }) => {
    const before = await (await request.get(`/api/test-runs/${runId}`)).json();

    // Ensure a measurable clock tick between the two updatedAt values.
    await new Promise((r) => setTimeout(r, 1100));

    const response = await request.post(`/api/test-runs/${runId}/heartbeat`, {
      data: { streamToken },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toEqual({ success: true });

    const after = await (await request.get(`/api/test-runs/${runId}`)).json();
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt).getTime());
    // The run itself is left untouched otherwise (still running).
    expect(after.status).toBe('running');
  });

  test('POST /api/test-runs/:id/heartbeat rejects a missing stream token with 401', async ({ request }) => {
    const response = await request.post(`/api/test-runs/${runId}/heartbeat`, {
      data: {},
    });
    expect(response.status()).toBe(401);
    const data = await response.json();
    expect(data.message).toContain('Missing stream token');
  });

  test('POST /api/test-runs/:id/heartbeat rejects a wrong stream token with 403', async ({ request }) => {
    const response = await request.post(`/api/test-runs/${runId}/heartbeat`, {
      data: { streamToken: 'not-the-right-token' },
    });
    expect(response.status()).toBe(403);
    const data = await response.json();
    expect(data.message).toContain('Invalid stream token');
  });

  test('POST /api/test-runs/:id/heartbeat returns 404 for a non-existent run', async ({ request }) => {
    const response = await request.post('/api/test-runs/999999/heartbeat', {
      data: { streamToken: 'anything' },
    });
    expect(response.status()).toBe(404);
  });

  test('POST /api/test-runs/:id/heartbeat returns 400 for a non-numeric run id', async ({ request }) => {
    const response = await request.post('/api/test-runs/not-a-number/heartbeat', {
      data: { streamToken: 'anything' },
    });
    expect(response.status()).toBe(400);
  });
});

// ── /summary ─────────────────────────────────────────────────────────────────

test.describe.serial('Test Run Summary API Tests', () => {
  let runId: number;

  test.beforeAll(async ({ request }) => {
    const response = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.RUN_SUMMARY_TEST,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 3000,
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          { title: 'case A', status: 'passed', duration: 500, location: 'tests/a.spec.ts:10:5' },
          { title: 'case B', status: 'failed', duration: 700, location: 'tests/b.spec.ts:20:3', error: 'boom' },
        ],
      },
    });
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    runId = data.runId;
  });

  test('GET /api/test-runs/:id/summary returns run metadata without the stream token', async ({ request }) => {
    const response = await request.get(`/api/test-runs/${runId}/summary`);
    expect(response.ok()).toBeTruthy();
    const summary = await response.json();

    expect(summary.id).toBe(runId);
    expect(summary.status).toBe('failed');
    expect(summary.totalTests).toBe(2);
    expect(summary.passedTests).toBe(1);
    expect(summary.failedTests).toBe(1);
    expect(summary.avgTestDuration).toBe(600);
    expect(summary.streamToken).toBeUndefined();
  });

  test('GET /api/test-runs/:id/summary includes lightweight per-case info', async ({ request }) => {
    const response = await request.get(`/api/test-runs/${runId}/summary`);
    const summary = await response.json();

    expect(Array.isArray(summary.testCases)).toBe(true);
    expect(summary.testCases).toHaveLength(2);

    const byTitle = Object.fromEntries(summary.testCases.map((tc: { title: string }) => [tc.title, tc]));
    expect(byTitle['case A']).toMatchObject({
      title: 'case A',
      status: 'passed',
      duration: 500,
      location: 'tests/a.spec.ts:10:5',
    });
    expect(byTitle['case B']).toMatchObject({
      title: 'case B',
      status: 'failed',
      duration: 700,
      location: 'tests/b.spec.ts:20:3',
    });
    // The summary is intentionally lightweight — no error text, no clustering info.
    expect(byTitle['case B'].error).toBeUndefined();
  });

  test('GET /api/test-runs/:id/summary returns 404 for a non-existent run', async ({ request }) => {
    const response = await request.get('/api/test-runs/999999/summary');
    expect(response.status()).toBe(404);
  });

  test('GET /api/test-runs/:id/summary returns 400 for a non-numeric run id', async ({ request }) => {
    const response = await request.get('/api/test-runs/not-a-number/summary');
    expect(response.status()).toBe(400);
  });
});
