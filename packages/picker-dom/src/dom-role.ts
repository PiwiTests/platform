/**
 * Resolve a live DOM element's ARIA role, mirroring `@piwitests/core`'s
 * `resolveAriaRole` (which operates on probed attributes, not live elements).
 * A normally-importable twin of the nested `roleOf` closures inside `probe.ts`
 * and `overlay-anchors.ts`: those must stay self-contained (each of their
 * enclosing functions is independently re-serialized via
 * `Function.prototype.toString()`), so they can't import this — but a host
 * that consumes picker-dom through normal bundling can.
 */
export interface DomRoleMaps {
  tagRoles: Record<string, string>;
  inputRoles: Record<string, string>;
}

// `el` is browser-context (no DOM lib in this package), hence `any`.
export function domRoleOf(el: any, maps: DomRoleMaps): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input') return maps.inputRoles[(el.getAttribute('type') || 'text').toLowerCase()] ?? 'textbox';
  if (tag === 'select') return el.getAttribute('multiple') != null ? 'listbox' : 'combobox';
  if (tag === 'a') return el.getAttribute('href') != null ? 'link' : null;
  return maps.tagRoles[tag] ?? null;
}
