import { describe, expect, test } from 'vitest';
import { catalogCaseOf } from '../src/run-watch';

describe('the test a live run event names by its title', () => {
  const cases = [
    { id: 1, title: 'pays', filePath: 'tests/checkout.spec.ts', suitePath: 'guest' },
    { id: 2, title: 'pays', filePath: 'tests/checkout.spec.ts', suitePath: 'member\x1fwith a coupon' },
    { id: 3, title: 'refunds', filePath: 'tests/checkout.spec.ts', suitePath: '' },
  ];

  test('is the case of its title and suite path, in a file that repeats the title across describe blocks', () => {
    expect(catalogCaseOf(cases, 'pays', ['guest'])).toBe(1);
    expect(catalogCaseOf(cases, 'pays', ['member', 'with a coupon'])).toBe(2);
    expect(catalogCaseOf(cases, 'refunds', [])).toBe(3);
  });

  test('is none when the title is ambiguous, or nothing matches', () => {
    expect(catalogCaseOf(cases, 'pays', null)).toBeNull();
    expect(catalogCaseOf(cases, 'pays', ['member'])).toBeNull();
    expect(catalogCaseOf(cases, 'ships', ['guest'])).toBeNull();
  });

  test('is read by its title alone from a catalog without suite paths', () => {
    const titled = cases.map(({ suitePath: _suite, ...c }) => c);
    expect(catalogCaseOf(titled, 'refunds', ['anywhere'])).toBe(3);
    expect(catalogCaseOf(titled, 'pays', ['guest'])).toBeNull();
  });
});
