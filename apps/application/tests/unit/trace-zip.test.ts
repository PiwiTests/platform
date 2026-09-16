import { describe, test, expect } from 'vitest';
import { buildZip, parseZipSync, parseZipDirectory } from '../../server/utils/trace-zip';

describe('buildZip / parseZipSync round-trip', () => {
  test('stores and recovers every entry unchanged', () => {
    const entries = [
      { name: 'trace.trace', data: Buffer.from('{"type":"context"}\n') },
      { name: 'trace.network', data: Buffer.from('{"type":"network"}\n') },
      { name: 'resources/abc.bin', data: Buffer.from(Array.from({ length: 256 }, (_, i) => i)) },
    ];
    const parsed = parseZipSync(buildZip(entries));
    expect(parsed).toHaveLength(3);
    for (const orig of entries) {
      const found = parsed.find((e) => e.name === orig.name);
      expect(found?.data.equals(orig.data)).toBe(true);
    }
  });

  test('round-trips several larger entries', () => {
    const large = Buffer.alloc(128 * 1024, 0x42);
    const parsed = parseZipSync(
      buildZip([
        { name: 'big1.dat', data: large },
        { name: 'big2.dat', data: large },
      ]),
    );
    expect(parsed).toHaveLength(2);
    for (const e of parsed) expect(e.data.equals(large)).toBe(true);
  });

  test('produces a valid empty archive', () => {
    expect(parseZipSync(buildZip([]))).toHaveLength(0);
  });
});

describe('buildZip bounded allocation', () => {
  test('rejects an entry whose size exceeds the cap without allocating it', () => {
    // A length taken from (hostile or corrupt) data that would drive a
    // multi-gigabyte allocation must be refused before any buffer is built.
    const oversized = { name: 'huge.bin', data: { length: 2 * 1024 * 1024 * 1024 } as unknown as Buffer };
    expect(() => buildZip([oversized])).toThrow();
  });

  test('rejects a negative or non-integer entry size', () => {
    expect(() => buildZip([{ name: 'bad.bin', data: { length: -1 } as unknown as Buffer }])).toThrow();
    expect(() => buildZip([{ name: 'bad.bin', data: { length: 1.5 } as unknown as Buffer }])).toThrow();
  });
});

describe('parseZip corrupt / oversized fields', () => {
  test('throws cleanly on data that is not a ZIP', () => {
    expect(() => parseZipSync(Buffer.from('definitely not a zip'))).toThrow();
    expect(() => parseZipSync(Buffer.alloc(0))).toThrow();
  });

  test('throws on a truncated archive rather than reading past the buffer', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello world') }]);
    // Drop the central directory + EOCD so the directory parse cannot complete.
    const truncated = zip.subarray(0, 20);
    expect(() => parseZipDirectory(truncated)).toThrow();
  });

  test('skips an entry whose declared size runs past the buffer, keeping valid entries', () => {
    const zip = buildZip([
      { name: 'corrupt.dat', data: Buffer.from('AAAA') },
      { name: 'good.dat', data: Buffer.from('BBBB') },
    ]);

    // Overwrite the first central-directory entry's compressed-size field with a
    // value far larger than the archive. A naive parser would try to slice that
    // many bytes; the guard must skip the entry instead.
    const eocdOffset = zip.length - 22;
    const cdOffset = zip.readUInt32LE(eocdOffset + 16);
    expect(zip.readUInt32LE(cdOffset)).toBe(0x02014b50); // central-directory signature
    zip.writeUInt32LE(0xfffffff0, cdOffset + 20); // compressed size

    // The directory still parses (the field is not bounds-checked there)…
    const metas = parseZipDirectory(zip);
    expect(metas).toHaveLength(2);
    expect(metas[0]!.compressedSize).toBe(0xfffffff0);

    // …but decompression skips the corrupt entry and returns only the valid one,
    // never allocating the bogus length.
    const parsed = parseZipSync(zip);
    expect(parsed.map((e) => e.name)).toEqual(['good.dat']);
    expect(parsed[0]!.data.toString()).toBe('BBBB');
  });
});
