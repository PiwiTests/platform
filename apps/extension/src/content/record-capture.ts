/**
 * Pure helpers for classifying a DOM element's input kind while recording —
 * split out of `record-panel.ts` (the entry point, which calls
 * `probeElementAttrs`/`generateAlternatives` and therefore can't be
 * reconstructed via `Function.prototype.toString()` per the two-strategy
 * rule in `extension/AGENTS.md`) so this half stays plain-unit-testable with
 * no DOM at all.
 */

export type InputKind = 'checkbox' | 'radio' | 'select' | 'text' | null;

/** Maps a tag/type pair to the `inputType` normalizeSteps (in `@piwitests/core/recording`) switches on — null for anything that isn't a checkbox/radio/select. */
export function classifyInputKind(tagName: string, typeAttr: string | null): InputKind {
  const tag = tagName.toLowerCase();
  if (tag === 'select') return 'select';
  if (tag !== 'input') return null;
  const type = (typeAttr ?? 'text').toLowerCase();
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  return 'text';
}

/** Whether a tag/type pair is a password field, one of the fields whose value is never captured (see `sensitive-fields.ts`). */
export function isPasswordInput(tagName: string, typeAttr: string | null): boolean {
  return tagName.toLowerCase() === 'input' && (typeAttr ?? '').toLowerCase() === 'password';
}
