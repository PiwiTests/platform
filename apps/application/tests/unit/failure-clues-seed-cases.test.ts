import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';
import { buildFailureClues, type FailureCluesReport, type FailureClueInput } from '#shared/failure-clues';

/**
 * A frozen baseline of the ordered clue ranking for four seeded executions. The
 * inputs are captured verbatim from the seeded dev database (`loadFailureClueInput`
 * on `/api/test-run-cases/:id/clues`) and committed under `fixtures/`, so the
 * test runs the real `buildFailureClues` against real evidence with no database.
 * The expected `(rule, strength)` pairs are written out literally: a change to
 * the ranking rules surfaces here as a readable diff of what each failure now
 * says on its first screen.
 */

function loadInput(executionId: number): FailureClueInput {
  const path = fileURLToPath(new URL(`./fixtures/failure-clues/exec-${executionId}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as FailureClueInput;
}

/** The ranked clue output reduced to the two fields the baseline pins. */
function ranking(report: FailureCluesReport): Array<[string, string]> {
  return report.clues.map((clue) => [clue.rule, clue.strength]);
}

describe('buildFailureClues — seeded failure ranking baseline', () => {
  test('#37 — checkout, Pay click timeout', () => {
    const report = buildFailureClues(loadInput(37));
    // The blocked element leads; the resolved-locator page-structure change drops
    // to medium and behind the story members; the fixed-before fact left the list.
    expect(ranking(report)).toEqual([
      ['element-present-but-blocked', 'strong'],
      ['console-mentions-target', 'medium'],
      ['slow-request-overlapping-failure', 'medium'],
      ['page-structure-changed', 'medium'],
    ]);
    expect(report.story?.id).toBe('blocked-by-pending-request');
  });

  test('#13 — same cluster, earlier run', () => {
    const report = buildFailureClues(loadInput(13));
    expect(ranking(report)).toEqual([
      ['element-present-but-blocked', 'strong'],
      ['console-mentions-target', 'medium'],
      ['slow-request-overlapping-failure', 'medium'],
      ['page-structure-changed', 'medium'],
      ['environment-changed', 'weak'],
    ]);
    expect(report.story?.id).toBe('blocked-by-pending-request');
  });

  test("#781 — cluster #10's latest occurrence, toHaveCount on getByRole('row')", () => {
    const report = buildFailureClues(loadInput(781));
    // A Playwright-version and color-scheme diff only, so environment stays weak.
    expect(ranking(report)).toEqual([['environment-changed', 'weak']]);
    expect(report.story).toBeNull();
  });

  test("#587 — cluster #5's latest occurrence, .modal.is-open timeout", () => {
    const report = buildFailureClues(loadInput(587));
    expect(ranking(report)).toEqual([]);
    expect(report.story).toBeNull();
  });
});
