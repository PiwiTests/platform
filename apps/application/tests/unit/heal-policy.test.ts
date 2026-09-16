import { describe, test, expect } from 'vitest';
import { selectHealEdits, type HealCandidateRow } from '../../server/utils/heal/policy';
import type { LocatorHealingResult, RankedLocator } from '#shared/locator-healing.types';

function ranked(over: Partial<RankedLocator> = {}): RankedLocator {
  return { locator: "getByTestId('pay')", method: 'getByTestId', args: {}, score: 100, ...over };
}

function healing(over: Partial<LocatorHealingResult> = {}): LocatorHealingResult {
  return {
    failingLocator: { method: 'getByRole', args: { name: 'Pay' } },
    fromPriorSuccess: [ranked()],
    fromElementMatch: null,
    fromAriaSnapshot: null,
    source: 'prior-run',
    recommendation: {
      recommended: ranked(),
      durable: null,
      preservesConvention: false,
      hasDurableAlternative: false,
      suggestAddTestId: false,
    },
    capturedAt: null,
    edit: {
      filePath: 'tests/a.spec.ts',
      line: 10,
      oldLine: "  await page.getByRole('button', { name: 'Pay' }).click();",
      newLine: "  await page.getByTestId('pay').click();",
      unifiedDiff: '--- a/tests/a.spec.ts\n+++ b/tests/a.spec.ts\n@@ -10,1 +10,1 @@\n-old\n+new',
    },
    ...over,
  };
}

const row = (over: Partial<HealCandidateRow> = {}): HealCandidateRow => ({
  executionId: 1,
  testCaseId: 1,
  title: 'pays',
  filePath: 'tests/a.spec.ts',
  clusterId: 5,
  owner: '@team',
  ...over,
});

describe('selectHealEdits', () => {
  test('never opens a PR for a result the resolution gate rejected', () => {
    const h = healing({ applicable: false, reason: 'The locator resolved; this is not a locator problem.' });
    expect(selectHealEdits([row()], new Map([[1, h]]), { minScore: 80 })).toEqual([]);
  });

  test('accepts a high-score prior-run edit', () => {
    const edits = selectHealEdits([row()], new Map([[1, healing()]]), { minScore: 80 });
    expect(edits).toHaveLength(1);
    expect(edits[0]!.suggestedLocator).toBe("getByTestId('pay')");
    expect(edits[0]!.clusterId).toBe(5);
    expect(edits[0]!.failingLocator).toContain('getByRole');
  });

  test('rejects a score below the threshold', () => {
    const h = healing({
      recommendation: {
        recommended: ranked({ score: 50 }),
        durable: null,
        preservesConvention: false,
        hasDurableAlternative: false,
        suggestAddTestId: false,
      },
    });
    expect(selectHealEdits([row()], new Map([[1, h]]), { minScore: 80 })).toHaveLength(0);
  });

  test('accepts a low score when it is a user pick', () => {
    const h = healing({
      recommendation: {
        recommended: ranked({ score: 20, pickedByUser: true }),
        durable: null,
        preservesConvention: false,
        hasDurableAlternative: false,
        suggestAddTestId: false,
      },
    });
    const edits = selectHealEdits([row()], new Map([[1, h]]), { minScore: 80 });
    expect(edits).toHaveLength(1);
    expect(edits[0]!.pickedByUser).toBe(true);
  });

  test('rejects an ARIA-snapshot source (not real stability evidence)', () => {
    expect(
      selectHealEdits([row()], new Map([[1, healing({ source: 'aria-snapshot' })]]), { minScore: 80 }),
    ).toHaveLength(0);
  });

  test('rejects a provably-stale prior name unless it is a user pick', () => {
    expect(
      selectHealEdits([row()], new Map([[1, healing({ priorNameMayBeStale: true })]]), { minScore: 80 }),
    ).toHaveLength(0);
  });

  test('rejects when there is no edit or no file path', () => {
    expect(selectHealEdits([row()], new Map([[1, healing({ edit: null })]]), { minScore: 80 })).toHaveLength(0);
    const noPath = healing({ edit: { filePath: null, line: 10, oldLine: 'o', newLine: 'n', unifiedDiff: null } });
    expect(selectHealEdits([row()], new Map([[1, noPath]]), { minScore: 80 })).toHaveLength(0);
  });

  test('collapses two failures sharing one call site to a single edit', () => {
    const map = new Map([
      [1, healing()],
      [2, healing()],
    ]);
    const edits = selectHealEdits([row({ executionId: 1 }), row({ executionId: 2, testCaseId: 2 })], map, {
      minScore: 80,
    });
    expect(edits).toHaveLength(1);
  });
});
