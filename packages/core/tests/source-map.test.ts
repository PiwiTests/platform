import { describe, expect, test } from 'vitest';
import {
  decodeDataUrl,
  decodeSourceMap,
  lineStarts,
  normalizeSourcePath,
  offsetToPosition,
  sourceMappingUrl,
} from '../src/source-map';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(n: number): string {
  let v = n < 0 ? (-n << 1) | 1 : n << 1;
  let out = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += B64[digit];
  } while (v > 0);
  return out;
}

/** Encode segments `[genCol, source?]` per generated line, with made-up original positions. */
function encode(lines: Array<Array<[number, number?]>>): string {
  let prevSource = 0;
  let prevOrigLine = 0;
  return lines
    .map((segments) => {
      let prevCol = 0;
      return segments
        .map(([col, source]) => {
          let out = vlq(col - prevCol);
          prevCol = col;
          if (source !== undefined) {
            out += vlq(source - prevSource) + vlq(1 - prevOrigLine) + vlq(0);
            prevSource = source;
            prevOrigLine = 1;
          }
          return out;
        })
        .join(',');
    })
    .join(';');
}

describe('decodeSourceMap', () => {
  const map = decodeSourceMap({
    version: 3,
    sourceRoot: 'webpack://shop/',
    sources: ['./src/Pay.vue', './node_modules/vue/index.js'],
    mappings: encode([[[0, 0], [10, 1], [20]], [], [[4, 1]]]),
  })!;

  test('applies the source root', () => {
    expect(map.sources).toEqual(['webpack://shop/./src/Pay.vue', 'webpack://shop/./node_modules/vue/index.js']);
  });

  test('finds the segment at or before a column', () => {
    expect(map.sourceAt(0, 0)).toBe(0);
    expect(map.sourceAt(0, 9)).toBe(0);
    expect(map.sourceAt(0, 15)).toBe(1);
    expect(map.sourceAt(0, 25)).toBeNull(); // a segment with no source
    expect(map.sourceAt(1, 3)).toBeNull(); // an empty line
    expect(map.sourceAt(2, 2)).toBeNull(); // before the line's first segment
    expect(map.sourceAt(2, 8)).toBe(1);
    expect(map.sourceAt(9, 0)).toBeNull();
  });

  test('reads an index map with sections', () => {
    const indexed = decodeSourceMap({
      version: 3,
      sections: [
        { offset: { line: 0, column: 0 }, map: { version: 3, sources: ['a.ts'], mappings: encode([[[0, 0]]]) } },
        { offset: { line: 5, column: 0 }, map: { version: 3, sources: ['b.ts'], mappings: encode([[[0, 0]]]) } },
      ],
    })!;
    expect(indexed.sources).toEqual(['a.ts', 'b.ts']);
    expect(indexed.sourceAt(0, 3)).toBe(0);
    expect(indexed.sourceAt(5, 3)).toBe(1);
  });

  test('refuses another version', () => {
    expect(decodeSourceMap({ version: 2, sources: [], mappings: '' })).toBeNull();
  });
});

describe('positions and comments', () => {
  test('offsetToPosition', () => {
    const starts = lineStarts('ab\ncde\n\nf');
    expect(starts).toEqual([0, 3, 7, 8]);
    expect(offsetToPosition(starts, 0)).toEqual({ line: 0, column: 0 });
    expect(offsetToPosition(starts, 5)).toEqual({ line: 1, column: 2 });
    expect(offsetToPosition(starts, 8)).toEqual({ line: 3, column: 0 });
  });

  test('sourceMappingUrl reads the last comment', () => {
    expect(sourceMappingUrl('a();\n//# sourceMappingURL=old.map\nb();\n//# sourceMappingURL=app.js.map\n')).toBe(
      'app.js.map',
    );
    expect(sourceMappingUrl('a();')).toBeNull();
  });

  test('decodeDataUrl', () => {
    const json = '{"version":3,"sources":["é.ts"]}';
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
    expect(decodeDataUrl(`data:application/json;charset=utf-8;base64,${b64}`)).toBe(json);
    expect(decodeDataUrl(`data:application/json,${encodeURIComponent(json)}`)).toBe(json);
    expect(decodeDataUrl('app.js.map')).toBeNull();
  });

  test('normalizeSourcePath', () => {
    expect(normalizeSourcePath('webpack://shop/./src/Pay.vue?vue&type=script')).toBe('src/Pay.vue');
    expect(normalizeSourcePath('/@fs/home/me/app/src/a.ts?t=123')).toBe('/home/me/app/src/a.ts');
    expect(normalizeSourcePath('/@fs/C:/app/src/a.ts')).toBe('C:/app/src/a.ts');
    expect(normalizeSourcePath('file:///home/me/app/b.ts')).toBe('/home/me/app/b.ts');
    expect(normalizeSourcePath('../../src/c%20d.ts')).toBe('../../src/c d.ts');
  });
});

describe('code reach', async () => {
  const { executedFunctionOffsets, finalizeCodeReach, reachedSources, scriptRan } = await import('../src/code-reach');
  const source = 'import x from "./x";\nfunction pay() { return 1 }\nfunction idle() {}\npay();\n';
  const entry = {
    url: 'http://localhost:5173/src/pay.ts',
    source,
    functions: [
      { functionName: '', ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }] },
      { functionName: 'pay', ranges: [{ startOffset: 21, endOffset: 48, count: 1 }] },
      { functionName: 'idle', ranges: [{ startOffset: 49, endOffset: 67, count: 0 }] },
    ],
  };

  test('the top level and functions that did not run are left out', () => {
    expect(executedFunctionOffsets(entry)).toEqual([21]);
    expect(scriptRan(entry)).toBe(true);
    expect(scriptRan({ ...entry, functions: [entry.functions[0]!, entry.functions[2]!] })).toBe(false);
  });

  test('offsets map to sources through the map', () => {
    const map = decodeSourceMap({ version: 3, sources: ['a.ts', 'b.ts'], mappings: 'AAAA;ACAA' })!;
    // Line 1 (0-based) starts with source 1: the `pay` function.
    expect([...reachedSources(entry, map)]).toEqual([1]);
  });

  test('finalizeCodeReach keeps repository-relative paths', () => {
    expect(
      finalizeCodeReach(['src/b.ts', './src/a.ts', 'node_modules/vue/x.js', '../outside.ts', '/abs.ts', 'src/a.ts']),
    ).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
