import { describe, test, expect } from 'vitest';
import {
  describeCluster,
  clusterFallbackTitle,
  clusterSignatureLine,
  headlineAddsValue,
} from '#shared/describe-cluster';
import { extractErrorSignature } from '#shared/error-fingerprint';

/** Build the cluster fields the way ingest does: signature, type and locator from the raw error. */
function clusterFrom(rawError: string, filePath: string | null = null) {
  const sig = extractErrorSignature(rawError);
  return {
    signature: sig.signature,
    errorType: sig.errorType,
    selector: sig.selector,
    sampleError: rawError,
    filePath,
  };
}

const MASK_TOKENS = /<(?:N|VALUE|URL|STR|UUID|HASH|EMAIL)>/;

describe('describeCluster', () => {
  test('a timed-out action names the locator and the spec', () => {
    const error = `TimeoutError: locator.fill: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByLabel('Email address')\n\n    at tests/checkout.spec.ts:42:5`;
    expect(describeCluster(clusterFrom(error))).toBe("Timeout on getByLabel('Email address') in checkout.spec.ts");
  });

  test('a count mismatch names the matcher and the locator without its per-row options', () => {
    const error = `Error: expect(locator).toHaveCount(expected) failed\n\nLocator: getByRole('row', { name: 'Ada Lovelace' })\nExpected: 26\nReceived: 51\n\nCall log:\n  - waiting for getByRole('row', { name: 'Ada Lovelace' })\n  - 9 × locator resolved to 51 elements\n\n    at tests/admin/users.spec.ts:12:44`;
    expect(describeCluster(clusterFrom(error))).toBe("toHaveCount mismatch on getByRole('row') in users.spec.ts");
  });

  test('a state matcher reads as failed, not mismatched', () => {
    const error = `Error: expect(locator).toBeVisible() failed\n\nLocator: locator('.modal.is-open')\n\n    at tests/modal.spec.ts:8:3`;
    expect(describeCluster(clusterFrom(error))).toBe(
      "toBeVisible failed on locator('.modal.is-open') in modal.spec.ts",
    );
  });

  test('a navigation timeout names the route', () => {
    const error = `TimeoutError: page.goto: Timeout 30000ms exceeded.\nCall log:\n  - navigating to "https://admin.example.com/users?page=2", waiting until "load"\n\n    at tests/admin/users.spec.ts:5:3`;
    expect(describeCluster(clusterFrom(error))).toBe('Navigation timeout on /users in users.spec.ts');
  });

  test('a refused connection is a failed navigation', () => {
    const error = `Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/checkout\n    at tests/checkout.spec.ts:3:3`;
    expect(describeCluster(clusterFrom(error))).toBe('Navigation failed on /checkout in checkout.spec.ts');
  });

  test('a strict-mode violation names the ambiguous locator', () => {
    const error = `Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Save' }) resolved to 2 elements:\n    1) <button>Save</button>\n    2) <button>Save</button>\n\n    at tests/settings.spec.ts:20:3`;
    expect(describeCluster(clusterFrom(error))).toBe(
      "Strict-mode violation on getByRole('button') in settings.spec.ts",
    );
  });

  test('a crash is named as such', () => {
    const error = `Error: page.click: Target page, context or browser has been closed\n    at tests/a.spec.ts:1:1`;
    expect(describeCluster(clusterFrom(error))).toBe('Browser or page closed in a.spec.ts');
    expect(describeCluster({ signature: 'Error: Page crashed', errorType: 'crash' })).toBe('Page crashed');
  });

  test('an unknown error keeps its class and falls back to the representative test file', () => {
    const error = `TypeError: Cannot read properties of undefined (reading 'id')`;
    expect(describeCluster(clusterFrom(error, 'tests/orders/list.spec.ts'))).toBe('TypeError in list.spec.ts');
  });

  test('the AI title wins when present, and the signature line is only shown when it adds something', () => {
    const cluster = { ...clusterFrom('Timeout 30000ms exceeded'), title: 'Pay button stays disabled' };
    expect(describeCluster(cluster)).toBe('Pay button stays disabled');
    expect(clusterSignatureLine(cluster)).toBe('Timeout <N>ms exceeded');
    const plain = { signature: 'something entirely unexpected happened', errorType: 'unknown' };
    expect(describeCluster(plain)).toBe('something entirely unexpected happened');
    expect(clusterSignatureLine(plain)).toBeNull();
  });

  test('never emits a mask token, for every sample error the fingerprint tests use', () => {
    const samples = [
      'Error: strict mode violation: locator resolved to 2 elements',
      'expect(received).toBe(expected)',
      'expect(locator).toBeVisible()\nTimeout 5000ms exceeded',
      'Target page, context or browser has been closed',
      'page.goto: net::ERR_CONNECTION_REFUSED',
      'Timeout 30000ms exceeded',
      'something entirely unexpected happened',
      'Timeout 30000ms exceeded\n    at /app/tests/a.spec.ts:1:1',
      'Expected length 3, got 5',
      'Element is not attached to the DOM',
      'Timeout 30000ms exceeded waiting for row 12',
      'open https://example.com/a?b=1 now\nid 550e8400-e29b-41d4-a716-446655440000 sha deadbeefcafe0123',
      'Received: 42\nExpected: "hello world"',
    ];
    for (const raw of samples) {
      const cluster = clusterFrom(raw);
      const title = clusterFallbackTitle(cluster);
      expect(title, raw).not.toMatch(MASK_TOKENS);
      expect(title.length, raw).toBeGreaterThan(0);
    }
    expect(clusterFallbackTitle(clusterFrom('Timeout 30000ms exceeded\n    at /app/tests/a.spec.ts:1:1'))).toBe(
      'Timeout in a.spec.ts',
    );
    expect(clusterFallbackTitle(clusterFrom('expect(received).toBe(expected)'))).toBe('toBe mismatch');
    expect(clusterFallbackTitle(clusterFrom('page.goto: net::ERR_CONNECTION_REFUSED'))).toBe('Navigation failed');
    expect(clusterFallbackTitle(clusterFrom('Timeout 30000ms exceeded waiting for row 12'))).toBe('Timeout');
    expect(clusterFallbackTitle({ signature: 'Error: boom <N> <VALUE> <URL>', errorType: 'unknown' })).toBe(
      'Error: boom … … …',
    );
  });
});

describe('headlineAddsValue', () => {
  test('an expected/received pair the name lacks adds value', () => {
    expect(
      headlineAddsValue(
        "toHaveCount mismatch on getByRole('row') in users.spec.ts",
        "Expected 26 rows, found 51 — getByRole('row') toHaveCount",
      ),
    ).toBe(true);
  });

  test('a not-found state and a timeout duration the name lacks add value', () => {
    expect(
      headlineAddsValue(
        "Timeout on getByLabel('Email address') in checkout.spec.ts",
        "getByLabel('Email address') was not found on the page — fill timed out after 10 s",
      ),
    ).toBe(true);
  });

  test('a name and headline that differ only in word order add nothing', () => {
    expect(headlineAddsValue("getByRole('row') toHaveCount mismatch", "toHaveCount mismatch — getByRole('row')")).toBe(
      false,
    );
  });

  test('an empty or identical headline adds nothing', () => {
    expect(headlineAddsValue('Timeout on getByLabel', null)).toBe(false);
    expect(headlineAddsValue('Timeout on getByLabel', 'Timeout on getByLabel')).toBe(false);
  });

  test('a bare count in the headline adds value', () => {
    expect(
      headlineAddsValue('Strict-mode violation on getByRole(button)', 'getByRole(button) matched 3 elements'),
    ).toBe(true);
  });
});
