import { describe, it, expect } from 'vitest';
import { conditionFor, globRegExp, isCondition, type RequestCondition } from '../../src/shared/request-conditions.js';

const slow: RequestCondition = { id: 'a', method: 'GET', pattern: '**/api/cart?_=*', kind: 'delay', delayMs: 2000 };
const fail: RequestCondition = { id: 'b', method: 'POST', pattern: '**/api/orders', kind: 'error', delayMs: 0 };

describe('globRegExp', () => {
  it('reads ** across slashes, * within a segment, and the rest literally', () => {
    expect(globRegExp('**/api/cart').test('https://shop.test/api/cart')).toBe(true);
    expect(globRegExp('**/api/*').test('https://shop.test/api/cart')).toBe(true);
    expect(globRegExp('**/api/*').test('https://shop.test/api/cart/1')).toBe(false);
    expect(globRegExp('**/api/cart?_=*').test('https://shop.test/api/cart?_=1695')).toBe(true);
    expect(globRegExp('**/api/cart?_=*').test('https://shop.test/api/cartX_=1')).toBe(false);
    expect(globRegExp('**/a.b').test('https://shop.test/aXb')).toBe(false);
  });
});

describe('conditionFor', () => {
  it('finds the condition for a request by its method and URL', () => {
    expect(conditionFor([slow, fail], 'get', 'https://shop.test/api/cart?_=17')).toBe(slow);
    expect(conditionFor([slow, fail], 'POST', 'https://shop.test/api/orders')).toBe(fail);
    expect(conditionFor([slow, fail], 'GET', 'https://shop.test/api/orders')).toBeNull();
  });
});

describe('isCondition', () => {
  it('accepts a condition and refuses anything else', () => {
    expect(isCondition(slow)).toBe(true);
    expect(isCondition({ ...slow, kind: 'teleport' })).toBe(false);
    expect(isCondition({ ...slow, delayMs: 10 * 60_000 })).toBe(false);
    expect(isCondition(null)).toBe(false);
  });
});
