import { describe, test, expect, vi, afterEach } from 'vitest';
import { sha256Hex } from '../../shared/utils/hash';

const INPUTS = ['', 'abc', 'getByRole ["button",{"name":"Envoyer ✓"}]', 'x'.repeat(100_000)];

async function webCryptoHex(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('sha256Hex', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  test('gives the SHA-256 of the UTF-8 bytes', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('hashes on the server as Web Crypto does', async () => {
    for (const input of INPUTS) expect(await sha256Hex(input)).toBe(await webCryptoHex(input));
  });

  test('falls back to Web Crypto where Node’s crypto module cannot be reached', async () => {
    vi.spyOn(process, 'getBuiltinModule').mockReturnValue(undefined as never);
    vi.resetModules();
    const fallback = (await import('../../shared/utils/hash')).sha256Hex;
    expect(process.getBuiltinModule).toHaveBeenCalledWith('node:crypto');
    for (const input of INPUTS) expect(await fallback(input)).toBe(await webCryptoHex(input));
  });
});
