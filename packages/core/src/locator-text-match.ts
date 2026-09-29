/**
 * Playwright's text rules as pure string functions: how `getByText`,
 * `getByLabel` and `hasText` compare a value with an element's text, how
 * `getByRole`'s `name` compares with an accessible name, and how
 * `getByTestId`, `getByPlaceholder`, `getByAltText` and `getByTitle` compare
 * with an attribute. A string is a case-insensitive substring unless `exact`
 * is set, whitespace is collapsed first, and a regex is tested as given.
 *
 * The browser extension's locator engine evaluates chains with these, and
 * locator break prediction compares strings from a diff with them, so both
 * give Playwright's answer.
 */

/** Whitespace collapsed and trimmed, zero-width and soft-hyphen characters dropped. */
export function normalizeWhiteSpace(text: string): string {
  return text
    .replace(/[​­]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** The text of an element as a text predicate reads it. */
export interface MatchableText {
  /** Every text node below the element, concatenated. */
  full: string;
  /** `full` with whitespace collapsed and trimmed. */
  normalized: string;
  /** `normalized` in lower case, filled in by the first case-insensitive comparison. */
  lower?: string;
}

export type TextMatchKind = 'regex' | 'strict' | 'lax';

/**
 * The text predicate for a `getByText`/`getByLabel`/`hasText` value: a regex
 * tests the raw text; an exact string must equal the collapsed text; any other
 * string is a case-insensitive substring of it.
 */
export function textMatcher(
  value: string | RegExp,
  exact: boolean,
): { matcher: (text: MatchableText) => boolean; kind: TextMatchKind } {
  if (typeof value !== 'string') {
    const re = value;
    return { matcher: (text) => re.test(text.full), kind: 'regex' };
  }
  const needle = normalizeWhiteSpace(value);
  if (exact) return { matcher: (text) => text.normalized === needle, kind: 'strict' };
  const lower = needle.toLowerCase();
  return { matcher: (text) => (text.lower ??= text.normalized.toLowerCase()).includes(lower), kind: 'lax' };
}

/** Case-insensitive substring, exact string, or regex match of an attribute value. */
export function attributeMatcher(value: string | RegExp, exact: boolean): (actual: string) => boolean {
  if (typeof value !== 'string') return (actual) => !!actual.match(value);
  if (exact) return (actual) => actual === value;
  const lower = value.toLowerCase();
  return (actual) => actual.toLowerCase().includes(lower);
}

/**
 * Role-name comparison on a name whose whitespace is already collapsed: exact
 * is case-sensitive equality, otherwise a case-insensitive substring.
 */
export function nameMatcher(expected: string | RegExp, exact: boolean): (name: string) => boolean {
  if (typeof expected !== 'string') return (name) => !!name.match(expected);
  const wanted = normalizeWhiteSpace(expected);
  if (exact) return (name) => name === wanted;
  const upper = wanted.toUpperCase();
  return (name) => name.toUpperCase().includes(upper);
}

/** Whether `getByText(value, { exact })` would match an element whose text is `text`. */
export function textMatches(value: string | RegExp, exact: boolean, text: string): boolean {
  return textMatcher(value, exact).matcher({ full: text, normalized: normalizeWhiteSpace(text) });
}

/** Whether `getByRole(role, { name: value, exact })` would match an element named `name`. */
export function nameMatches(value: string | RegExp, exact: boolean, name: string): boolean {
  return nameMatcher(value, exact)(normalizeWhiteSpace(name));
}

/** Whether an attribute locator with `value` would match an attribute whose value is `actual`. */
export function attributeMatches(value: string | RegExp, exact: boolean, actual: string): boolean {
  return attributeMatcher(value, exact)(actual);
}
