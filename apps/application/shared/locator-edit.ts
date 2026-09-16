/**
 * Turn a locator-healing recommendation into a concrete, ready-to-apply edit for
 * the failing test line. Pure + unit-tested (`tests/unit/locator-edit.test.ts`).
 *
 * The end deliverable of healing is an edited test file, so the panel offers the
 * exact one-line change rather than only a copyable locator string.
 */

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * From an open paren, return the index of its matching close paren, skipping
 * over string literals and nested parens. Returns -1 when unbalanced.
 */
function matchingParen(s: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < s.length; i++) {
    const ch = s[i]!;
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Rewrite the failing locator call on a source line with the recommended
 * locator. Finds the failing method's call (as a whole word, so `getByRole`
 * doesn't match inside `myGetByRole`) and replaces that call — from the method
 * name through its matching close paren — with the recommendation. A chained
 * recommendation (`getByTestId('x').getByRole('button')`) therefore slots in
 * ahead of any trailing `.click()`.
 *
 * Returns null when the method isn't found on the line, the parens are
 * unbalanced, or the replacement would be a no-op — the caller then falls back
 * to showing the line number and a copy button.
 */
export function buildLocatorEdit(
  sourceLine: string,
  failingMethod: string | null | undefined,
  recommendedLocator: string,
): { old: string; new: string } | null {
  if (!sourceLine || !failingMethod || !recommendedLocator) return null;
  const re = new RegExp(`${escapeRegExp(failingMethod)}\\s*\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(sourceLine)) !== null) {
    const methodStart = m.index;
    const before = methodStart > 0 ? sourceLine[methodStart - 1] : '';
    // Skip a hit that's the tail of a longer identifier (e.g. `xGetByRole`).
    if (before && /[A-Za-z0-9_$]/.test(before)) continue;
    const openParen = methodStart + m[0].lastIndexOf('(');
    const close = matchingParen(sourceLine, openParen);
    if (close === -1) return null;
    const next = sourceLine.slice(0, methodStart) + recommendedLocator + sourceLine.slice(close + 1);
    return next === sourceLine ? null : { old: sourceLine, new: next };
  }
  return null;
}

/**
 * Build a two-line unified-diff patch string for `DiffPatch.vue` from a locator
 * edit, with an optional `@@` header naming the call site.
 */
export function locatorEditPatch(edit: { old: string; new: string }, location?: string | null): string {
  const header = location ? `@@ ${location} @@\n` : '';
  return `${header}-${edit.old.trimEnd()}\n+${edit.new.trimEnd()}`;
}

/** One changed locator argument, for the compact args diff when methods match. */
export interface LocatorArgChange {
  key: string;
  from: string | null;
  to: string | null;
}

/**
 * The scalar args that changed between the failing locator and a recommendation
 * of the same method — e.g. `name: 'Pay' → 'Pay now'`. Object/array args are
 * compared by their JSON form. Used when there is no captured source line to
 * rewrite but the recommendation keeps the method family.
 */
export function diffLocatorArgs(
  from: Record<string, unknown> | null | undefined,
  to: Record<string, unknown> | null | undefined,
): LocatorArgChange[] {
  const a = from ?? {};
  const b = to ?? {};
  const stringify = (v: unknown): string | null => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));
  const changes: LocatorArgChange[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = stringify(a[key]);
    const bv = stringify(b[key]);
    if (av !== bv) changes.push({ key, from: av, to: bv });
  }
  return changes;
}

/**
 * A copyable instruction for an AI coding agent to apply the recommended fix —
 * file:line, the broken locator, the replacement, and the current line.
 */
export function buildLocatorFixPrompt(input: {
  location: string | null;
  sourceLine: { line: number; text: string } | null;
  failing: string;
  recommended: string;
}): string {
  const where = input.location ?? (input.sourceLine ? `line ${input.sourceLine.line}` : 'the failing test');
  const lines = [
    `In ${where}, the Playwright locator \`${input.failing}\` no longer matches its element.`,
    `Replace it with \`${input.recommended}\`.`,
  ];
  if (input.sourceLine) lines.push('', 'Current line:', input.sourceLine.text.trim());
  return lines.join('\n');
}
