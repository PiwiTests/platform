import { describe, expect, test } from 'vitest';
import { flakeLabDisplay, flakeLabOutcome } from '../../app/composables/useDesktopLocalRuns';

const DEFAULTS = { suspect: null, all: false, runs: null, budgetMinutes: null };

describe('a Flake Lab session in the desktop app', () => {
  test('shows the command it runs, with only the options chosen', () => {
    expect(flakeLabDisplay(1842, DEFAULTS)).toBe('piwi flake 1842');
    expect(flakeLabDisplay(1842, { ...DEFAULTS, suspect: 2, runs: 6, budgetMinutes: 20 })).toBe(
      'piwi flake 1842 --suspect 2 --runs 6 --budget 20m',
    );
    expect(flakeLabDisplay(1842, { ...DEFAULTS, all: true })).toBe('piwi flake 1842 --all');
  });

  test('reads its exit code as a verdict, and anything else as an error', () => {
    expect(flakeLabOutcome(0)).toBe('reproduced');
    expect(flakeLabOutcome(1)).toBe('not-reproduced');
    expect(flakeLabOutcome(2)).toBe('error');
    expect(flakeLabOutcome(null)).toBe('error');
  });
});
