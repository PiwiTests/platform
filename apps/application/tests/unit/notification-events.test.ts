import { describe, test, expect } from 'vitest';
import {
  renderEventSubject,
  notificationTargetPath,
  buildNotificationDedupeKey,
  buildTopFailures,
  truncateExcerpt,
  errorExcerpt,
  failureTargetPath,
  TOP_FAILURES_LIMIT,
  ERROR_EXCERPT_MAX,
  type RunFinishedPayload,
  type ClusterNewPayload,
} from '#shared/notification-events';

const runPayload: RunFinishedPayload = {
  runId: 1,
  projectId: 2,
  projectName: 'my-project',
  status: 'failed',
  totalTests: 10,
  failedTests: 2,
  passedTests: 8,
  flakyTests: 0,
};

const clusterPayload: ClusterNewPayload = {
  clusterId: 5,
  projectId: 2,
  projectName: 'my-project',
  signature: 'TimeoutError: locator not visible',
  runId: 1,
};

describe('renderEventSubject', () => {
  test('run.finished / run.failed / run.failed.default_branch include the run status and project', () => {
    expect(renderEventSubject('run.finished', runPayload)).toBe('Test run failed — my-project');
    expect(renderEventSubject('run.failed', runPayload)).toBe('Test run failed — my-project');
    expect(renderEventSubject('run.failed.default_branch', runPayload)).toBe('Test run failed — my-project');
  });

  test('appends the branch name in parentheses when present', () => {
    expect(renderEventSubject('run.finished', { ...runPayload, branch: 'main' })).toBe(
      'Test run failed — my-project (main)',
    );
  });

  test('cluster.new names the project, not the signature', () => {
    expect(renderEventSubject('cluster.new', clusterPayload)).toBe('New failure cluster — my-project');
  });

  test('cluster.fixed names the verdict, cluster.regressed the regression', () => {
    const base = { clusterId: 5, projectId: 2, projectName: 'my-project', signature: 'sig', runId: 9 };
    expect(renderEventSubject('cluster.fixed', { ...base, verification: 'diagnosis-verified' })).toBe(
      'Diagnosis verified — my-project',
    );
    expect(renderEventSubject('cluster.fixed', { ...base, verification: 'stopped-failing' })).toBe(
      'Cluster stopped failing — my-project',
    );
    expect(renderEventSubject('cluster.regressed', { ...base, fixLandedRunId: 7 })).toBe('Fix regressed — my-project');
  });

  test('cluster.fixed and cluster.regressed link to the cluster and dedupe per cluster and run', () => {
    const base = { clusterId: 5, projectId: 2, projectName: 'my-project', signature: 'sig', runId: 9 };
    const fixed = { ...base, verification: 'stopped-failing' as const };
    expect(notificationTargetPath('cluster.fixed', fixed)).toBe('/failure-clusters/5');
    expect(notificationTargetPath('cluster.regressed', { ...base, fixLandedRunId: 7 })).toBe('/failure-clusters/5');
    expect(buildNotificationDedupeKey('cluster.fixed', fixed, 3)).toBe('cluster.fixed:c5:r9:3');
    expect(buildNotificationDedupeKey('cluster.fixed', { ...fixed, runId: 10 }, 3)).not.toBe(
      buildNotificationDedupeKey('cluster.fixed', fixed, 3),
    );
    expect(buildNotificationDedupeKey('cluster.regressed', { ...base, fixLandedRunId: 7 }, 3)).toBe(
      'cluster.regressed:c5:r9:3',
    );
  });

  test('flakiness.spike and perf.regression produce distinct subjects', () => {
    expect(renderEventSubject('flakiness.spike', runPayload)).toBe('Flakiness spike — my-project');
    expect(renderEventSubject('perf.regression', runPayload)).toBe('Performance regression — my-project');
  });

  test('auto_heal.pr_opened names the PR number and project', () => {
    expect(
      renderEventSubject('auto_heal.pr_opened', {
        projectId: 2,
        projectName: 'my-project',
        runId: 1,
        prNumber: 42,
        prUrl: 'https://github.com/acme/app/pull/42',
        branch: 'piwi/heal/1-abc',
        editCount: 1,
      }),
    ).toBe('Auto-heal opened PR #42 — my-project');
  });

  test('perf.regression includes the slowdown when the payload carries it', () => {
    expect(renderEventSubject('perf.regression', { ...runPayload, regressionPct: 34 })).toBe(
      'Performance regression — my-project (+34% slower)',
    );
  });
});

describe('truncateExcerpt', () => {
  test('returns undefined for empty/whitespace input', () => {
    expect(truncateExcerpt(undefined)).toBeUndefined();
    expect(truncateExcerpt(null)).toBeUndefined();
    expect(truncateExcerpt('   \n  ')).toBeUndefined();
  });

  test('strips ANSI colour codes and trims', () => {
    const esc = String.fromCharCode(27);
    expect(truncateExcerpt(`  ${esc}[31mError${esc}[0m: boom  `)).toBe('Error: boom');
  });

  test('caps to ERROR_EXCERPT_MAX with an ellipsis', () => {
    const long = 'x'.repeat(ERROR_EXCERPT_MAX + 50);
    const out = truncateExcerpt(long)!;
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBe(ERROR_EXCERPT_MAX + 1); // max chars + ellipsis
  });
});

const TIMEOUT_ERROR = `TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Submit' })
  - locator resolved to <button disabled>Submit</button>
  - attempting click action
  - waiting for element to be visible, enabled and stable
  - element is not enabled
  - retrying click action
  - waiting for getByRole('button', { name: 'Submit' })
  - locator resolved to <button disabled>Submit</button>

    at tests/checkout.spec.ts:12:40`;

const ASSERTION_ERROR = `Error: expect(locator).toBeVisible() failed

Locator: getByText('Order confirmed')
Expected: visible
Received: <element(s) not found>
Timeout: 5000ms

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('Order confirmed')

    at tests/checkout.spec.ts:20:45
    at node_modules/@playwright/test/lib/worker.js:1:1`;

describe('errorExcerpt', () => {
  test('returns undefined for empty input', () => {
    expect(errorExcerpt(undefined)).toBeUndefined();
    expect(errorExcerpt('  \n ')).toBeUndefined();
  });

  test('quotes the message head without the call log or the stack', () => {
    expect(errorExcerpt(ASSERTION_ERROR)).toBe(
      [
        'Error: expect(locator).toBeVisible() failed',
        "Locator: getByText('Order confirmed')",
        'Expected: visible',
        'Received: <element(s) not found>',
        'Timeout: 5000ms',
      ].join('\n'),
    );
  });

  test('appends the last call-log state line to a bare timeout', () => {
    expect(errorExcerpt(TIMEOUT_ERROR)).toBe(
      'TimeoutError: locator.click: Timeout 30000ms exceeded.\nlocator resolved to <button disabled>Submit</button>',
    );
    expect(errorExcerpt("Test timeout of 30000ms exceeded.\nCall log:\n  - waiting for getByTestId('cart')\n")).toBe(
      "Test timeout of 30000ms exceeded.\nwaiting for getByTestId('cart')",
    );
  });

  test('leaves a bare timeout alone when there is no call log', () => {
    expect(errorExcerpt('Test timeout of 30000ms exceeded.')).toBe('Test timeout of 30000ms exceeded.');
  });

  test('strips ANSI codes and caps the result', () => {
    const esc = String.fromCharCode(27);
    expect(errorExcerpt(`${esc}[31mError: boom${esc}[0m`)).toBe('Error: boom');
    const out = errorExcerpt(`Error: ${'x'.repeat(400)}`, 50)!;
    expect(out.length).toBe(51);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('failureTargetPath', () => {
  test('prefers the execution over the test history page', () => {
    expect(failureTargetPath({ testCaseId: 5, executionId: 90 })).toBe('/test-run-cases/90');
    expect(failureTargetPath({ testCaseId: 5 })).toBe('/test-cases/5');
    expect(failureTargetPath({})).toBeNull();
  });
});

describe('buildTopFailures', () => {
  test('caps to the limit and maps fields, dropping empty ones', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      title: `test ${i}`,
      filePath: i === 0 ? 'tests/a.spec.ts' : null,
      error: i === 0 ? 'boom' : null,
      testCaseId: i,
      executionId: i + 100,
    }));
    const out = buildTopFailures(rows);
    expect(out).toHaveLength(TOP_FAILURES_LIMIT);
    expect(out[0]).toEqual({
      title: 'test 0',
      filePath: 'tests/a.spec.ts',
      headline: 'boom',
      errorExcerpt: 'boom',
      testCaseId: 0,
      executionId: 100,
    });
    // Row without filePath/error omits those keys entirely
    expect(out[1]).toEqual({ title: 'test 1', testCaseId: 1, executionId: 101 });
  });

  test('quotes the error head, not its call log', () => {
    const [failure] = buildTopFailures([{ title: 'a', error: TIMEOUT_ERROR }]);
    expect(failure!.errorExcerpt).toBe(
      'TimeoutError: locator.click: Timeout 30000ms exceeded.\nlocator resolved to <button disabled>Submit</button>',
    );
  });

  test('leads with the one-line headline built from the error', () => {
    const [timeout] = buildTopFailures([{ title: 'a', error: TIMEOUT_ERROR }]);
    expect(timeout!.headline).toBe("click on getByRole('button', { name: 'Submit' }) timed out after 30 s");
    const [assertion] = buildTopFailures([{ title: 'b', error: ASSERTION_ERROR }]);
    expect(assertion!.headline).toBe('Text "Order confirmed" never became visible (5 s)');
  });

  test('respects a custom limit', () => {
    const rows = [{ title: 'a' }, { title: 'b' }];
    expect(buildTopFailures(rows, 1)).toHaveLength(1);
  });
});
