import { describe, test, expect } from 'vitest';
import { normalizeAndHashArgs, locatorSignature, locatorSignatureFromExpression } from '../../shared/locator-healing';

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

/**
 * The capture side stores a signature from `(method, args)`; the lookup side
 * recomputes it from the locator expression parsed out of the failure error.
 * For healing to work, the two MUST produce the same key. This round-trip was
 * broken: capture hashed the raw args array `['button', { name: 'Submit' }]`
 * while lookup hashed `Object.values(parsedArgs)` = `['button', 'Submit']`, and
 * the expression parser used `JSON.parse` on Playwright's single-quoted option
 * objects (which throws). These tests pin the contract.
 */
describe('locator signature round-trip (capture vs lookup)', () => {
  const cap = (method: string, args: unknown[]) => locatorSignature(method, args);
  const look = (expr: string) => locatorSignatureFromExpression(expr);

  test('getByRole with a name option matches across capture and lookup', async () => {
    expect(await cap('getByRole', ['button', { name: 'Submit' }])).toBe(
      await look("getByRole('button', { name: 'Submit' })"),
    );
  });

  test('getByRole signature ignores the `exact` matching mode', async () => {
    const captured = await cap('getByRole', ['button', { name: 'Submit', exact: true }]);
    expect(captured).toBe(await look("getByRole('button', { name: 'Submit', exact: true })"));
    expect(captured).toBe(await look("getByRole('button', { name: 'Submit' })"));
  });

  test('getByTestId single-arg matches', async () => {
    expect(await cap('getByTestId', ['login-button'])).toBe(await look("getByTestId('login-button')"));
  });

  test('getByText with spaces matches', async () => {
    expect(await cap('getByText', ['Submit order'])).toBe(await look("getByText('Submit order')"));
  });

  test('locator CSS selector matches', async () => {
    expect(await cap('locator', ['.submit-btn'])).toBe(await look("locator('.submit-btn')"));
  });

  test('double-quoted error expression matches single-quoted capture', async () => {
    expect(await cap('getByRole', ['button', { name: 'Submit' }])).toBe(
      await look('getByRole("button", { name: "Submit" })'),
    );
  });

  test('different option values do not collide', async () => {
    expect(await cap('getByRole', ['button', { name: 'Submit' }])).not.toBe(
      await look("getByRole('button', { name: 'Cancel' })"),
    );
  });

  test('different methods do not collide', async () => {
    expect(await cap('getByTestId', ['submit'])).not.toBe(await look("getByText('submit')"));
  });

  test('different roles with the same name do not collide', async () => {
    expect(await cap('getByRole', ['button', { name: 'Submit' }])).not.toBe(
      await look("getByRole('link', { name: 'Submit' })"),
    );
  });
});
