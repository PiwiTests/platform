/**
 * Shared utilities for locator healing — pure functions that work in both
 * Node.js and browser (Web Crypto) environments.
 */

/**
 * Normalize locator args for deterministic hashing.
 *
 * Steps:
 * 1. Deep-convert the args array to a canonical representation.
 * 2. For object arguments, strip the `exact` key (it's a matching mode,
 *    not a locator identity signal), sort remaining keys alphabetically.
 * 3. JSON.stringify with sorted keys.
 * 4. SHA-256 hex digest of the resulting string.
 *
 * The same locator expressed with `{ exact: true }` vs without produces
 * the same hash, so line-shift-resilient matching works across runs.
 */
export async function normalizeAndHashArgs(args: unknown[]): Promise<string> {
  const canonical = args.map(canonicalizeArg);
  const payload = JSON.stringify(canonical);
  return sha256Hex(payload);
}

function canonicalizeArg(arg: unknown): unknown {
  if (arg === null || typeof arg !== 'object') return arg;
  if (Array.isArray(arg)) return arg.map(canonicalizeArg);

  const obj = arg as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (key === 'exact') continue;
    normalized[key] = canonicalizeArg(obj[key]);
  }
  return normalized;
}

async function sha256Hex(input: string): Promise<string> {
  // Use Web Crypto API — same API surface in Node 19+ and browsers.
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
