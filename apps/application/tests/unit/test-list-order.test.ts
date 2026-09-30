import { describe, test, expect } from 'vitest';
import {
  compareFileOrder,
  compareRunOrder,
  describeGroupKeys,
  fileGroupRows,
  type TestPosition,
  type TestListRow,
} from '~/utils/test-list-order';

interface Row extends TestPosition {
  title: string;
  duration: number;
}

function row(
  title: string,
  filePath: string,
  suitePath: string[],
  line: number | null,
  startedAt: number | null,
  duration = 0,
): Row {
  return { title, filePath, suitePath, line, column: line === null ? null : 3, startedAt, duration };
}

// A file declared as:
//   test('intro')                        line 3
//   describe('Checkout') {
//     test('pays')                       line 8
//     describe('Guest') { test('guest')  line 12 }
//     test('refunds')                    line 20
//   }
//   test('outro')                        line 30
// run in parallel, so the start times are not the declaration order.
const intro = row('intro', 'b.spec.ts', [], 3, 400, 50);
const pays = row('pays', 'b.spec.ts', ['Checkout'], 8, 100, 10);
const guest = row('guest', 'b.spec.ts', ['Checkout', 'Guest'], 12, 300, 40);
const refunds = row('refunds', 'b.spec.ts', ['Checkout'], 20, 200, 30);
const outro = row('outro', 'b.spec.ts', [], 30, null, 20);
const other = row('other', 'a.spec.ts', [], 5, 50, 60);
const ALL = [outro, guest, intro, refunds, other, pays];

const allOpen = () => true;

function render(rows: TestListRow<Row>[]): string[] {
  return rows.map((r) => `${'  '.repeat(r.depth)}${r.kind === 'group' ? `[${r.label}]` : r.test.title}`);
}

function grouped(options: { describe: boolean; compare: (a: Row, b: Row) => number; positional: boolean }) {
  return render(
    fileGroupRows(ALL, {
      ...options,
      position: (t) => t,
      isOpen: allOpen,
      testKey: (t) => t.title,
    }),
  );
}

describe('orders', () => {
  test('file order: path, then line, then column, a test with no line last', () => {
    const sorted = [...ALL, row('unplaced', 'a.spec.ts', [], null, 10)].sort(compareFileOrder).map((t) => t.title);
    expect(sorted).toEqual(['other', 'unplaced', 'intro', 'pays', 'guest', 'refunds', 'outro']);
    expect(compareFileOrder({ ...pays, column: 1 }, { ...pays, column: 9 })).toBeLessThan(0);
  });

  test('run order: first start, then the tests that never started in file order', () => {
    const sorted = [...ALL].sort(compareRunOrder).map((t) => t.title);
    expect(sorted).toEqual(['other', 'pays', 'refunds', 'guest', 'intro', 'outro']);
  });
});

describe('fileGroupRows', () => {
  test('File + Describe in file order mirrors the source file', () => {
    expect(grouped({ describe: true, compare: compareFileOrder, positional: true })).toEqual([
      '[a.spec.ts]',
      '  other',
      '[b.spec.ts]',
      '  intro',
      '  [Checkout]',
      '    pays',
      '    [Guest]',
      '      guest',
      '    refunds',
      '  outro',
    ]);
  });

  test('in run order a describe block sits where its first test started', () => {
    expect(grouped({ describe: true, compare: compareRunOrder, positional: true })).toEqual([
      '[a.spec.ts]',
      '  other',
      '[b.spec.ts]',
      '  [Checkout]',
      '    pays',
      '    refunds',
      '    [Guest]',
      '      guest',
      '  intro',
      '  outro',
    ]);
  });

  test('another sort orders the tests of each block; the blocks keep their place in the file', () => {
    const byDuration = (a: Row, b: Row) => b.duration - a.duration;
    expect(grouped({ describe: true, compare: byDuration, positional: false })).toEqual([
      '[a.spec.ts]',
      '  other',
      '[b.spec.ts]',
      '  [Checkout]',
      '    [Guest]',
      '      guest',
      '    refunds',
      '    pays',
      '  intro',
      '  outro',
    ]);
  });

  test('the File grouping lists each file flat, files in path order', () => {
    expect(grouped({ describe: false, compare: compareFileOrder, positional: true })).toEqual([
      '[a.spec.ts]',
      'other',
      '[b.spec.ts]',
      'intro',
      'pays',
      'guest',
      'refunds',
      'outro',
    ]);
  });

  test('a closed group hides what is under it but still counts its tests', () => {
    const rows = fileGroupRows(ALL, {
      describe: true,
      compare: compareFileOrder,
      positional: true,
      position: (t) => t,
      isOpen: (key) => !key.startsWith('describe:b.spec.ts\x1fCheckout'),
      testKey: (t) => t.title,
    });
    expect(render(rows)).toEqual(['[a.spec.ts]', '  other', '[b.spec.ts]', '  intro', '  [Checkout]', '  outro']);
    const checkout = rows.find((r) => r.kind === 'group' && r.label === 'Checkout');
    expect(checkout).toMatchObject({ depth: 1, isFile: false, filePath: 'b.spec.ts' });
    expect(checkout?.kind === 'group' && checkout.tests.map((t) => t.title).sort()).toEqual([
      'guest',
      'pays',
      'refunds',
    ]);
  });

  test('describeGroupKeys names every group a test sits under', () => {
    expect(describeGroupKeys(guest)).toEqual([
      'file:b.spec.ts',
      'describe:b.spec.ts\x1fCheckout',
      'describe:b.spec.ts\x1fCheckout\x1fGuest',
    ]);
  });
});
