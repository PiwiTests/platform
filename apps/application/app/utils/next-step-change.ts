/**
 * The change a code-change Next step copies, as one object the Next row both
 * shows and copies from, so what the reader sees is what lands on the
 * clipboard. Built from what each failure page already loads: the cluster
 * diagnosis's patch (its fix plan) for the apply step, and the locator healing
 * of the execution the policy read for the replace step.
 *
 * Pure: no Nuxt imports, so it is unit-tested on its own.
 */
import type { NextStep } from '#shared/next-step';
import type { FixPlan } from '#shared/fix-plan.types';
import type { LocatorHealingResult } from '#shared/locator-healing.types';
import { locatorExpression } from '#shared/locator-healing';
import { parseCallsiteLocation } from '#shared/callsite-location';
import { patchApplies, patchExcerpt, patchValidationLabel } from '#shared/patch';

/** The body lines of a change the Next row shows before "N more lines". */
const NEXT_STEP_EXCERPT_LINES = 6;

export interface NextStepChange {
  /** A diagnosed patch, or a locator replacement. */
  kind: 'patch' | 'locator';
  /** The whole unified diff the apply command carries; null when only a locator is known. */
  copyText: string | null;
  /** The locator a replace step recommends. */
  recommendedLocator: string | null;
  /** What the row shows, as a diff: a window on `copyText`, or the failing and the recommended locator. */
  excerpt: string;
  /** The changed file, which picks the highlighting. */
  file: string | null;
  /** The call site a replace step rewrites (`file:line:col`). */
  location: string | null;
  /** The lines of `copyText` the excerpt leaves out. */
  hiddenLines: number;
  /** The patch's validation in the words of its badge, when the patch applies. */
  validation: string | null;
}

/**
 * The change behind a Next step, or null for a step that copies no code change
 * or whose data is not loaded. An apply step shows a window on the diagnosed
 * patch; a replace step a window on the locator edit's diff, or, without an
 * edit, the failing locator against the recommended one.
 */
export function buildNextStepChange(
  step: Pick<NextStep, 'kind'> | null | undefined,
  data: {
    diagnosis: Pick<NonNullable<FixPlan['diagnosis']>, 'patch' | 'patchValidation'> | null | undefined;
    healing: Pick<LocatorHealingResult, 'failingLocator' | 'recommendation' | 'edit' | 'location'> | null | undefined;
  },
): NextStepChange | null {
  if (step?.kind === 'apply-patch') {
    const patch = data.diagnosis?.patch;
    const excerpt = patch ? patchExcerpt(patch, NEXT_STEP_EXCERPT_LINES) : null;
    if (!patch || !excerpt) return null;
    const status = data.diagnosis?.patchValidation?.status;
    return {
      kind: 'patch',
      copyText: patch,
      recommendedLocator: null,
      excerpt: excerpt.diff,
      file: excerpt.file,
      location: null,
      hiddenLines: excerpt.hiddenLines,
      validation: status && patchApplies(status) ? patchValidationLabel(status) : null,
    };
  }

  if (step?.kind === 'replace-locator') {
    const healing = data.healing;
    const recommended = healing?.recommendation?.recommended?.locator ?? null;
    if (!healing || !recommended) return null;
    const location = healing.location ?? null;
    const diff = healing.edit?.unifiedDiff ?? null;
    const excerpt = diff ? patchExcerpt(diff, NEXT_STEP_EXCERPT_LINES) : null;
    if (diff && excerpt) {
      return {
        kind: 'locator',
        copyText: diff,
        recommendedLocator: recommended,
        excerpt: excerpt.diff,
        file: excerpt.file,
        location,
        hiddenLines: excerpt.hiddenLines,
        validation: null,
      };
    }
    const failing = healing.failingLocator
      ? locatorExpression(healing.failingLocator.method, healing.failingLocator.args)
      : null;
    return {
      kind: 'locator',
      copyText: null,
      recommendedLocator: recommended,
      excerpt: [...(failing ? [`-${failing}`] : []), `+${recommended}`].join('\n'),
      file: parseCallsiteLocation(location)?.file ?? null,
      location,
      hiddenLines: 0,
      validation: null,
    };
  }

  return null;
}
