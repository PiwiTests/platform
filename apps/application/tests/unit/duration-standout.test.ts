import { describe, test, expect } from 'vitest';
import {
  STANDOUT_MIN_MS,
  STANDOUT_SHARE,
  durationStandout,
  shareOfTestLabel,
  standoutReasonText,
} from '#shared/duration-standout';

describe('durationStandout', () => {
  test('a duration under 1 s never stands out, whatever its share', () => {
    expect(durationStandout({ ms: 990, testMs: 1000 })).toBeNull();
    expect(durationStandout({ ms: STANDOUT_MIN_MS - 1, testMs: 1200 })).toBeNull();
  });

  test('1 s or more stands out from a third of the test', () => {
    expect(durationStandout({ ms: 1000, testMs: 3000 })).toEqual({ reason: 'share', share: STANDOUT_SHARE });
    expect(durationStandout({ ms: 5000, testMs: 8000 })).toEqual({ reason: 'share', share: 0.625 });
  });

  test('just under a third of the test does not stand out', () => {
    expect(durationStandout({ ms: 1000, testMs: 3001 })).toBeNull();
    expect(durationStandout({ ms: 1200, testMs: 4500 })).toBeNull();
  });

  test('a request that outlasts the test stands out, its share above 1', () => {
    const standout = durationStandout({ ms: 28_400, testMs: 3654 });
    expect(standout?.reason).toBe('share');
    expect(standout!.share).toBeGreaterThan(1);
  });

  test('without a test duration nothing stands out', () => {
    expect(durationStandout({ ms: 5000, testMs: null })).toBeNull();
    expect(durationStandout({ ms: 5000, testMs: undefined })).toBeNull();
    expect(durationStandout({ ms: 5000, testMs: 0 })).toBeNull();
  });

  test('a missing or broken duration never stands out', () => {
    expect(durationStandout({ ms: null, testMs: 1000 })).toBeNull();
    expect(durationStandout({ ms: Number.NaN, testMs: 1000 })).toBeNull();
    expect(durationStandout({ ms: -2000, testMs: 1000 })).toBeNull();
  });
});

describe('standoutReasonText', () => {
  test('names the share of the test, or that it outlasts the test', () => {
    expect(standoutReasonText({ reason: 'share', share: 0.41 })).toBe('41% of the test');
    expect(standoutReasonText({ reason: 'share', share: 1 })).toBe('100% of the test');
    expect(standoutReasonText({ reason: 'share', share: 7.8 })).toBe('longer than the whole test');
  });
});

describe('shareOfTestLabel', () => {
  test('rounds to a whole percent', () => {
    expect(shareOfTestLabel(685, 3654)).toBe('19%');
    expect(shareOfTestLabel(3654, 3654)).toBe('100%');
  });

  test('marks a sliver and a duration longer than the test', () => {
    expect(shareOfTestLabel(5, 3654)).toBe('<1%');
    expect(shareOfTestLabel(28_400, 3654)).toBe('>100%');
  });

  test('a zero duration is 0%, and no test duration gives no label', () => {
    expect(shareOfTestLabel(0, 3654)).toBe('0%');
    expect(shareOfTestLabel(685, 0)).toBe('');
    expect(shareOfTestLabel(685, null)).toBe('');
  });
});
