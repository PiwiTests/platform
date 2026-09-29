/**
 * A sentence split around the Playwright locators written into it — a failure
 * cluster's name, `Timeout on getByLabel('Email') in checkout.spec.ts` — so a
 * heading can render each locator as code and the rest as prose.
 */
export interface LocatorTextPart {
  kind: 'text' | 'locator';
  text: string;
}

/** A quoted string, so a parenthesis inside a name never ends the call. */
const STRING = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|` + '`(?:[^`\\\\]|\\\\.)*`';
/** The arguments of one call: anything but parentheses, strings, and one level of nested parentheses. */
const ARGS = String.raw`\((?:[^()'"` + '`' + String.raw`]|${STRING}|\([^()]*\))*\)`;

/**
 * A locator call — `getByRole(…)`, `locator(…)`, `frameLocator(…)`, optionally on
 * `page.` — with the calls chained onto it (`.first()`, `.nth(2)`, `.filter(…)`).
 */
const LOCATOR_IN_TEXT_RE = new RegExp(
  String.raw`\b(?:page\.)?(?:getBy[A-Z]\w*|locator|frameLocator)${ARGS}(?:\.\w+${ARGS})*`,
  'g',
);

/** Split `text` into prose and the locators written into it, in order. */
export function splitLocatorParts(text: string): LocatorTextPart[] {
  const parts: LocatorTextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(LOCATOR_IN_TEXT_RE)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: 'text', text: text.slice(last, start) });
    parts.push({ kind: 'locator', text: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}
