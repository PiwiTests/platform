import { describe, test, expect } from 'vitest';
import { shouldNudgeFixtures } from '../../shared/capability-nudge';
import type { CapabilityState } from '../../shared/capabilities';

describe('shouldNudgeFixtures', () => {
  test('nudges on a timeout when fixtures are undecided', () => {
    expect(shouldNudgeFixtures({ clueSection: null, isTimeout: true, fixturesState: 'undecided' })).toBe(true);
  });

  test('nudges when the leading clue cites the network requests', () => {
    expect(shouldNudgeFixtures({ clueSection: 'networkRequests', isTimeout: false, fixturesState: 'undecided' })).toBe(
      true,
    );
  });

  test('nudges when the leading clue cites backend server logs', () => {
    expect(shouldNudgeFixtures({ clueSection: 'serverLogs', isTimeout: false, fixturesState: 'undecided' })).toBe(true);
  });

  test('does not nudge for an off-network clue', () => {
    expect(shouldNudgeFixtures({ clueSection: 'ariaSnapshot', isTimeout: false, fixturesState: 'undecided' })).toBe(
      false,
    );
  });

  test('never nudges once fixtures are anything but undecided', () => {
    const states: CapabilityState[] = ['active', 'available', 'declined', 'not-applicable'];
    for (const fixturesState of states) {
      expect(shouldNudgeFixtures({ clueSection: 'networkRequests', isTimeout: true, fixturesState })).toBe(false);
    }
  });
});
