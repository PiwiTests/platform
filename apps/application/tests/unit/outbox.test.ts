import { describe, test, expect } from 'vitest';
import { nextAttempt, OUTBOX_BACKOFF_MINUTES, OUTBOX_MAX_ATTEMPTS } from '../../server/utils/outbox';

const NOW = new Date('2026-01-01T00:00:00.000Z');

describe('nextAttempt', () => {
  test('reschedules pending with progressive backoff before the cap', () => {
    for (let attempts = 1; attempts < OUTBOX_MAX_ATTEMPTS; attempts++) {
      const r = nextAttempt(attempts, NOW, NOW);
      expect(r.status).toBe('pending');
      const mins = OUTBOX_BACKOFF_MINUTES[Math.min(attempts, OUTBOX_BACKOFF_MINUTES.length - 1)]!;
      expect(r.scheduledFor!.getTime()).toBe(NOW.getTime() + mins * 60_000);
    }
  });

  test('marks failed at the attempt cap, keeping the current schedule', () => {
    const current = new Date('2026-01-02T00:00:00.000Z');
    const r = nextAttempt(OUTBOX_MAX_ATTEMPTS, NOW, current);
    expect(r.status).toBe('failed');
    expect(r.scheduledFor).toBe(current);
  });

  test('an explicit retry-after wins over the backoff table', () => {
    const r = nextAttempt(1, NOW, NOW, 90_000);
    expect(r.status).toBe('pending');
    expect(r.scheduledFor!.getTime()).toBe(NOW.getTime() + 90_000);
  });

  test('a zero or negative retry-after falls back to the backoff table', () => {
    const r = nextAttempt(1, NOW, NOW, 0);
    expect(r.scheduledFor!.getTime()).toBe(NOW.getTime() + OUTBOX_BACKOFF_MINUTES[1]! * 60_000);
  });
});
