import { describe, test, expect } from 'vitest';
import { isBlockedAddress, assertPublicHttpUrl } from '../../server/utils/safe-fetch';

describe('isBlockedAddress', () => {
  test('blocks private / loopback / link-local / reserved addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1', // CGNAT
      '198.18.0.1', // benchmarking
      '0.0.0.0',
      '::1',
      'fe80::1',
      'fc00::1',
      '::ffff:127.0.0.1', // IPv4-mapped loopback (dotted)
      '::ffff:7f00:1', // IPv4-mapped loopback (hex hextets) — 127.0.0.1
      '::ffff:a9fe:a9fe', // IPv4-mapped 169.254.169.254 metadata (hex)
      '::ffff:0a00:1', // IPv4-mapped 10.0.0.1 (hex)
      'not-an-ip',
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  test('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '::ffff:8.8.8.8']) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  });
});

describe('assertPublicHttpUrl', () => {
  test('rejects non-http(s), localhost, and private literals', async () => {
    await expect(assertPublicHttpUrl('ftp://example.com')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://localhost/x')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://127.0.0.1/x')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://[::1]/x')).rejects.toThrow();
  });

  test('accepts a public literal IP without a DNS lookup', async () => {
    const url = await assertPublicHttpUrl('https://8.8.8.8/path');
    expect(url.hostname).toBe('8.8.8.8');
  });
});
