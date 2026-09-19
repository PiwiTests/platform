import { describe, test, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { compressResource, decodeResource } from '../../server/utils/resource-compression';

describe('resource-compression', () => {
  test('compresses a text resource and restores it byte-for-byte', () => {
    const css = Buffer.from('body { color: red; margin: 0 } '.repeat(500), 'utf8');
    const { data, compressed } = compressResource(css);

    expect(compressed).toBe(true);
    expect(data.length).toBeLessThan(css.length);
    expect(decodeResource(data).equals(css)).toBe(true);
  });

  test('stores an already-compressed resource (PNG) verbatim', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(2000)]);
    const { data, compressed } = compressResource(png);

    expect(compressed).toBe(false);
    expect(data).toBe(png); // same buffer, untouched
    expect(decodeResource(data).equals(png)).toBe(true);
  });

  test('never grows a tiny or high-entropy resource', () => {
    expect(compressResource(Buffer.from('hi')).compressed).toBe(false);

    const noise = randomBytes(5000);
    const result = compressResource(noise);
    expect(result.compressed).toBe(false);
    expect(result.data.length).toBeLessThanOrEqual(noise.length);
    expect(decodeResource(result.data).equals(noise)).toBe(true);
  });

  test('reads a raw resource that is itself gzip without double-decoding it', () => {
    // Playwright can store a response body still content-encoded as gzip. Such a
    // resource is stored raw (no container magic), so decodeResource must return
    // it verbatim — inflating it would corrupt the trace's own encoding.
    const gzipBody = gzipSync(Buffer.from('the real, already-encoded response body'));
    const { data, compressed } = compressResource(gzipBody);

    expect(compressed).toBe(false); // gzip magic → treated as already-compressed
    expect(decodeResource(data).equals(gzipBody)).toBe(true);
  });

  test('handles an empty resource', () => {
    const empty = Buffer.alloc(0);
    expect(compressResource(empty).compressed).toBe(false);
    expect(decodeResource(empty).length).toBe(0);
  });
});
