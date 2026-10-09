/**
 * The sections of a failure page's fix toolbox: their keys, their labels, the
 * one order they render in, and the section each next step points at. Shared
 * by `Toolbox` and the two failure pages, which list the sections they have.
 */
import type { NextStepKind } from '#shared/next-step';

export type FixSectionKey =
  | 'locator-fix'
  | 'fix-plan'
  | 'diagnosis'
  | 'fixed-before'
  | 'verify'
  | 'reproduce'
  | 'blocked';

export const FIX_SECTION_LABELS: Record<FixSectionKey, string> = {
  diagnosis: 'Diagnosis',
  'locator-fix': 'Locator fix',
  verify: 'Verify',
  reproduce: 'Reproduce and bisect',
  'fixed-before': 'Fixed before',
  blocked: 'Blocked by this failure',
  'fix-plan': 'Fix plan',
};

/** One fixed order, regardless of the order a page lists its sections in. */
export const FIX_SECTION_ORDER: FixSectionKey[] = [
  'diagnosis',
  'locator-fix',
  'verify',
  'reproduce',
  'fixed-before',
  'blocked',
  'fix-plan',
];

/** The section each next step points at; a step that acts on its own has none. */
export const NEXT_STEP_SECTION: Partial<Record<NextStepKind, FixSectionKey>> = {
  'apply-patch': 'diagnosis',
  'follow-diagnosis': 'diagnosis',
  diagnose: 'diagnosis',
  'replace-locator': 'locator-fix',
  'rerun-in-ci': 'verify',
  reproduce: 'reproduce',
  'open-blocker': 'blocked',
};

/** The section the next step points at, when the page shows it; null otherwise. */
export function fixSectionForNextStep(
  kind: NextStepKind | null | undefined,
  available: readonly FixSectionKey[],
): FixSectionKey | null {
  const target = kind ? NEXT_STEP_SECTION[kind] : undefined;
  return target && available.includes(target) ? target : null;
}
