import { describe, it, expect } from 'vitest';
import {
  faultStatus,
  faultDelayMs,
  isThrowFault,
  isExtremeFault,
  isDataFault,
  isDependencyFault,
  mutateResponseBody,
  routeMatchesRequest,
  dependencyCallMatches,
  appliedFaultLabel,
} from '../src/faults';

describe('fault classification', () => {
  it('maps each class to its effect', () => {
    expect(faultStatus('status')).toBe(500);
    expect(faultStatus('status-500')).toBe(500);
    expect(faultStatus('auth')).toBe(401);
    expect(faultStatus('throw')).toBeNull();
    expect(faultDelayMs('delay')).toBe(5000);
    expect(faultDelayMs('slow-first')).toBe(5000);
    expect(faultDelayMs('throw')).toBe(0);
    expect(isThrowFault('throw')).toBe(true);
    expect(isExtremeFault('extreme')).toBe(true);
    expect(isDependencyFault('dependency')).toBe(true);
    expect(isDataFault('data')).toBe(true);
    expect(isDataFault('drop-field')).toBe(true);
    expect(isDataFault('empty-body')).toBe(true);
    expect(isDataFault('throw')).toBe(false);
  });
});

describe('mutateResponseBody', () => {
  it('empty-body empties by shape', () => {
    expect(mutateResponseBody('empty-body', { a: 1 })).toEqual({});
    expect(mutateResponseBody('empty-body', [1, 2])).toEqual([]);
    expect(mutateResponseBody('empty-body', 'hi')).toBe('');
  });

  it('drop-field removes the first key; data nulls it', () => {
    expect(mutateResponseBody('drop-field', { a: 1, b: 2 })).toEqual({ b: 2 });
    expect(mutateResponseBody('data', { a: 1, b: 2 })).toEqual({ a: null, b: 2 });
  });

  it('leaves primitives and empty objects unchanged for data/drop-field', () => {
    expect(mutateResponseBody('data', 5)).toBe(5);
    expect(mutateResponseBody('drop-field', {})).toEqual({});
  });

  it('returns the same reference for a no-op, so the plugin can detect it did nothing', () => {
    // `data` cannot null a field of an array, so the body is returned unchanged.
    // The plugin marks the fault applied only when the reference actually changes,
    // so this no-op records as inconclusive rather than a false gap.
    const arr = [{ a: 1 }];
    expect(mutateResponseBody('data', arr)).toBe(arr);
    const empty = {};
    expect(mutateResponseBody('drop-field', empty)).toBe(empty);
  });
});

describe('route matching (the whole server-side selector)', () => {
  const spec = { route: 'POST /api/orders/:id', fault: 'status', nth: 2 };

  it('matches method and pattern with params', () => {
    expect(routeMatchesRequest(spec, 'POST', '/api/orders/42')).toBe(true);
    expect(routeMatchesRequest(spec, 'GET', '/api/orders/42')).toBe(false);
    expect(routeMatchesRequest(spec, 'POST', '/api/carts/42')).toBe(false);
  });

  it('an unscoped spec matches every request', () => {
    expect(routeMatchesRequest({ fault: 'throw' }, 'GET', '/anything')).toBe(true);
  });

  it('does not re-count nth: a matching request is the target regardless of nth', () => {
    // The reporter signs the header onto the one request it already chose as the
    // Nth match, so the server applies to any matching request without counting.
    expect(routeMatchesRequest(spec, 'POST', '/api/orders/1')).toBe(true);
    expect(routeMatchesRequest(spec, 'POST', '/api/orders/2')).toBe(true);
  });
});

describe('dependencyCallMatches', () => {
  it('matches an outbound call whose URL or host names the dependency', () => {
    expect(dependencyCallMatches('payments-svc', 'http://payments-svc/charge')).toBe(true);
    expect(dependencyCallMatches('payments-svc', 'https://payments-svc.internal/v1')).toBe(true);
    expect(dependencyCallMatches('payments-svc', '/api/orders')).toBe(false);
  });

  it('an unscoped dependency fault matches the first outbound call', () => {
    expect(dependencyCallMatches(undefined, 'http://anything/x')).toBe(true);
    expect(dependencyCallMatches('', 'http://anything/x')).toBe(true);
  });

  it('a scoped fault never matches an empty target', () => {
    expect(dependencyCallMatches('payments-svc', '')).toBe(false);
  });
});

describe('appliedFaultLabel', () => {
  it('names the dependency for a dependency fault', () => {
    expect(appliedFaultLabel({ fault: 'dependency', dependency: 'payments-svc' })).toBe('dependency:payments-svc');
    expect(appliedFaultLabel({ fault: 'throw' })).toBe('throw');
  });
});
