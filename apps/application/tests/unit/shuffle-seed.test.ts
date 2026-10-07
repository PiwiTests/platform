import { test, expect } from 'vitest';
import { computeMetadataDiff, describeTestOrder, readShuffleSeed } from '#shared/utils/run-metadata';

const shuffled = (shuffleSeed: unknown) => ({ playwrightConfig: { shuffleSeed } });

test('reads the seed of a shuffled run, and none for a run in declared order', () => {
  expect(readShuffleSeed(shuffled('482913775'))).toBe('482913775');
  expect(readShuffleSeed(shuffled(42))).toBe('42');
  expect(readShuffleSeed({ playwrightConfig: {} })).toBeNull();
  expect(readShuffleSeed(null)).toBeNull();
});

test('no seed, so no copyable command, when the seed is not a plain token', () => {
  expect(readShuffleSeed(shuffled('1; rm -rf ~'))).toBeNull();
  expect(readShuffleSeed(shuffled('$(id)'))).toBeNull();
  expect(readShuffleSeed(shuffled('x'.repeat(65)))).toBeNull();
});

test('the test order shows in the environment diff only when it changed', () => {
  expect(describeTestOrder(shuffled('7'))).toBe('Shuffled, seed 7');
  expect(describeTestOrder({})).toBe('Declared order');

  const order = (prev: object, curr: object) =>
    computeMetadataDiff(prev, curr, null, null).find((d) => d.key === 'test_order');
  expect(order({}, {})).toBeUndefined();
  expect(order(shuffled('7'), shuffled('7'))).toBeUndefined();
  expect(order({}, shuffled('7'))).toEqual({
    key: 'test_order',
    label: 'Test order',
    before: 'Declared order',
    after: 'Shuffled, seed 7',
  });
  expect(order(shuffled('7'), shuffled('8'))?.after).toBe('Shuffled, seed 8');
});
