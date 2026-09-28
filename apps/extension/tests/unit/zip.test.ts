import { describe, it, expect } from 'vitest';
import { crc32 as nodeCrc32 } from 'node:zlib';
import { createZip, crc32, dataUrlBytes } from '../../src/shared/zip.js';
import { readStoredZip } from '../zip-reader.js';

describe('createZip', () => {
  it('stores each file with its name and bytes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 7]);
    const zip = createZip([
      { name: 'steps.json', data: '{"v":1}' },
      { name: 'screenshots/1-marked.png', data: png },
      { name: 'notes/é.md', data: '# Café' },
    ]);
    const files = readStoredZip(zip);
    expect([...files.keys()]).toEqual(['steps.json', 'screenshots/1-marked.png', 'notes/é.md']);
    expect(new TextDecoder().decode(files.get('steps.json'))).toBe('{"v":1}');
    expect([...files.get('screenshots/1-marked.png')!]).toEqual([...png]);
    expect(new TextDecoder().decode(files.get('notes/é.md'))).toBe('# Café');
  });

  it('writes the checksum zip readers verify', () => {
    const bytes = new TextEncoder().encode('The quick brown fox jumps over the lazy dog');
    expect(crc32(bytes)).toBe(nodeCrc32(bytes));
    expect(crc32(new Uint8Array())).toBe(0);
    const zip = createZip([{ name: 'a.txt', data: bytes }]);
    expect(new DataView(zip.buffer).getUint32(14, true)).toBe(nodeCrc32(bytes));
  });

  it('decodes a base64 data URL', () => {
    expect([...dataUrlBytes('data:image/png;base64,AAEC/w==')]).toEqual([0, 1, 2, 255]);
  });
});
