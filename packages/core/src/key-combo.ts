/**
 * A key or a shortcut as Playwright writes it (`Enter`, `ControlOrMeta+K`,
 * `Shift+Tab`), with each key in the words `name` gives it, and a letter in
 * capitals, as on the key.
 */
export function keyCombo(combo: string, name: (key: string) => string): string {
  const parts = combo.length > 1 ? combo.split(/\+(?=.)/) : [combo];
  return parts.map((part) => (part.length === 1 ? part.toUpperCase() : name(part))).join('+');
}
