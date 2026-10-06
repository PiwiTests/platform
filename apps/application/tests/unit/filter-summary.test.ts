import { describe, expect, test } from 'vitest';
import { filterBarSummary, hiddenRunsPhrase } from '../../app/utils/filter-summary';

const DEFAULTS = { environments: [], branches: [], fullRunsOnly: true, allBranches: false };

describe('filterBarSummary', () => {
  test('names every control the bar shows, as it is set', () => {
    expect(filterBarSummary(DEFAULTS)).toBe('All environments · all branches · full runs only');
    expect(filterBarSummary({ ...DEFAULTS, environments: ['staging'], fullRunsOnly: false })).toBe(
      'staging · all branches · partial runs included',
    );
    expect(filterBarSummary({ ...DEFAULTS, environments: ['a', 'b'], branches: ['x', 'y'] })).toBe(
      '2 environments · 2 branches · full runs only',
    );
  });

  test('with the branch policy, no branch picked reads the default branch', () => {
    const options = { branchPolicy: true, defaultBranch: 'main' };
    expect(filterBarSummary(DEFAULTS, options)).toBe('All environments · default branch (main) · full runs only');
    expect(filterBarSummary({ ...DEFAULTS, allBranches: true }, options)).toBe(
      'All environments · all branches · full runs only',
    );
    expect(filterBarSummary({ ...DEFAULTS, branches: ['release'] }, options)).toBe(
      'All environments · release · full runs only',
    );
  });

  test('leaves out the controls the bar does not show, and appends what is hidden', () => {
    expect(filterBarSummary(DEFAULTS, { branches: false, hidden: [hiddenRunsPhrase(3, 'partial')] })).toBe(
      'All environments · full runs only · 3 partial runs hidden',
    );
  });
});

describe('hiddenRunsPhrase', () => {
  test('counts in words', () => {
    expect(hiddenRunsPhrase(1, 'partial')).toBe('1 partial run hidden');
    expect(hiddenRunsPhrase(1, 'other-branches')).toBe('1 run on another branch hidden');
    expect(hiddenRunsPhrase(4, 'other-branches')).toBe('4 runs on other branches hidden');
  });
});
