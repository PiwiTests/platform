import { describe, it, expect } from 'vitest';
import { computeFault, SLOW_FAULT_DELAY_MS } from '../src/internal/probe/faults.js';
import {
  matchProbeItem,
  requestMatchesRoute,
  probeRunMetadata,
  createProbeState,
  markNavigated,
  shouldMutate,
  type ProbePlan,
} from '../src/internal/probe/plan.js';
import { outcomeFromStatus } from '../src/internal/probe/mode.js';

describe('computeFault (fault application)', () => {
  const input = { status: 200, body: '{"total":42,"currency":"USD"}', contentType: 'application/json' };

  it('status-500 forces a 500', () => {
    expect(computeFault('status-500', input).status).toBe(500);
  });

  it('empty-body blanks the body', () => {
    expect(computeFault('empty-body', input).body).toBe('');
  });

  it('drop-field removes the first JSON key', () => {
    const out = computeFault('drop-field', input);
    expect(JSON.parse(out.body)).toEqual({ currency: 'USD' });
  });

  it('drop-field on an array drops a key from each element', () => {
    const out = computeFault('drop-field', { status: 200, body: '[{"a":1,"b":2},{"a":3,"b":4}]' });
    expect(JSON.parse(out.body)).toEqual([{ b: 2 }, { b: 4 }]);
  });

  it('drop-field leaves non-JSON untouched', () => {
    const out = computeFault('drop-field', { status: 200, body: 'plain text' });
    expect(out.body).toBe('plain text');
  });

  it('stale-value replays a prior body', () => {
    const out = computeFault('stale-value', { ...input, priorBody: '{"total":1}' });
    expect(out.body).toBe('{"total":1}');
  });

  it('slow delays the real response unchanged', () => {
    const out = computeFault('slow', input);
    expect(out.delayMs).toBe(SLOW_FAULT_DELAY_MS);
    expect(out.body).toBe(input.body);
    expect(out.status).toBe(200);
  });
});

describe('probe run stamp', () => {
  it('merges the piwiProbe flag into the run metadata', () => {
    expect(probeRunMetadata()).toEqual({ piwiProbe: true });
    expect(probeRunMetadata({ scm: { branch: 'main' } })).toEqual({ scm: { branch: 'main' }, piwiProbe: true });
  });

  it('derives the outcome from the test status', () => {
    expect(outcomeFromStatus('failed', true)).toBe('noticed');
    expect(outcomeFromStatus('timedOut', true)).toBe('noticed');
    expect(outcomeFromStatus('passed', true)).toBe('not-noticed');
    // An unapplied fault is inconclusive regardless of status.
    expect(outcomeFromStatus('passed', false)).toBe('inconclusive');
    expect(outcomeFromStatus('failed', false)).toBe('inconclusive');
  });
});

describe('matchProbeItem', () => {
  const plan: ProbePlan = {
    budget: 50,
    items: [
      { testCaseId: 1, testTitle: 'checkout › happy path', location: null, routeKey: 'POST /api/orders', fault: 'status-500', nth: 1 },
      { testCaseId: 2, testTitle: 'cart › coupon', location: 'tests/cart.spec.ts:10:3', routeKey: 'POST /api/coupons', fault: 'empty-body', nth: 1 },
    ],
  };

  it('matches by title', () => {
    expect(matchProbeItem(plan, { title: 'checkout › happy path' })?.testCaseId).toBe(1);
  });

  it('matches by location when set', () => {
    expect(matchProbeItem(plan, { title: 'x', location: 'tests/cart.spec.ts:10:3' })?.testCaseId).toBe(2);
  });

  it('returns null when nothing matches', () => {
    expect(matchProbeItem(plan, { title: 'no such test' })).toBeNull();
  });
});

describe('requestMatchesRoute', () => {
  it('matches method and a dynamic segment', () => {
    expect(requestMatchesRoute('PATCH', 'https://app.example.com/api/orders/42', 'PATCH /api/orders/:id')).toBe(true);
    expect(requestMatchesRoute('GET', 'https://app.example.com/api/orders/42', 'PATCH /api/orders/:id')).toBe(false);
  });

  it('does not match a different path', () => {
    expect(requestMatchesRoute('POST', 'https://app.example.com/api/coupons', 'POST /api/orders')).toBe(false);
  });
});

describe('shouldMutate (after first navigation, Nth match)', () => {
  const item = { testCaseId: 1, testTitle: 't', location: null, routeKey: 'POST /api/orders', fault: 'status-500' as const, nth: 2 };

  it('never mutates before the first navigation', () => {
    const state = createProbeState();
    expect(shouldMutate(state, item)).toBe(false);
  });

  it('mutates only the Nth match after navigation', () => {
    const state = createProbeState();
    markNavigated(state);
    expect(shouldMutate(state, item)).toBe(false); // 1st match
    expect(shouldMutate(state, item)).toBe(true); // 2nd match (nth = 2)
    expect(shouldMutate(state, item)).toBe(false); // 3rd match
  });
});
