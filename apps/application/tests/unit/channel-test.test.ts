import { describe, test, expect, vi, afterEach } from 'vitest';

const { rememberTestedDestination, wasDestinationTested } =
  await import('../../server/utils/notifications/channel-test');

describe('tested destinations', () => {
  afterEach(() => vi.useRealTimers());

  test('a tested destination counts for the same owner and exact destination only', () => {
    const slack = { type: 'slack' as const, config: { webhookUrl: 'https://hooks.slack.com/services/T/B/1' } };
    rememberTestedDestination('7', slack);
    expect(wasDestinationTested('7', slack)).toBe(true);
    expect(wasDestinationTested('8', slack)).toBe(false);
    expect(
      wasDestinationTested('7', { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/services/T/B/2' } }),
    ).toBe(false);
    expect(wasDestinationTested('7', { type: 'teams', config: slack.config })).toBe(false);
  });

  test('a webhook counts only with the same signing secret', () => {
    const hook = { type: 'webhook' as const, config: { url: 'https://ci.example.com/piwi' }, secret: 'one' };
    rememberTestedDestination('1', hook);
    expect(wasDestinationTested('1', hook)).toBe(true);
    expect(wasDestinationTested('1', { ...hook, secret: 'two' })).toBe(false);
    expect(wasDestinationTested('1', { ...hook, secret: null })).toBe(false);
  });

  test('a test stops counting after a quarter of an hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T10:00:00Z'));
    const email = { type: 'email' as const, config: { address: 'qa@example.com' } };
    rememberTestedDestination('3', email);
    vi.setSystemTime(new Date('2026-09-27T10:14:00Z'));
    expect(wasDestinationTested('3', email)).toBe(true);
    vi.setSystemTime(new Date('2026-09-27T10:16:00Z'));
    expect(wasDestinationTested('3', email)).toBe(false);
  });
});
