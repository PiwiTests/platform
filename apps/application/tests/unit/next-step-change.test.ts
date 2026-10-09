import { describe, test, expect } from 'vitest';
import { buildNextStepChange } from '../../app/utils/next-step-change';
import { buildHealEdit } from '#shared/heal-edit';
import { renderSnippet, SOURCE_FILES, storyByClusterId } from '#shared/demo/failure-stories.mjs';
import type { PatchValidation, PatchValidationStatus } from '#shared/patch';
import type { NextStepKind } from '#shared/next-step';

/**
 * The change a Next step shows and copies, from the shapes the seed produces:
 * cluster 1's diagnosed patch, cluster 2's locator edit, and #587's
 * recommendation, which has no edit.
 */

const step = (kind: NextStepKind) => ({ kind });
const validation = (status: PatchValidationStatus): PatchValidation => ({
  status,
  filesChecked: 1,
  filesInPatch: 1,
  errors: [],
});

const clusterPatch = storyByClusterId(1)!.diagnosis.fix.patch as string;
const diagnosis = { patch: clusterPatch, patchValidation: validation('applies') };

const spec = 'tests/checkout/checkout.spec.ts';
const specLines = SOURCE_FILES[spec] as string[];
const recommended = "getByTestId('email-field').getByRole('textbox')";
const edit = buildHealEdit({
  location: `${spec}:23:10`,
  sourceLine: { line: 23, text: specLines[22]! },
  failingMethod: 'getByLabel',
  recommendedLocator: recommended,
  testSource: renderSnippet(specLines, { declLine: 22, failingLine: 23, context: 30 }),
})!;
const healingWithEdit = {
  failingLocator: { method: 'getByLabel', args: { text: 'Email address' } },
  recommendation: { recommended: { locator: recommended } },
  edit,
  location: `${spec}:23:10`,
} as never;

const healingWithoutEdit = {
  failingLocator: { method: 'locator', args: { selector: '.modal.is-open' } },
  recommendation: { recommended: { locator: "getByRole('button', { name: 'Open modal' })" } },
  edit: null,
  location: 'tests/ui/modal.spec.ts:15:16',
} as never;

describe('buildNextStepChange', () => {
  test('an apply step shows a window on the diagnosed patch and copies the whole patch', () => {
    const change = buildNextStepChange(step('apply-patch'), { diagnosis, healing: null })!;
    expect(change).toMatchObject({
      kind: 'patch',
      copyText: clusterPatch,
      recommendedLocator: null,
      file: 'tests/helpers/payment.ts',
      location: null,
      validation: 'Applies cleanly',
    });
    expect(change.excerpt).toMatch(/^@@ -1,2 \+1,2 @@\n-import type \{ Page \}/);
    expect(change.hiddenLines).toBeGreaterThan(0);
  });

  test('a replace step with an edit shows a window on its diff, counts no unchanged line, and copies it whole', () => {
    const change = buildNextStepChange(step('replace-locator'), { diagnosis, healing: healingWithEdit })!;
    expect(change).toMatchObject({
      kind: 'locator',
      copyText: edit.unifiedDiff,
      recommendedLocator: recommended,
      file: spec,
      location: `${spec}:23:10`,
      hiddenLines: 0,
      validation: null,
    });
    expect(change.excerpt.split('\n')).toEqual([
      '@@ -22,3 +22,3 @@',
      ` ${specLines[21]}`,
      `-${edit.oldLine}`,
      `+${edit.newLine}`,
      ` ${specLines[23]}`,
    ]);
  });

  test('a replace step without an edit shows the failing locator against the recommended one', () => {
    const change = buildNextStepChange(step('replace-locator'), { diagnosis: null, healing: healingWithoutEdit })!;
    expect(change).toEqual({
      kind: 'locator',
      copyText: null,
      recommendedLocator: "getByRole('button', { name: 'Open modal' })",
      excerpt: "-locator('.modal.is-open')\n+getByRole('button', { name: 'Open modal' })",
      file: 'tests/ui/modal.spec.ts',
      location: 'tests/ui/modal.spec.ts:15:16',
      hiddenLines: 0,
      validation: null,
    });
  });

  test('states the validation only when the patch applies', () => {
    const label = (status: PatchValidationStatus) =>
      buildNextStepChange(step('apply-patch'), {
        diagnosis: { patch: clusterPatch, patchValidation: validation(status) },
        healing: null,
      })?.validation;
    expect(label('applies')).toBe('Applies cleanly');
    expect(label('applies-with-offset')).toBe('Applies with offset');
    for (const status of ['stale-file', 'invalid', 'unchecked'] as const) expect(label(status)).toBeNull();
    expect(
      buildNextStepChange(step('apply-patch'), {
        diagnosis: { patch: clusterPatch, patchValidation: null },
        healing: null,
      })?.validation,
    ).toBeNull();
  });

  test('is null for a step that copies no change, or before its data loads', () => {
    for (const kind of ['follow-diagnosis', 'mark-resolved', 'reproduce', 'diagnose'] as const) {
      expect(buildNextStepChange(step(kind), { diagnosis, healing: healingWithEdit })).toBeNull();
    }
    expect(buildNextStepChange(null, { diagnosis, healing: healingWithEdit })).toBeNull();
    expect(buildNextStepChange(step('apply-patch'), { diagnosis: null, healing: null })).toBeNull();
    expect(
      buildNextStepChange(step('apply-patch'), { diagnosis: { patch: null, patchValidation: null }, healing: null }),
    ).toBeNull();
    expect(buildNextStepChange(step('replace-locator'), { diagnosis, healing: null })).toBeNull();
  });
});
