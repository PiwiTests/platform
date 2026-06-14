import { test, expect } from './fixtures';
import { PROJECT } from '../shared/test-project-names';

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
            title: 'streaming test 1',
            status: 'passed',
            duration: 1200,
            location: 'tests/streaming.spec.ts:5:3',
            retries: 0,
          },
          {
            title: 'streaming test 2',
            status: 'failed',
            duration: 800,
            location: 'tests/streaming.spec.ts:12:3',
            error: 'Expected true but got false',
            retries: 1,
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
