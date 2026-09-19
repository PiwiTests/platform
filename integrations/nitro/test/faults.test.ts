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
  faultAppliesToRequest,
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
});

describe('route matching and nth selection', () => {
  const spec = { route: 'POST /api/orders/:id', fault: 'status', nth: 2 };

  it('matches method and pattern with params', () => {
    expect(routeMatchesRequest(spec, 'POST', '/api/orders/42')).toBe(true);
    expect(routeMatchesRequest(spec, 'GET', '/api/orders/42')).toBe(false);
    expect(routeMatchesRequest(spec, 'POST', '/api/carts/42')).toBe(false);
  });

  it('an unscoped spec matches every request', () => {
    expect(routeMatchesRequest({ fault: 'throw' }, 'GET', '/anything')).toBe(true);
  });

  it('applies only on the nth match', () => {
    expect(faultAppliesToRequest(spec, 'POST', '/api/orders/42', 1)).toBe(false);
    expect(faultAppliesToRequest(spec, 'POST', '/api/orders/42', 2)).toBe(true);
  });
});

describe('appliedFaultLabel', () => {
  it('names the dependency for a dependency fault', () => {
    expect(appliedFaultLabel({ fault: 'dependency', dependency: 'payments-svc' })).toBe('dependency:payments-svc');
    expect(appliedFaultLabel({ fault: 'throw' })).toBe('throw');
  });
});
