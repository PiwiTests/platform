import { describe, test, expect } from 'vitest';
import {
  parseAriaCandidates,
  textSimilarity,
  fingerprintPresent,
  matchRenamedElement,
  freshLocatorsFromCandidate,
  elementMatchAlternatives,
} from '#shared/locator-fingerprint';

describe('parseAriaCandidates', () => {
  test('parses role + name lines', () => {
    const aria = ['- button "Open page"', '- heading "Welcome" [level=1]', '- textbox "Email"'].join('\n');
    expect(parseAriaCandidates(aria)).toEqual([
      { role: 'button', name: 'Open page' },
      { role: 'heading', name: 'Welcome' },
      { role: 'textbox', name: 'Email' },
    ]);
  });

  test('keeps roles without a name but drops structural wrappers', () => {
    const aria = ['- button', '- generic', '- group', '- list', '- link "Home"'].join('\n');
    expect(parseAriaCandidates(aria)).toEqual([
      { role: 'button', name: null },
      { role: 'link', name: 'Home' },
    ]);
  });

  test('handles indentation, refs, and escaped quotes', () => {
    const aria = ['    - button "Save \\"now\\"" [ref=e5]'].join('\n');
    expect(parseAriaCandidates(aria)).toEqual([{ role: 'button', name: 'Save "now"' }]);
  });

  test('returns [] for empty input', () => {
    expect(parseAriaCandidates(null)).toEqual([]);
    expect(parseAriaCandidates('')).toEqual([]);
  });
});

describe('textSimilarity', () => {
  test('identical strings score 1', () => {
    expect(textSimilarity('Open page', 'Open page')).toBe(1);
  });

  test('is case- and punctuation-insensitive', () => {
    expect(textSimilarity('Open Page!', 'open page')).toBe(1);
  });

  test('partial token overlap is between 0 and 1', () => {
    // {go,to,page} vs {open,page} → 2*1/(3+2) = 0.4
    expect(textSimilarity('Go to page', 'Open page')).toBeCloseTo(0.4, 5);
  });

  test('disjoint strings score 0', () => {
    expect(textSimilarity('Submit', 'Cancel')).toBe(0);
  });

  test('empty handling', () => {
    expect(textSimilarity('', '')).toBe(1);
    expect(textSimilarity('Submit', '')).toBe(0);
    expect(textSimilarity(null, 'x')).toBe(0);
  });
});

describe('fingerprintPresent', () => {
  const candidates = [
    { role: 'button', name: 'Open page' },
    { role: 'link', name: 'Home' },
  ];

  test('true when same role keeps a near-identical name', () => {
    expect(fingerprintPresent({ role: 'link', name: 'Home' }, candidates)).toBe(true);
  });

  test('false when the name changed (renamed element)', () => {
    expect(fingerprintPresent({ role: 'button', name: 'Go to page' }, candidates)).toBe(false);
  });

  test('false when fingerprint has no name', () => {
    expect(fingerprintPresent({ role: 'button', name: null }, candidates)).toBe(false);
  });
});

describe('matchRenamedElement', () => {
  test('matches a unique same-role candidate even when the name changed', () => {
    const m = matchRenamedElement({ role: 'button', name: 'Go to page' }, [{ role: 'button', name: 'Open page' }]);
    expect(m?.candidate).toEqual({ role: 'button', name: 'Open page' });
    expect(m?.confidence).toBeGreaterThan(0.5);
  });

  test('picks the best name-similarity among several same-role candidates', () => {
    const m = matchRenamedElement({ role: 'button', name: 'Go to page' }, [
      { role: 'button', name: 'Cancel' },
      { role: 'button', name: 'Open page' },
    ]);
    expect(m?.candidate.name).toBe('Open page');
  });

  test('returns null when several candidates and none clears the similarity floor', () => {
    const m = matchRenamedElement({ role: 'button', name: 'Delete' }, [
      { role: 'button', name: 'Save' },
      { role: 'button', name: 'Cancel' },
    ]);
    expect(m).toBeNull();
  });

  test('returns null when no candidate shares the role', () => {
    expect(matchRenamedElement({ role: 'button', name: 'x' }, [{ role: 'link', name: 'y' }])).toBeNull();
  });
});

describe('freshLocatorsFromCandidate', () => {
  test('button yields getByRole + getByText', () => {
    const alts = freshLocatorsFromCandidate({ role: 'button', name: 'Open page' });
    expect(alts.map((a) => a.method)).toEqual(['getByRole', 'getByText']);
    expect(alts[1]!.locator).toBe("getByText('Open page')");
  });

  test('textbox yields getByRole + getByLabel', () => {
    const alts = freshLocatorsFromCandidate({ role: 'textbox', name: 'Email' });
    expect(alts.map((a) => a.method)).toEqual(['getByRole', 'getByLabel']);
  });

  test('escapes single quotes in the name', () => {
    const alts = freshLocatorsFromCandidate({ role: 'button', name: "It's here" });
    expect(alts[0]!.locator).toBe("getByRole('button', { name: 'It\\'s here' })");
  });

  test('no name yields nothing', () => {
    expect(freshLocatorsFromCandidate({ role: 'button', name: null })).toEqual([]);
  });
});

/**
 * The end-to-end "button text changed" case: the test still says
 * getByText('Go to page'), but the button now reads "Open page". The fresh
 * suggestion must come from the current page.
 */
describe('elementMatchAlternatives', () => {
  const renamedAria = ['- navigation', '  - button "Open page"', '- contentinfo'].join('\n');

  test('suggests fresh locators for a renamed element', () => {
    const alts = elementMatchAlternatives({ role: 'button', name: 'Go to page' }, renamedAria);
    expect(alts).not.toBeNull();
    expect(alts!.some((a) => a.locator === "getByText('Open page')")).toBe(true);
    expect(alts!.some((a) => a.locator === "getByRole('button', { name: 'Open page' })")).toBe(true);
  });

  test('returns null when the element is unchanged (still on the page)', () => {
    const aria = '- button "Go to page"';
    expect(elementMatchAlternatives({ role: 'button', name: 'Go to page' }, aria)).toBeNull();
  });

  test('returns null without an ARIA snapshot', () => {
    expect(elementMatchAlternatives({ role: 'button', name: 'Go to page' }, null)).toBeNull();
  });

  test('returns null when the fingerprint is empty', () => {
    expect(elementMatchAlternatives({ role: null, name: null }, renamedAria)).toBeNull();
  });
});
