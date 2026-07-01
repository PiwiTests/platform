import { test, expect } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

test.describe.serial('Test Case History API', () => {
  let firstRunId: number;
  let secondRunId: number;
  let thirdRunId: number;
  let testRunsCaseId: number;
  let stableTestCaseId: number;

  test('should submit multiple runs for history testing', async ({ request }) => {
    // Run 1
    const res1 = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.HISTORY,
        status: 'passed',
        startTime: new Date(Date.now() - 120000).toISOString(),
        duration: 30000,
        totalTests: 2,
        passedTests: 2,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'history test alpha',
            status: 'passed',
            duration: 1000,
            location: 'tests/history.spec.ts:1:1',
            retries: 0,
          },
          {
            title: 'history test beta',
            status: 'passed',
            duration: 2000,
            location: 'tests/history.spec.ts:2:1',
            retries: 0,
          },
        ],
      },
    });
    expect(res1.ok()).toBeTruthy();
    const data1 = await res1.json();
    firstRunId = data1.testRunId;

    // Run 2 — same test cases, different durations, one failure
    const res2 = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.HISTORY,
        status: 'failed',
        startTime: new Date(Date.now() - 60000).toISOString(),
        duration: 40000,
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'history test alpha',
            status: 'passed',
            duration: 1200,
            location: 'tests/history.spec.ts:1:1',
            retries: 0,
          },
          {
            title: 'history test beta',
            status: 'failed',
            duration: 5000,
            location: 'tests/history.spec.ts:2:1',
            error: 'Expected something but got nothing',
            retries: 2,
          },
        ],
      },
    });
    expect(res2.ok()).toBeTruthy();
    const data2 = await res2.json();
    secondRunId = data2.testRunId;

    // Run 3 — test alpha passes with different duration
    const res3 = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.HISTORY,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 25000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'history test alpha',
            status: 'passed',
            duration: 900,
            location: 'tests/history.spec.ts:1:1',
            retries: 1,
          },
        ],
      },
    });
    expect(res3.ok()).toBeTruthy();
    const data3 = await res3.json();
    thirdRunId = data3.testRunId;
  });

  test('should return history for a test case across all runs', async ({ request }) => {
    // Get the test run details to find the test_runs_case ID
    const runRes = await request.get(`/api/test-runs/${firstRunId}`);
    expect(runRes.ok()).toBeTruthy();
    const runData = await runRes.json();
    const testCase = runData.testCases.find((tc: { title: string }) => tc.title === 'history test alpha');
    expect(testCase).toBeDefined();
    testRunsCaseId = testCase.id;

    // Resolve the stable test_case.id from the execution detail
    const execRes = await request.get(`/api/test-run-cases/${testRunsCaseId}`);
    expect(execRes.ok()).toBeTruthy();
    const execData = await execRes.json();
    expect(execData.testCaseId).toBeDefined();
    stableTestCaseId = execData.testCaseId;

    // Fetch history via the stable test case ID
    const historyRes = await request.get(`/api/test-cases/${stableTestCaseId}/history`);
    expect(historyRes.ok()).toBeTruthy();
    const history = await historyRes.json();

    // Should have at least 3 entries (concurrent browser runs create additional history entries)
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(3);

    // Sorted by startTime descending (newest first)
    expect(new Date(history[0].startTime).getTime()).toBeGreaterThanOrEqual(new Date(history[1].startTime).getTime());

    // Verify all fields are present
    for (const entry of history) {
      expect(entry.id).toBeDefined();
      expect(entry.runId).toBeDefined();
      expect(entry.status).toBeDefined();
      expect(entry.runStatus).toBeDefined();
      expect(entry.startTime).toBeDefined();
    }
  });

  test('should include duration, error, and retries in history entries', async ({ request }) => {
    const historyRes = await request.get(`/api/test-cases/${stableTestCaseId}/history`);
    const history = await historyRes.json();

    // "history test alpha" was in all 3 runs
    // Run 1: alpha passed 1000ms, 0 retries, run status passed
    // Run 2: alpha passed 1200ms, 0 retries, run status failed (beta failed)
    // Run 3: alpha passed 900ms, 1 retry, run status passed

    // Check run 1 entry
    const run1Entry = history.find((h: { runId: number }) => h.runId === firstRunId);
    expect(run1Entry).toBeDefined();
    expect(run1Entry.duration).toBe(1000);
    expect(run1Entry.error).toBeNull();
    expect(run1Entry.retries).toBe(0);
    expect(run1Entry.runStatus).toBe('passed');
    expect(run1Entry.status).toBe('passed');

    // Check run 2 entry (alpha passed but overall run failed due to beta)
    const run2Entry = history.find((h: { runId: number }) => h.runId === secondRunId);
    expect(run2Entry).toBeDefined();
    expect(run2Entry.duration).toBe(1200);
    expect(run2Entry.retries).toBe(0);
    expect(run2Entry.runStatus).toBe('failed');
    expect(run2Entry.status).toBe('passed');

    // Check run 3 entry (alpha passed with retries)
    const run3Entry = history.find((h: { runId: number }) => h.runId === thirdRunId);
    expect(run3Entry).toBeDefined();
    expect(run3Entry.duration).toBe(900);
    expect(run3Entry.retries).toBe(1);
    expect(run3Entry.runStatus).toBe('passed');
    expect(run3Entry.status).toBe('passed');
  });

  test('should return 404 for non-existent test case', async ({ request }) => {
    const response = await request.get('/api/test-cases/99999/history');
    expect(response.status()).toBe(404);
  });

  test('should return 400 for invalid ID', async ({ request }) => {
    const response = await request.get('/api/test-cases/abc/history');
    expect(response.status()).toBe(400);
  });

  test('should handle test case with single run', async ({ request }) => {
    // Submit a single run with a unique test case
    const res = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.HISTORY,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 5000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          {
            title: 'history test single',
            status: 'passed',
            duration: 500,
            location: 'tests/single.spec.ts:1:1',
            retries: 0,
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // Get the test_runs_case ID
    const runRes = await request.get(`/api/test-runs/${data.testRunId}`);
    const runData = await runRes.json();
    const tc = runData.testCases.find((t: { title: string }) => t.title === 'history test single');

    // Resolve stable test_case.id
    const execRes = await request.get(`/api/test-run-cases/${tc.id}`);
    const execData = await execRes.json();
    const stableId = execData.testCaseId;

    // Fetch history — should have at least 1 entry (concurrent browser runs may add more)
    const historyRes = await request.get(`/api/test-cases/${stableId}/history`);
    expect(historyRes.ok()).toBeTruthy();
    const history = await historyRes.json();
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeGreaterThanOrEqual(1);
    // Verify the entry from our specific run
    const myEntry = history.find((h: { runId: number }) => h.runId === data.testRunId);
    expect(myEntry).toBeDefined();
    expect(myEntry.status).toBe('passed');
    expect(myEntry.duration).toBe(500);
  });
});
