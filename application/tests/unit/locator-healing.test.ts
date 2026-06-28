import { describe, test, expect } from 'vitest';
import {
  normalizeAndHashArgs,
  locatorSignature,
  locatorSignatureFromExpression,
  recommendLocatorFix,
  CONVENTION_STABILITY_FLOOR,
} from '../../shared/locator-healing';
import type { RankedLocator } from '../../shared/locator-healing.types';
import { extractLeafSelector } from '../../shared/error-fingerprint';

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

/**
 * Chained locators: the capture side records a chain's innermost
 * locator-creating call, so the lookup must extract that same leaf from the
 * error (not the outermost call). extractLeafSelector + the signature must agree.
 */
describe('chained locator leaf matching', () => {
  const chainError = (chain: string) =>
    `TimeoutError: locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for ${chain}\n    at tests/checkout.spec.ts:42:5`;

  test('extracts the innermost call from a chain', () => {
    expect(
      extractLeafSelector(chainError("getByRole('row', { name: 'Acme' }).getByRole('button', { name: 'Delete' })")),
    ).toBe("getByRole('button', { name: 'Delete' })");
  });

  test('returns the whole expression for a non-chained locator', () => {
    expect(extractLeafSelector(chainError("getByTestId('submit')"))).toBe("getByTestId('submit')");
  });

  test('ignores trailing positional chains (.first/.nth)', () => {
    expect(extractLeafSelector(chainError("getByRole('row').getByRole('button').first()"))).toBe("getByRole('button')");
  });

  test('ignores a locator nested inside filter({ has })', () => {
    expect(extractLeafSelector(chainError("getByRole('button').filter({ has: getByText('x') })"))).toBe(
      "getByRole('button')",
    );
  });

  test('leaf signature round-trips against the captured leaf', async () => {
    // Capture stored the chain leaf: getByRole('button', { name: 'Delete' }).
    const captured = await locatorSignature('getByRole', ['button', { name: 'Delete' }]);
    const leaf = extractLeafSelector(
      chainError("getByRole('row', { name: 'Acme' }).getByRole('button', { name: 'Delete' })"),
    );
    expect(leaf).not.toBeNull();
    expect(await locatorSignatureFromExpression(leaf!)).toBe(captured);
  });
});

/**
 * Convention-preserving fix selection. The full menu stays ranked by raw
 * stability, but the single recommended fix keeps the developer's original
 * locator style where that style clears the stability floor — otherwise it
 * escalates to the most stable alternative, and flags adding a data-testid when
 * nothing is stable enough.
 */
describe('recommendLocatorFix (convention-preserving)', () => {
  const alt = (method: string, score: number, locator = `${method}:${score}`): RankedLocator => ({
    locator,
    method,
    args: {},
    score,
  });

  test('keeps the same method even when a higher-stability option exists', () => {
    const rec = recommendLocatorFix('getByText', [alt('getByTestId', 100), alt('getByText', 75)]);
    expect(rec.recommended?.method).toBe('getByText');
    expect(rec.preservesConvention).toBe(true);
    expect(rec.durable?.method).toBe('getByTestId');
    expect(rec.hasDurableAlternative).toBe(true);
    expect(rec.suggestAddTestId).toBe(false);
  });

  test('keeps the same family when the exact method is gone (getByPlaceholder → getByLabel)', () => {
    const rec = recommendLocatorFix('getByPlaceholder', [alt('getByTestId', 100), alt('getByLabel', 85)]);
    expect(rec.recommended?.method).toBe('getByLabel');
    expect(rec.preservesConvention).toBe(true);
  });

  test('treats getByText/getByTitle/getByAltText as one visible-text family', () => {
    const rec = recommendLocatorFix('getByTitle', [alt('getByTestId', 100), alt('getByText', 75)]);
    expect(rec.recommended?.method).toBe('getByText');
    expect(rec.preservesConvention).toBe(true);
  });

  test('picks the most stable option within the original family', () => {
    const rec = recommendLocatorFix('getByRole', [alt('getByTestId', 100), alt('getByRole', 90), alt('getByRole', 85)]);
    expect(rec.recommended?.score).toBe(90);
    expect(rec.preservesConvention).toBe(true);
    expect(rec.hasDurableAlternative).toBe(true);
  });

  test('rejects a same-family pick below the stability floor and escalates', () => {
    const rec = recommendLocatorFix('locator', [alt('getByTestId', 100), alt('locator', 10, '.btn-abc123')]);
    expect(rec.recommended?.method).toBe('getByTestId');
    expect(rec.preservesConvention).toBe(false);
    expect(rec.hasDurableAlternative).toBe(false); // recommended === durable
    expect(rec.suggestAddTestId).toBe(false);
  });

  test('escalates to the most stable when no same-family alternative exists', () => {
    const rec = recommendLocatorFix('getByText', [alt('getByTestId', 100), alt('getByRole', 90)]);
    expect(rec.recommended?.method).toBe('getByTestId');
    expect(rec.preservesConvention).toBe(false);
  });

  test('flags adding a data-testid when nothing clears the floor', () => {
    const rec = recommendLocatorFix('getByText', [alt('locator', 40, '.x'), alt('locator', 25, '.y')]);
    expect(rec.suggestAddTestId).toBe(true);
    expect(rec.recommended?.locator).toBe('.x'); // most stable, still fragile
    expect(rec.preservesConvention).toBe(false);
    expect(rec.hasDurableAlternative).toBe(false);
  });

  test('recommended equals durable when the same method is already the most stable', () => {
    const rec = recommendLocatorFix('getByTestId', [alt('getByTestId', 100), alt('getByText', 75)]);
    expect(rec.recommended?.method).toBe('getByTestId');
    expect(rec.preservesConvention).toBe(true);
    expect(rec.hasDurableAlternative).toBe(false);
  });

  test('falls back to the most stable when the failing method is unknown', () => {
    const rec = recommendLocatorFix(null, [alt('getByTestId', 100), alt('getByText', 75)]);
    expect(rec.recommended?.method).toBe('getByTestId');
    expect(rec.preservesConvention).toBe(false);
  });

  test('returns nulls for an empty alternative list', () => {
    const rec = recommendLocatorFix('getByRole', []);
    expect(rec.recommended).toBeNull();
    expect(rec.durable).toBeNull();
    expect(rec.preservesConvention).toBe(false);
    expect(rec.hasDurableAlternative).toBe(false);
    expect(rec.suggestAddTestId).toBe(false);
  });

  test('keeps a same-method pick at exactly the stability floor', () => {
    expect(CONVENTION_STABILITY_FLOOR).toBe(50);
    const rec = recommendLocatorFix('getByText', [alt('getByTestId', 100), alt('getByText', 50)]);
    expect(rec.recommended?.method).toBe('getByText');
    expect(rec.preservesConvention).toBe(true);
  });
});
