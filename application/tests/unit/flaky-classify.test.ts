import { describe, test, expect } from 'vitest';

describe('Flaky root cause classification', () => {
  test('classifies timing errors', async () => {
    const { classifyFlakyRootCause } = await import('../../server/utils/flaky-classify');
    const result = classifyFlakyRootCause({
      errorMessages: ['TimeoutError: locator.click: Timeout 30000ms exceeded'],
      stepErrors: [],
      stepNames: ['waitFor navigation'],
      networkErrorCount: 0,
      status5xxCount: 0,
      browserDistribution: { chromium: 5, firefox: 4 },
    });
    expect(result).toBe('timing');
  });

  test('classifies network errors', async () => {
    const { classifyFlakyRootCause } = await import('../../server/utils/flaky-classify');
    const result = classifyFlakyRootCause({
      errorMessages: ['net::ERR_CONNECTION_REFUSED', 'status 500 on POST /api/orders'],
      stepErrors: [],
      stepNames: ['waitForResponse'],
      networkErrorCount: 2,
      status5xxCount: 1,
      browserDistribution: { chromium: 5 },
    });
    expect(result).toBe('network');
  });

  test('classifies assertion errors without timing/network keywords', async () => {
    const { classifyFlakyRootCause } = await import('../../server/utils/flaky-classify');
    const result = classifyFlakyRootCause({
      errorMessages: ['expect(received).toBe(expected)\n\nExpected: 3\nReceived: 0'],
      stepErrors: [],
      stepNames: [],
      networkErrorCount: 0,
      status5xxCount: 0,
      browserDistribution: { chromium: 5 },
    });
    expect(result).toBe('assertion');
  });

  test('falls back to timing when assertion also has timing keywords', async () => {
    const { classifyFlakyRootCause } = await import('../../server/utils/flaky-classify');
    const result = classifyFlakyRootCause({
      errorMessages: ['expect(element).toBeVisible: Timeout 5000ms exceeded'],
      stepErrors: [],
      stepNames: [],
      networkErrorCount: 0,
      status5xxCount: 0,
      browserDistribution: { chromium: 5 },
    });
    // "to be visible" is a timing keyword, "expect(" is assertion — timing wins
    expect(result).toBe('timing');
  });

  test('classifies environment when only one browser fails across multiple', async () => {
    const { classifyFlakyRootCause } = await import('../../server/utils/flaky-classify');
    const result = classifyFlakyRootCause({
      errorMessages: ['Some intermittent error'],
      stepErrors: [],
      stepNames: [],
      networkErrorCount: 0,
      status5xxCount: 0,
      browserDistribution: { chromium: 5, firefox: 0, webkit: 0 },
    });
    // Only chromium has failures (5), firefox and webkit have 0
    // Total of 5 runs across browsers, exactly 1 browser with failures + >=3
    expect(result).toBe('environment');
  });

  test('returns other for empty inputs', async () => {
    const { classifyFlakyRootCause } = await import('../../server/utils/flaky-classify');
    const result = classifyFlakyRootCause({
      errorMessages: [],
      stepErrors: [],
      stepNames: [],
      networkErrorCount: 0,
      status5xxCount: 0,
      browserDistribution: {},
    });
    expect(result).toBe('other');
  });

  test('returns other for unrecognized errors', async () => {
    const { classifyFlakyRootCause } = await import('../../server/utils/flaky-classify');
    const result = classifyFlakyRootCause({
      errorMessages: ['Something went wrong: undefined is not a function'],
      stepErrors: [],
      stepNames: ['do something'],
      networkErrorCount: 0,
      status5xxCount: 0,
      browserDistribution: { chromium: 1 },
    });
    expect(result).toBe('other');
  });
});
