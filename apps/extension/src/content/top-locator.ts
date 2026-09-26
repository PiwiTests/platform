import { probeElementAttrs, type ProbeArg } from '@piwitests/picker-dom';
import {
  generateAlternatives,
  approximateAccessibleName,
  CAPTURED_ATTRIBUTES,
  TAG_TO_ROLE,
  INPUT_TYPE_TO_ROLE,
} from '@piwitests/core/locator-generation';

export interface TopLocatorInfo {
  /** The single top-ranked locator, or null when generateAlternatives found no candidate at all. */
  locator: string | null;
  accessibleName: string | null;
}

/**
 * The probe -> generateAlternatives pipeline collapsed to just the winning
 * candidate, for features that need exactly one locator for an
 * already-picked element rather than the full ranked menu `pick.ts`'s
 * results panel shows (`assertion-suggest.ts`, `session-panel.ts`), and for
 * the hover preview `installDescribeHook` feeds the picker overlay.
 */
export function deriveTopLocator(el: Element): TopLocatorInfo {
  const roleSources = [...new Set(['[role]', 'input', 'select', ...Object.keys(TAG_TO_ROLE)])].join(',');
  const probeArg: ProbeArg = {
    keep: [...CAPTURED_ATTRIBUTES],
    tagRoles: TAG_TO_ROLE,
    inputRoles: INPUT_TYPE_TO_ROLE,
    roleSources,
    includeStructural: true,
  };
  const attrs = probeElementAttrs(el, probeArg);
  const accessibleName = approximateAccessibleName({ ...attrs, accessibleName: null });
  const ranked = generateAlternatives({ ...attrs, accessibleName });
  return { locator: ranked.length > 0 ? ranked[0]!.locator : null, accessibleName };
}

/**
 * Points the shared picker overlay's hover preview at the real ranking engine:
 * `installPickerOverlay` reads `globalThis.__piwiDescribeElement` for the
 * locator it shows on the element and in its banner, so with this installed the
 * expression under the cursor is the one the results panel will rank first,
 * rather than the overlay's own attribute-order approximation.
 *
 * Returns the teardown — call it when the flow ends, so a later pick with no
 * hook installed does not keep answering through this one.
 */
export function installDescribeHook(): () => void {
  const g = globalThis as any;
  g.__piwiDescribeElement = (el: Element): string | null => {
    try {
      return deriveTopLocator(el).locator;
    } catch {
      return null;
    }
  };
  return () => {
    delete g.__piwiDescribeElement;
  };
}
