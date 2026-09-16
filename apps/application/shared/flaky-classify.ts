/**
 * Flaky-test root-cause classification — pure keyword scoring over recent
 * failure evidence (error messages, step titles/errors, browser spread). No
 * DB/network access, so it works identically on the server and in the demo's
 * in-browser handler (`shared/handlers/flaky-classify.ts`).
 */

export type FlakyRootCause = 'timing' | 'network' | 'assertion' | 'environment' | 'other';

interface ClassifyInput {
  errorMessages: string[];
  stepErrors: string[];
  stepNames: string[];
  networkErrorCount: number;
  status5xxCount: number;
  /**
   * How many of the test's recent flaky executions had a request that failed (or
   * returned 5xx) on the failing attempt but not on the attempt that passed on
   * retry. That delta is the sharpest available evidence that the flakiness is a
   * network problem, so each vote weighs several keyword matches.
   */
  attemptDiffNetworkVotes?: number;
  browserDistribution: Record<string, number>;
}

/** Weight of one attempt-diff network vote, in keyword-match equivalents. */
const ATTEMPT_DIFF_NETWORK_WEIGHT = 3;

const TIMING_KEYWORDS = [
  'timeout',
  'to be visible',
  'to be enabled',
  'waitFor',
  'not found within',
  'element is not visible',
];

const NETWORK_KEYWORDS = [
  'net::',
  'ERR_',
  '5xx',
  'status 500',
  'status 502',
  'status 503',
  'ECONNREFUSED',
  'waitForResponse',
];

const ASSERTION_MARKERS = [
  'expect(',
  'Expected:',
  'to equal',
  'toBe',
  'toMatch',
  'Screenshot comparison',
  'toMatchSnapshot',
];

const TIMING_NETWORK_MARKERS = [...TIMING_KEYWORDS, ...NETWORK_KEYWORDS];

function countKeywordMatches(texts: string[], keywords: string[]): number {
  let count = 0;
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        count++;
      }
    }
  }
  return count;
}

function hasAnyKeyword(texts: string[], keywords: string[]): boolean {
  const lowerTexts = texts.map((t) => t.toLowerCase());
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  return lowerTexts.some((t) => lowerKeywords.some((kw) => t.includes(kw)));
}

const hasTimingOrNetwork = (texts: string[]) => hasAnyKeyword(texts, TIMING_NETWORK_MARKERS);

export function classifyFlakyRootCause(input: ClassifyInput): FlakyRootCause {
  const allTexts = [...input.errorMessages, ...input.stepErrors, ...input.stepNames];

  if (allTexts.length === 0) return 'other';

  // Environment check: fails on exactly one browser repeatedly,
  // while other browsers also ran (have > 0) but didn't fail
  const entries = Object.entries(input.browserDistribution);
  const browsersWithFails = entries.filter(([, count]) => count > 0);
  const totalBrowserRuns = entries.reduce((sum, [, count]) => sum + count, 0);
  if (browsersWithFails.length === 1 && browsersWithFails[0]![1] >= 3 && entries.length >= 2 && totalBrowserRuns >= 3) {
    return 'environment';
  }

  const timingCount = countKeywordMatches(allTexts, TIMING_KEYWORDS);
  const networkCount =
    countKeywordMatches(allTexts, NETWORK_KEYWORDS) +
    input.networkErrorCount +
    input.status5xxCount +
    (input.attemptDiffNetworkVotes ?? 0) * ATTEMPT_DIFF_NETWORK_WEIGHT;
  const assertionCount = countKeywordMatches(allTexts, ASSERTION_MARKERS);

  // Assertion requires NO timing/network keywords present
  const cleanAssertionCount = assertionCount > 0 && !hasTimingOrNetwork(allTexts) ? assertionCount : 0;

  const scores: Array<{ category: FlakyRootCause; score: number }> = [
    { category: 'timing', score: timingCount },
    { category: 'network', score: networkCount },
    { category: 'assertion', score: cleanAssertionCount },
  ];

  scores.sort((a, b) => b.score - a.score);

  if (scores[0]!.score > 0) return scores[0]!.category;
  return 'other';
}
