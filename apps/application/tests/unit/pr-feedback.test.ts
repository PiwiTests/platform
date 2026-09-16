import { describe, test, expect } from 'vitest';
import {
  buildCommitStatus,
  buildPrComment,
  DEFAULT_PR_FEEDBACK,
  PR_COMMENT_MARKER,
  PR_EXCERPT_MAX,
  resolvePrFeedbackSettings,
  type PrFailureEntry,
  type PrSummaryInput,
} from '#shared/pr-feedback';
import { errorExcerpt } from '#shared/notification-events';

function entry(overrides: Partial<PrFailureEntry> = {}): PrFailureEntry {
  return {
    title: 'checkout applies the discount',
    filePath: 'tests/checkout.spec.ts',
    errorExcerpt: 'TimeoutError: locator.click: Timeout 30000ms exceeded',
    executionId: 901,
    ...overrides,
  };
}

function summary(overrides: Partial<PrSummaryInput> = {}): PrSummaryInput {
  return {
    runId: 42,
    runUrl: 'https://piwi.example.com/test-runs/42',
    projectName: 'checkout',
    status: 'passed',
    totalTests: 120,
    passedTests: 120,
    failedTests: 0,
    flakyTests: 0,
    durationMs: 65_000,
    newRegressions: [],
    preExisting: [],
    flaky: [],
    newClusters: [],
    fixedClusters: [],
    wastedMinutes: null,
    hasBaseline: true,
    ...overrides,
  };
}

describe('resolvePrFeedbackSettings', () => {
  test('defaults to off — posting to a pull request needs an explicit opt-in', () => {
    expect(DEFAULT_PR_FEEDBACK.enabled).toBe(false);
    expect(resolvePrFeedbackSettings(undefined).enabled).toBe(false);
    expect(resolvePrFeedbackSettings({}).enabled).toBe(false);
  });

  test('only an exact true enables it', () => {
    expect(resolvePrFeedbackSettings({ enabled: 'yes' as unknown as boolean }).enabled).toBe(false);
    expect(resolvePrFeedbackSettings({ enabled: true }).enabled).toBe(true);
  });

  test('comment and status default on, onlyOnFailure defaults off', () => {
    const resolved = resolvePrFeedbackSettings({ enabled: true });
    expect(resolved).toMatchObject({ comment: true, status: true, onlyOnFailure: false });
  });

  test('falls back to the default status context when blank', () => {
    expect(resolvePrFeedbackSettings({ statusContext: '   ' }).statusContext).toBe(DEFAULT_PR_FEEDBACK.statusContext);
  });

  test('trims and caps the status context', () => {
    expect(resolvePrFeedbackSettings({ statusContext: '  ci/piwi  ' }).statusContext).toBe('ci/piwi');
    expect(resolvePrFeedbackSettings({ statusContext: 'x'.repeat(200) }).statusContext).toHaveLength(80);
  });
});

describe('buildPrComment', () => {
  test('starts with the marker so the comment can be found and edited later', () => {
    expect(buildPrComment(summary()).startsWith(PR_COMMENT_MARKER)).toBe(true);
  });

  test('says so plainly when nothing failed', () => {
    const body = buildPrComment(summary());
    expect(body).toContain('✅');
    expect(body).toContain('No failures.');
  });

  test('names the selection when the run came from one', () => {
    const body = buildPrComment(summary({ selection: { key: 'smoke', testCount: 42 } }));
    expect(body).toContain('`smoke`');
    expect(body).toContain('42 tests');
  });

  test('says nothing about selections on an ordinary run', () => {
    expect(buildPrComment(summary())).not.toContain('Selection');
  });

  test('flags a lock held on two shards at once', () => {
    const body = buildPrComment(summary({ splitLocks: ['database'] }));
    expect(body).toContain('`database`');
    expect(body).toContain('two shards at once');
    expect(body).toContain('piwi run --shard');
  });

  test('says nothing about split locks when none crossed shards', () => {
    expect(buildPrComment(summary())).not.toContain('two shards at once');
  });

  test('separates new failures from pre-existing ones', () => {
    const body = buildPrComment(
      summary({
        status: 'failed',
        failedTests: 2,
        passedTests: 118,
        newRegressions: [entry({ title: 'broke by this change' })],
        preExisting: [entry({ title: 'already broken', executionId: 902 })],
      }),
    );
    expect(body).toContain('New failures (1)');
    expect(body).toContain('Pre-existing failures (1)');
    // The reviewer's own damage must come first.
    expect(body.indexOf('New failures')).toBeLessThan(body.indexOf('Pre-existing failures'));
  });

  test('links each failure to its execution on the dashboard origin', () => {
    const body = buildPrComment(summary({ failedTests: 1, newRegressions: [entry()] }));
    expect(body).toContain('https://piwi.example.com/test-run-cases/901');
  });

  test('surfaces the suggested locator, which is the actionable part', () => {
    const body = buildPrComment(
      summary({
        failedTests: 1,
        newRegressions: [entry({ suggestedLocator: "getByRole('button', { name: 'Save' })" })],
      }),
    );
    expect(body).toContain("💡 Try `getByRole('button', { name: 'Save' })` instead.");
  });

  test('shows owner and tags so a reader knows who to route it to', () => {
    const body = buildPrComment(
      summary({ failedTests: 1, newRegressions: [entry({ owner: '@checkout-team', tags: ['critical', 'smoke'] })] }),
    );
    expect(body).toContain('@checkout-team');
    expect(body).toContain('`@critical`');
  });

  test('truncates a long failure list rather than flooding the pull request', () => {
    const many = Array.from({ length: 9 }, (_, i) => entry({ title: `test ${i}`, executionId: i }));
    const body = buildPrComment(summary({ failedTests: 9, newRegressions: many }));
    expect(body).toContain('…and 4 more');
  });

  test('escapes a pipe so a test title cannot break the layout', () => {
    const body = buildPrComment(summary({ failedTests: 1, newRegressions: [entry({ title: 'a | b' })] }));
    expect(body).toContain('a \\| b');
  });

  test('quotes a timeout with where Playwright was waiting, the way notifications do', () => {
    const raw = `TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Pay' })
  - locator resolved to <button disabled>Pay</button>

    at tests/checkout.spec.ts:12:40`;
    const excerpt = errorExcerpt(raw, PR_EXCERPT_MAX)!;
    const body = buildPrComment(summary({ failedTests: 1, newRegressions: [entry({ errorExcerpt: excerpt })] }));
    expect(body).toContain(
      'TimeoutError: locator.click: Timeout 30000ms exceeded. locator resolved to <button disabled>Pay</button>',
    );
    expect(body).not.toContain('Call log');
    expect(body).not.toContain('checkout.spec.ts:12:40');
  });

  test('keeps a pull-request excerpt within its own cap', () => {
    const excerpt = errorExcerpt(`Error: ${'x'.repeat(500)}`, PR_EXCERPT_MAX)!;
    expect(excerpt.length).toBe(PR_EXCERPT_MAX + 1);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  test('flattens a multi-line error excerpt onto one line', () => {
    const body = buildPrComment(
      summary({ failedTests: 1, newRegressions: [entry({ errorExcerpt: 'line one\nline two' })] }),
    );
    expect(body).toContain('line one line two');
  });

  test('lists new failure clusters with their case counts', () => {
    const body = buildPrComment(
      summary({ failedTests: 3, newClusters: [{ id: 5, signature: 'Timeout waiting for selector', caseCount: 3 }] }),
    );
    expect(body).toContain('New failure clusters (1)');
    expect(body).toContain('https://piwi.example.com/failure-clusters/5');
    expect(body).toContain('3 tests');
  });

  test('explains why failures were not split when there is no baseline', () => {
    const body = buildPrComment(summary({ status: 'failed', failedTests: 2, hasBaseline: false }));
    expect(body).toContain('No previous green run');
  });

  test('omits the baseline caveat on a green run', () => {
    expect(buildPrComment(summary({ hasBaseline: false }))).not.toContain('No previous green run');
  });

  test('reports wasted CI minutes only when they are worth a line', () => {
    expect(buildPrComment(summary({ wastedMinutes: 4.2 }))).toContain('4.2 CI minutes');
    expect(buildPrComment(summary({ wastedMinutes: 0.3 }))).not.toContain('CI minutes');
    expect(buildPrComment(summary({ wastedMinutes: null }))).not.toContain('CI minutes');
  });

  test('degrades to plain titles when the run URL has no parseable origin', () => {
    const body = buildPrComment(
      summary({ runUrl: 'not-a-url', failedTests: 1, newRegressions: [entry({ title: 'plain' })] }),
    );
    // The failure entry keeps its title but loses the deep link, since there is
    // no origin to build one from.
    expect(body).toContain('- plain — `tests/checkout.spec.ts`');
    expect(body).not.toContain('test-run-cases');
  });
});

describe('buildPrComment — fixed clusters', () => {
  test('reports what this change closed, which is the answer to "did my fix work?"', () => {
    const body = buildPrComment(
      summary({
        fixedClusters: [
          {
            id: 9,
            label: 'Timeout waiting for #pay',
            testCount: 4,
            verification: 'stopped-failing',
            timeToResolutionMs: 3 * 60 * 60 * 1000,
          },
        ],
      }),
    );
    expect(body).toContain('Fixed by this change (1)');
    expect(body).toContain('https://piwi.example.com/failure-clusters/9');
    expect(body).toContain('4 tests');
    expect(body).toContain('open 3h');
  });

  test('calls out when the change matched the diagnosed file', () => {
    const body = buildPrComment(
      summary({
        fixedClusters: [
          { id: 9, label: 'Timeout', testCount: 1, verification: 'diagnosis-verified', timeToResolutionMs: null },
        ],
      }),
    );
    expect(body).toContain('matches the diagnosed change');
  });

  test('says nothing when no cluster was closed', () => {
    expect(buildPrComment(summary())).not.toContain('Fixed by this change');
    expect(buildPrComment(summary({ fixedClusters: [] }))).not.toContain('Fixed by this change');
  });

  // Several call sites build this shape; a summary without the field must
  // render rather than throw.
  test('tolerates a summary built without the field', () => {
    const withoutField = summary();
    delete (withoutField as { fixedClusters?: unknown }).fixedClusters;
    expect(() => buildPrComment(withoutField)).not.toThrow();
  });
});

describe('buildCommitStatus', () => {
  test('is a success when nothing failed', () => {
    expect(buildCommitStatus(summary(), 'piwi/tests')).toMatchObject({
      state: 'success',
      context: 'piwi/tests',
      targetUrl: 'https://piwi.example.com/test-runs/42',
    });
  });

  test('is a failure when tests failed', () => {
    expect(buildCommitStatus(summary({ failedTests: 2, passedTests: 118 }), 'piwi/tests').state).toBe('failure');
  });

  test('summarizes counts, new failures and flakes in the description', () => {
    const status = buildCommitStatus(
      summary({ failedTests: 2, passedTests: 118, flakyTests: 3, newRegressions: [entry()] }),
      'piwi/tests',
    );
    expect(status.description).toBe('118/120 passed, 1 new, 3 flaky');
  });

  test('caps the description at what GitHub accepts', () => {
    const status = buildCommitStatus(summary({ projectName: 'x'.repeat(500) }), 'piwi/tests');
    expect(status.description.length).toBeLessThanOrEqual(140);
  });
});

describe('buildPrComment — failure headline', () => {
  test('leads each failure with its headline in bold, markdown-escaped, before the raw excerpt', () => {
    const body = buildPrComment(
      summary({
        failedTests: 1,
        newRegressions: [
          entry({
            headline: "Expected 26 rows, found 51 — getByRole('row') toHaveCount",
            errorExcerpt: 'Error: expect(locator).toHaveCount(expected) failed',
          }),
        ],
      }),
    );
    const headlineAt = body.indexOf("  **Expected 26 rows, found 51 — getByRole('row') toHaveCount**");
    const excerptAt = body.indexOf('  ```\n  Error: expect(locator).toHaveCount(expected) failed\n  ```');
    expect(headlineAt).toBeGreaterThan(-1);
    expect(excerptAt).toBeGreaterThan(headlineAt);
  });

  test('escapes markdown inside a headline and omits the line without one', () => {
    const escaped = buildPrComment(
      summary({ failedTests: 1, newRegressions: [entry({ headline: 'Expected `a_b`, got *c* — toBe' })] }),
    );
    expect(escaped).toContain('**Expected \\`a\\_b\\`, got \\*c\\* — toBe**');
    const plain = buildPrComment(summary({ failedTests: 1, newRegressions: [entry({ headline: null })] }));
    expect(plain).not.toContain('**Expected');
  });
});
