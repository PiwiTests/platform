import { describe, test, expect } from 'vitest';
import { normalizeAndHashArgs } from '../../shared/locator-healing';

describe('normalizeAndHashArgs', () => {
  test('produces identical hashes for args differing only in `exact`', async () => {
    const a = await normalizeAndHashArgs(['button', { name: 'Submit', exact: true }]);
    const b = await normalizeAndHashArgs(['button', { name: 'Submit', exact: false }]);
    const c = await normalizeAndHashArgs(['button', { name: 'Submit' }]);
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  test('produces identical hashes regardless of key order', async () => {
    const a = await normalizeAndHashArgs(['button', { name: 'Submit', exact: true, level: 1 }]);
    const b = await normalizeAndHashArgs(['button', { level: 1, name: 'Submit', exact: true }]);
    expect(a).toBe(b);
  });

  test('produces different hashes for different methods', async () => {
    const a = await normalizeAndHashArgs(['button', { name: 'Submit' }]);
    const b = await normalizeAndHashArgs(['Submit']);
    expect(a).not.toBe(b);
  });

  test('produces different hashes for different argument values', async () => {
    const a = await normalizeAndHashArgs(['button', { name: 'Submit' }]);
    const b = await normalizeAndHashArgs(['button', { name: 'Cancel' }]);
    expect(a).not.toBe(b);
  });

  test('handles getByTestId simple args', async () => {
    const a = await normalizeAndHashArgs(['submit-btn']);
    const b = await normalizeAndHashArgs(['submit-btn']);
    expect(a).toBe(b);
    expect(a.length).toBe(64);
  });

  test('handles locator string args', async () => {
    const a = await normalizeAndHashArgs(['.my-class']);
    const b = await normalizeAndHashArgs(['.my-class']);
    expect(a).toBe(b);
  });

  test('handles empty args array', async () => {
    const hash = await normalizeAndHashArgs([]);
    expect(hash.length).toBe(64);
  });

  test('is deterministic', async () => {
    const a = await normalizeAndHashArgs(['button', { name: 'Hello', exact: true }]);
    for (let i = 0; i < 5; i++) {
      const b = await normalizeAndHashArgs(['button', { name: 'Hello', exact: true }]);
      expect(b).toBe(a);
    }
  });
});
