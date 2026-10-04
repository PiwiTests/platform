import { describe, test, expect } from 'vitest';
import {
  DEFAULT_AUTO_HEAL,
  resolveAutoHealSettings,
  normalizeBranchPrefix,
  healSignature,
  healDedupeKey,
  healBranchName,
  isHealBranch,
  parseHealBranch,
  healEditKey,
} from '#shared/auto-heal';

describe('resolveAutoHealSettings', () => {
  test('empty input yields the disabled defaults', () => {
    expect(resolveAutoHealSettings(undefined)).toEqual(DEFAULT_AUTO_HEAL);
    expect(resolveAutoHealSettings(null)).toEqual(DEFAULT_AUTO_HEAL);
  });

  test('enabled requires a strict true', () => {
    expect(resolveAutoHealSettings({ enabled: true }).enabled).toBe(true);
    // @ts-expect-error — exercising an untrusted payload
    expect(resolveAutoHealSettings({ enabled: 'yes' }).enabled).toBe(false);
  });

  test('projects are integer-filtered and de-duplicated', () => {
    // @ts-expect-error — untrusted payload
    expect(resolveAutoHealSettings({ projects: [1, 1, 2, -3, 0, 'x', 4.5] }).projects).toEqual([1, 2]);
  });

  test('minScore and maxOpenPrs are clamped', () => {
    expect(resolveAutoHealSettings({ minScore: 999 }).minScore).toBe(100);
    expect(resolveAutoHealSettings({ minScore: -5 }).minScore).toBe(0);
    expect(resolveAutoHealSettings({ maxOpenPrs: 999 }).maxOpenPrs).toBe(50);
  });

  test('draft defaults on and only a strict false turns it off', () => {
    expect(resolveAutoHealSettings({}).draft).toBe(true);
    expect(resolveAutoHealSettings({ draft: false }).draft).toBe(false);
  });

  test('commit message is trimmed and capped', () => {
    expect(resolveAutoHealSettings({ commitMessage: '  fix: x  ' }).commitMessage).toBe('fix: x');
    expect(resolveAutoHealSettings({ commitMessage: 'a'.repeat(200) }).commitMessage.length).toBe(100);
  });
});

describe('normalizeBranchPrefix', () => {
  test('strips unsafe chars, leading slashes, and forces one trailing slash', () => {
    expect(normalizeBranchPrefix('piwi/heal')).toBe('piwi/heal/');
    expect(normalizeBranchPrefix('/piwi/heal/')).toBe('piwi/heal/');
    expect(normalizeBranchPrefix('piwi heal!')).toBe('piwiheal/');
    expect(normalizeBranchPrefix('   ')).toBe(DEFAULT_AUTO_HEAL.branchPrefix);
  });
});

describe('healSignature / dedupeKey / branchName', () => {
  const edits = [
    { filePath: 'tests/b.spec.ts', line: 20, suggestedLocator: "getByTestId('y')" },
    { filePath: 'tests/a.spec.ts', line: 10, suggestedLocator: "getByTestId('x')" },
  ];

  test('signature is order-independent', () => {
    const reversed = [...edits].reverse();
    expect(healSignature(edits)).toBe(healSignature(reversed));
  });

  test('signature changes when a target locator changes', () => {
    const changed = [{ ...edits[0]!, suggestedLocator: "getByTestId('z')" }, edits[1]!];
    expect(healSignature(changed)).not.toBe(healSignature(edits));
  });

  test('dedupe key and branch name embed project, run and signature', () => {
    const sig = healSignature(edits);
    expect(healDedupeKey(7, sig)).toBe(`heal:v1:7:${sig}`);
    expect(healBranchName('piwi/heal/', 42, sig)).toBe(`piwi/heal/42-${sig}`);
  });
});

describe('isHealBranch', () => {
  test('matches the configured prefix', () => {
    expect(isHealBranch('piwi/heal/42-abc', 'piwi/heal/')).toBe(true);
    expect(isHealBranch('main', 'piwi/heal/')).toBe(false);
    expect(isHealBranch(null, 'piwi/heal/')).toBe(false);
  });
});

describe('parseHealBranch', () => {
  test('reads back the run id and signature healBranchName wrote', () => {
    const branch = healBranchName('piwi/heal/', 42, 'abcd1234');
    expect(parseHealBranch(branch, 'piwi/heal/')).toEqual({ runId: 42, signature: 'abcd1234' });
  });

  test('is null for another prefix, a hand-made branch under the prefix, or no branch', () => {
    expect(parseHealBranch('piwi/heal/42-abcd1234', 'bots/heal/')).toBeNull();
    expect(parseHealBranch('piwi/heal/my-fix', 'piwi/heal/')).toBeNull();
    expect(parseHealBranch('piwi/heal/42-abcd1234-2', 'piwi/heal/')).toBeNull();
    expect(parseHealBranch(null, 'piwi/heal/')).toBeNull();
  });
});

describe('healEditKey', () => {
  const edit = {
    filePath: 'tests/a.spec.ts',
    failingLocator: 'getByRole({"name":"Pay"})',
    suggestedLocator: "getByTestId('pay')",
  };

  test('ignores the line, so a shifted call site keeps its key', () => {
    expect(healEditKey({ ...edit })).toBe(healEditKey({ ...edit, line: 99 } as typeof edit));
  });

  test('changes with the file, the failing locator or the replacement', () => {
    const key = healEditKey(edit);
    expect(healEditKey({ ...edit, filePath: 'tests/b.spec.ts' })).not.toBe(key);
    expect(healEditKey({ ...edit, failingLocator: null })).not.toBe(key);
    expect(healEditKey({ ...edit, suggestedLocator: "getByTestId('buy')" })).not.toBe(key);
  });
});
