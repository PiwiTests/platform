import { describe, test, expect } from 'vitest';
import { runEventBus } from '../../server/utils/run-events';

describe('runEventBus.isWatched', () => {
  test('is true while the run has a subscriber, and only for that run', () => {
    expect(runEventBus.isWatched(9101)).toBe(false);

    const unsubscribeFirst = runEventBus.subscribe(9101, () => {});
    const unsubscribeSecond = runEventBus.subscribe(9101, () => {});
    expect(runEventBus.isWatched(9101)).toBe(true);
    expect(runEventBus.isWatched(9102)).toBe(false);

    unsubscribeFirst();
    expect(runEventBus.isWatched(9101)).toBe(true);
    unsubscribeSecond();
    expect(runEventBus.isWatched(9101)).toBe(false);
  });
});
