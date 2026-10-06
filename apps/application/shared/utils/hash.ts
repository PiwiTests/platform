/**
 * Hashing helpers, safe to import from shared/browser code: the server hashes
 * with Node's `crypto` module, the browser and the demo's service worker with
 * the Web Crypto API.
 */

/** The part of Node's `crypto` module the helpers use. */
interface NodeCrypto {
  createHash(algorithm: string): { update(data: string): { digest(encoding: 'hex'): string } };
}

/**
 * Node's `crypto` module on the server, reached without an import the browser
 * build would have to resolve; undefined in the browser.
 */
const nodeCrypto = (
  globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }
).process?.getBuiltinModule?.('node:crypto') as NodeCrypto | undefined;

/**
 * SHA-256 hex digest of a UTF-8 string. The server hashes in place: Web Crypto
 * sends each digest to the thread pool and back, which costs more than hashing
 * a short string.
 */
export async function sha256Hex(input: string): Promise<string> {
  if (nodeCrypto) return nodeCrypto.createHash('sha256').update(input).digest('hex');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
