import { describe, test, expect } from 'vitest';
import {
  failureRateUpperBound,
  flakeSuspectLabNote,
  flakeSuspectLabShort,
  planFlakeSuspectOrder,
  topFlakeSuspect,
  type FlakeReproduceVerdict,
  type FlakeSuspectResult,
} from '#shared/flake-lab';

function result(suspectId: string, verdict: FlakeReproduceVerdict, matchingFailures: number): FlakeSuspectResult {
  return {
    suspectId,
    experimentId: 1,
    verdict,
    runs: 10,
    matchingFailures,
    controlRuns: 10,
    controlMatchingFailures: 0,
    pValue: null,
    label: suspectId,
    finishedAt: null,
  };
}

const suspects = [{ id: 'cart' }, { id: 'load' }, { id: 'neighbor' }, { id: 'project' }];

describe('the order the lab runs suspects in', () => {
  test('untested suspects first in rank order, one that did not reproduce last, none dropped', () => {
    const results = new Map([
      ['cart', result('cart', 'not-reproduced', 0)],
      ['neighbor', result('neighbor', 'amplified', 2)],
    ]);
    expect(planFlakeSuspectOrder(suspects, results).map((s) => s.id)).toEqual(['load', 'project', 'neighbor', 'cart']);
  });

  test('a reproduced suspect comes after the untested ones and before those that did not reproduce', () => {
    const results = new Map([
      ['cart', result('cart', 'not-reproduced', 0)],
      ['project', result('project', 'reproduced', 7)],
    ]);
    expect(planFlakeSuspectOrder(suspects, results).map((s) => s.id)).toEqual(['load', 'neighbor', 'project', 'cart']);
  });

  test('rank order without any lab result', () => {
    expect(planFlakeSuspectOrder(suspects, new Map()).map((s) => s.id)).toEqual(suspects.map((s) => s.id));
  });
});

describe('the suspect a test is shown with', () => {
  test('a reproduced suspect, whatever its rank', () => {
    const results = new Map([['project', result('project', 'reproduced', 7)]]);
    expect(topFlakeSuspect(suspects, results)?.id).toBe('project');
  });

  test('else the highest-ranked untested one, ahead of one that did not reproduce', () => {
    const results = new Map([['cart', result('cart', 'not-reproduced', 0)]]);
    expect(topFlakeSuspect(suspects, results)?.id).toBe('load');
  });

  test('one that did not reproduce when nothing else is left, never none', () => {
    const results = new Map([['cart', result('cart', 'not-reproduced', 0)]]);
    expect(topFlakeSuspect([{ id: 'cart' }], results)?.id).toBe('cart');
    expect(topFlakeSuspect([], results)).toBeNull();
  });
});

describe('what clean runs rule out', () => {
  test('ten clean runs bound the failure rate below about 26%', () => {
    expect(failureRateUpperBound(0, 10)).toBeCloseTo(0.259, 3);
    expect(failureRateUpperBound(0, 30)).toBeCloseTo(0.095, 3);
  });

  test('a failure or two widen the bound; no runs bound nothing', () => {
    expect(failureRateUpperBound(1, 10)).toBeCloseTo(0.394, 3);
    expect(failureRateUpperBound(2, 10)).toBeCloseTo(0.507, 3);
    expect(failureRateUpperBound(0, 0)).toBe(1);
    expect(failureRateUpperBound(10, 10)).toBe(1);
  });

  test('a suspect that did not reproduce is explained with its bound', () => {
    expect(flakeSuspectLabNote(result('cart', 'not-reproduced', 0))).toBe(
      'Not reproduced: 0 of 10 runs under it failed the same way, against 0 of 10 without it. 10 runs only show it fails in fewer than 26% of runs under it, so a rarer flake can still come from it; the lab runs it after the untested suspects.',
    );
    expect(flakeSuspectLabShort(result('cart', 'not-reproduced', 0))).toBe('not reproduced 0 of 10 (below 26%)');
  });

  test('a reproduced or amplified suspect in words, an untested one with none', () => {
    expect(flakeSuspectLabNote(result('cart', 'reproduced', 7))).toBe(
      'Reproduced: 7 of 10 runs under it failed the same way, against 0 of 10 without it.',
    );
    expect(flakeSuspectLabNote(result('cart', 'amplified', 2))).toMatch(
      /^Amplified: .*too few to call it reproduced\.$/,
    );
    expect(flakeSuspectLabNote(undefined)).toBeNull();
    expect(flakeSuspectLabShort(result('cart', 'reproduced', 7))).toBe('reproduced 7 of 10');
    expect(flakeSuspectLabShort(undefined)).toBe('untested');
  });
});
