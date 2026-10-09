/**
 * Where a locator-healing recommendation comes from, in the words both the
 * Locator fix panel and the Next line use: a clause that reads after
 * "From locator healing, " and after the panel's "Recommended fix · ".
 *
 * Pure: no Nuxt imports, shared by the app and the server.
 */
import type { LocatorHealingSource } from '#shared/locator-healing.types';

const SOURCE_PHRASE: Record<Exclude<LocatorHealingSource, 'none'>, string> = {
  'diff-rename': 'taken from the rename in this change',
  'prior-run': 'captured in the last passing run',
  fingerprint: 'captured in a prior run, at a shifted line',
  'cross-test': 'captured by another test in this project',
  'element-match': 'found on the failing page',
  'aria-snapshot': 'read from the failure-time ARIA snapshot',
};

/**
 * The provenance clause for a healing source, or null when the source names no
 * provenance. A pick a person confirmed in the locator picker outranks the
 * source it was picked from.
 */
export function healingSourcePhrase(
  source: LocatorHealingSource | null | undefined,
  pickedByUser?: boolean | null,
): string | null {
  if (pickedByUser) return 'confirmed by hand in the locator picker';
  if (!source || source === 'none') return null;
  return SOURCE_PHRASE[source] ?? null;
}
