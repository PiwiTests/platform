import { describe, test, expect } from 'vitest';
import {
  SLOWER_FACTOR,
  SLOWER_MIN_DELTA_MS,
  STANDOUT_MIN_MS,
  STANDOUT_SHARE,
  durationStandout,
  isMuchSlower,
  shareOfTestLabel,
  standoutReasonText,
  stepMatchKey,
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

describe('isMuchSlower', () => {
  test('twice as long and 1 s longer is much slower', () => {
    expect(isMuchSlower(2000, 1000)).toBe(true);
    expect(isMuchSlower(5000, 600)).toBe(true);
    expect(isMuchSlower(SLOWER_FACTOR * 1000, 1000)).toBe(true);
  });

  test('twice as long but less than 1 s longer is not', () => {
    expect(isMuchSlower(1800, 900)).toBe(false);
    expect(isMuchSlower(1200, 300)).toBe(false);
    expect(isMuchSlower(300 + SLOWER_MIN_DELTA_MS - 1, 300)).toBe(false);
  });

  test('1 s longer but less than twice as long is not', () => {
    expect(isMuchSlower(5000, 3000)).toBe(false);
    expect(isMuchSlower(1999, 1000)).toBe(false);
  });

  test('faster or equal is never much slower', () => {
    expect(isMuchSlower(1000, 1000)).toBe(false);
    expect(isMuchSlower(500, 3000)).toBe(false);
  });
});

describe('stepMatchKey', () => {
  test('two steps with the same label and params share a key', () => {
    const a = { title: 'Click', subtitle: "getByRole('button', { name: 'Pay' })", params: { force: true } };
    const b = { title: 'Click', subtitle: "getByRole('button', { name: 'Pay' })", params: { force: true } };
    expect(stepMatchKey(a)).toBe(stepMatchKey(b));
  });

  test('params tell apart two steps that share a label', () => {
    const first = { title: 'Click', params: { locator: "getByRole('button', { name: 'Pay' })" } };
    const second = { title: 'Click', params: { locator: "getByRole('link', { name: 'Back' })" } };
    expect(stepMatchKey(first)).not.toBe(stepMatchKey(second));
  });

  test('the subtitle is part of the label, so two targets stay apart', () => {
    expect(stepMatchKey({ title: 'Fill', subtitle: "getByLabel('Email')" })).not.toBe(
      stepMatchKey({ title: 'Fill', subtitle: "getByLabel('Name')" }),
    );
  });

  test('the title-only and the title-plus-subtitle shapes of one step match', () => {
    expect(stepMatchKey({ title: "Click getByRole('button')" })).toBe(
      stepMatchKey({ title: "Click getByRole('button')", subtitle: "getByRole('button')" }),
    );
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
