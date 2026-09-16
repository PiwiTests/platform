import { describe, test, expect } from 'vitest';
import { diffAttempts, type AttemptEvidence } from '#shared/attempt-diff';

/** A minimal passing attempt: no error, no failed requests, no problem logs. */
function cleanPass(overrides: Partial<AttemptEvidence> = {}): AttemptEvidence {
  return {
    error: null,
    steps: [],
    networkRequests: [],
    consoleLogs: [],
    pageState: null,
    ariaSnapshot: null,
    duration: 1000,
    ...overrides,
  };
}

describe('diffAttempts', () => {
  test('fail→pass with a 500 that recovered ranks the error first, then the request', () => {
    const failing: AttemptEvidence = {
      error: 'Error: expected 200, got 500',
      networkRequests: [
        { method: 'GET', url: 'https://app.test/', status: 200, duration: 40 },
        { method: 'POST', url: 'https://app.test/api/orders?id=7', status: 500, duration: 120 },
      ],
      duration: 1200,
    };
    const passing = cleanPass({
      networkRequests: [
        { method: 'GET', url: 'https://app.test/', status: 200, duration: 40 },
        { method: 'POST', url: 'https://app.test/api/orders?id=8', status: 201, duration: 90 },
      ],
      duration: 1100,
    });

    const diff = diffAttempts(failing, passing);
    const kinds = diff.map((d) => d.kind);
    expect(kinds[0]).toBe('error');
    expect(kinds).toContain('network');
    // Error before network in the ordered list.
    expect(kinds.indexOf('error')).toBeLessThan(kinds.indexOf('network'));

    const net = diff.find((d) => d.kind === 'network')!;
    expect(net.only).toBe('failing');
    expect(net.summary).toContain('POST https://app.test/api/orders');
    expect(net.summary).toContain('500');
    expect(net.ref).toEqual({ section: 'networkRequests' });
  });

  test('fail→pass with a console error only on the fail emits a console diff', () => {
    const failing: AttemptEvidence = {
      error: 'Error: element not found',
      consoleLogs: [
        { type: 'log', text: 'app booted' },
        { type: 'error', text: 'Uncaught TypeError: cannot read foo of undefined' },
      ],
      duration: 1000,
    };
    const passing = cleanPass({
      consoleLogs: [{ type: 'log', text: 'app booted' }],
    });

    const diff = diffAttempts(failing, passing);
    const console = diff.filter((d) => d.kind === 'console');
    expect(console).toHaveLength(1);
    expect(console[0]!.only).toBe('failing');
    expect(console[0]!.detail).toContain('Uncaught TypeError');
    expect(console[0]!.ref).toEqual({ section: 'console' });
  });

  test('a timing-only difference yields a single duration row', () => {
    const failing = cleanPass({ error: null, duration: 8000 });
    const passing = cleanPass({ duration: 1500 });

    const diff = diffAttempts(failing, passing);
    expect(diff).toHaveLength(1);
    expect(diff[0]!.kind).toBe('duration');
    expect(diff[0]!.only).toBeUndefined();
    expect(diff[0]!.summary).toContain('slower');
  });

  test('attempts with no fixture data produce an error-only diff and never throw', () => {
    const failing: AttemptEvidence = { error: 'AssertionError: expected true' };
    const passing: AttemptEvidence = { error: null };

    const diff = diffAttempts(failing, passing);
    expect(diff).toHaveLength(1);
    expect(diff[0]!.kind).toBe('error');
    expect(diff[0]!.only).toBe('failing');
    expect(diff[0]!.detail).toBe('AssertionError: expected true');
    expect(diff[0]!.ref).toEqual({ section: 'executionError' });
  });

  test('aligns 1.63-shaped steps by label so a failed click is not lost among bare "Click" titles', () => {
    // Both attempts have two "Click" steps; only the failing attempt's second
    // one errored. Keying by title alone would pair it with the passing first
    // click and miss the error — the label (title + subtitle) keeps them apart.
    const failing = cleanPass({
      steps: [
        { title: 'Click', subtitle: "getByRole('button', { name: 'Cancel' })", duration: 10 },
        {
          title: 'Click',
          subtitle: "getByRole('button', { name: 'Pay' })",
          duration: 10,
          error: { message: 'not enabled' },
        },
      ],
    });
    const passing = cleanPass({
      steps: [
        { title: 'Click', subtitle: "getByRole('button', { name: 'Cancel' })", duration: 10 },
        { title: 'Click', subtitle: "getByRole('button', { name: 'Pay' })", duration: 10 },
      ],
    });
    const diff = diffAttempts(failing, passing);
    const stepRow = diff.find((d) => d.kind === 'step');
    expect(stepRow?.summary).toBe(
      "Step \"Click getByRole('button', { name: 'Pay' })\" errored on only the failing attempt",
    );
  });

  test('a step run on both attempts with different params is reported', () => {
    const failing = cleanPass({
      steps: [
        {
          title: 'Navigate',
          subtitle: '/checkout',
          duration: 10,
          params: { url: 'https://app.test/checkout?coupon=EXPIRED' },
        },
      ],
    });
    const passing = cleanPass({
      steps: [
        {
          title: 'Navigate',
          subtitle: '/checkout',
          duration: 10,
          params: { url: 'https://app.test/checkout?coupon=SAVE10' },
        },
      ],
    });
    const diff = diffAttempts(failing, passing);
    const stepRow = diff.find((d) => d.kind === 'step');
    expect(stepRow?.summary).toBe('Step "Navigate /checkout" ran with different params');
    expect(stepRow?.detail).toBe(
      'url: https://app.test/checkout?coupon=EXPIRED → https://app.test/checkout?coupon=SAVE10',
    );
  });

  test('a step present on both attempts with identical params yields no step diff', () => {
    const step = {
      title: 'Click',
      subtitle: "getByRole('button')",
      duration: 10,
      params: { locator: "getByRole('button')" },
    };
    expect(diffAttempts(cleanPass({ steps: [step] }), cleanPass({ steps: [{ ...step }] }))).toEqual([]);
  });

  test('two identical attempts yield no differences', () => {
    expect(diffAttempts(cleanPass(), cleanPass())).toEqual([]);
  });

  test('empty inputs never throw', () => {
    expect(diffAttempts({}, {})).toEqual([]);
  });

  test('an ARIA structural node present only on the failure is reported', () => {
    const failing = cleanPass({
      ariaSnapshot: '- main:\n  - heading "Dashboard" [level=1]\n- dialog "Session expired"',
    });
    const passing = cleanPass({
      ariaSnapshot: '- main:\n  - heading "Dashboard" [level=1]',
    });

    const diff = diffAttempts(failing, passing);
    const aria = diff.filter((d) => d.kind === 'aria');
    expect(aria).toHaveLength(1);
    expect(aria[0]!.only).toBe('failing');
    expect(aria[0]!.summary).toContain('dialog "Session expired"');
  });
});
