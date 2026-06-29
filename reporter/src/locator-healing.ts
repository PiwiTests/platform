import * as path from 'path';

/**
 * Reporter-local locator healing — pure functions for alternative generation,
 * stability scoring, and the Playwright method-surface constants shared with
 * the fixture proxy. No Playwright dependency — takes raw element attributes,
 * returns ranked locator suggestions.
 */

// ── Types (structurally compatible with shared/locator-healing.types.ts) ─────

export interface RankedLocator {
  locator: string;
  method: string;
  args: Record<string, unknown>;
  /** 0-100 stability score. data-testid=100, semantic CSS=35-40, hash-suffixed=10. */
  score: number;
}

export interface ElementAttributes {
  tagName: string;
  attributes: Record<string, string | null>;
  textContent: string | null;
  accessibleName: string | null;
  center: { x: number; y: number } | null;
}

export interface LocatorSnapshot {
  location: string | null;
  stepIndex: number;
  used: {
    method: string;
    args: unknown[];
    raw: string;
  };
  element: {
    tagName: string;
    attributes: Record<string, string | null>;
    textContent: string | null;
    accessibleName: string | null;
    center: { x: number; y: number } | null;
  } | null;
  alternatives: RankedLocator[];
}

// ── Playwright method surface (shared with the fixture proxy) ────────────────

/**
 * Page-level locator-building methods wrapped by the capture proxy. Imported by
 * both `reporter/src/fixtures.ts` and the dogfooding `application/tests/fixtures.ts`
 * so the two stay in sync (a prior drift missed `scrollIntoViewIfNeeded`).
 */
export const LOCATOR_METHODS: string[] = [
  'getByRole',
  'getByTestId',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
  'locator',
];

/**
 * Methods that can be chained onto a wrapped locator. Locator-creating chains
 * (those also in `LOCATOR_METHODS`) update the origin; positional/filter chains
 * (`first`, `nth`, `filter`, …) narrow without changing locator identity.
 */
export const CHAIN_METHODS: string[] = [
  'first',
  'nth',
  'last',
  'filter',
  'and',
  'or',
  'locator',
  'getByRole',
  'getByTestId',
  'getByText',
  'getByLabel',
  'getByPlaceholder',
  'getByAltText',
  'getByTitle',
];

/** Locator action methods that trigger element capture. */
export const ACTION_METHODS: string[] = [
  'click',
  'fill',
  'check',
  'uncheck',
  'selectOption',
  'dblclick',
  'tap',
  'hover',
  'press',
  'type',
  'clear',
  'setInputFiles',
  'dragTo',
  'focus',
  'blur',
  'scrollIntoViewIfNeeded',
];

/** Chain methods that create a new locator scope (origin tracks the chain call). */
export const LOCATOR_CREATING_CHAINS: ReadonlySet<string> = new Set(LOCATOR_METHODS);

/**
 * Element attributes to capture after a successful action, passed into the
 * in-page `evaluate`. Shared so the reporter and dogfooding fixtures capture
 * the same attribute set.
 */
export const CAPTURED_ATTRIBUTES: string[] = [
  'id',
  'class',
  'name',
  'data-testid',
  'placeholder',
  'alt',
  'title',
  'aria-label',
  'role',
  'type',
  'href',
  'value',
];

// ── ARIA role resolution ─────────────────────────────────────────────────────

/** Implicit ARIA role for an HTML tag (when no explicit `role` is set). */
const TAG_TO_ROLE: Record<string, string> = {
  a: 'link',
  button: 'button',
  nav: 'navigation',
  main: 'main',
  article: 'article',
  section: 'region',
  form: 'form',
  img: 'img',
  figure: 'figure',
  figcaption: 'caption',
  blockquote: 'blockquote',
  table: 'table',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  dialog: 'dialog',
  output: 'status',
  progress: 'progressbar',
  meter: 'meter',
  select: 'listbox',
  textarea: 'textbox',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  details: 'group',
  summary: 'button',
  search: 'search',
};

/** Implicit ARIA role for an `<input>` keyed by its `type` attribute. */
const INPUT_TYPE_TO_ROLE: Record<string, string> = {
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  search: 'searchbox',
  number: 'spinbutton',
  text: 'textbox',
  email: 'textbox',
  tel: 'textbox',
  url: 'textbox',
  password: 'textbox',
};

/**
 * Resolve the ARIA role for an element. An explicit `role` attribute wins;
 * otherwise the implicit role is derived from the tag name (and `type` for
 * `<input>`). Returns null when the element has no ARIA role (e.g. `<div>`,
 * `<span>`, `<a>` without `href`) — `getByRole` is not a valid locator for
 * such elements and other alternatives take over.
 */
export function resolveAriaRole(attrs: ElementAttributes): string | null {
  const explicit = attrs.attributes['role'];
  if (explicit) return explicit;

  const tag = attrs.tagName;
  if (!tag) return null;

  if (tag === 'input') {
    const type = (attrs.attributes['type'] ?? 'text').toLowerCase();
    return INPUT_TYPE_TO_ROLE[type] ?? 'textbox';
  }

  if (tag === 'a') {
    return attrs.attributes['href'] != null ? 'link' : null;
  }

  return TAG_TO_ROLE[tag] ?? null;
}

// ── Alternative generation ───────────────────────────────────────────────────

const attr = (a: ElementAttributes, key: string): string | null => a.attributes[key] || null;
const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/**
 * Build a ranked list of alternative locators from the captured element
 * attributes. The list is sorted descending by stability score.
 *
 * Only generates alternatives that differ from each other — no duplicates
 * of the same locator expression.
 */
export function generateAlternatives(attrs: ElementAttributes): RankedLocator[] {
  const alts: RankedLocator[] = [];
  const seen = new Set<string>();
  const add = (loc: RankedLocator) => {
    if (!seen.has(loc.locator)) {
      seen.add(loc.locator);
      alts.push(loc);
    }
  };

  const { accessibleName } = attrs;
  const tag = attrs.tagName;
  const role = resolveAriaRole(attrs);

  // 1. data-testid — highest stability (100)
  const testId = attr(attrs, 'data-testid');
  if (testId) {
    add({
      locator: `getByTestId('${esc(testId)}')`,
      method: 'getByTestId',
      args: { testId },
      score: 100,
    });
  }

  // 2. role + accessible name from browser ARIA tree (85-95)
  if (role && accessibleName) {
    add({
      locator: `getByRole('${role}', { name: '${esc(accessibleName)}' })`,
      method: 'getByRole',
      args: { role, name: accessibleName },
      score: 90,
    });
  }

  // 3. role + explicit aria-label (85, fallback when no browser-computed name)
  const ariaLabel = attr(attrs, 'aria-label');
  if (role && ariaLabel && ariaLabel !== accessibleName) {
    add({
      locator: `getByRole('${role}', { name: '${esc(ariaLabel)}' })`,
      method: 'getByRole',
      args: { role, name: ariaLabel },
      score: 85,
    });
  }

  // 4. getByLabel — for form fields with associated <label> (85)
  if (accessibleName && ['input', 'select', 'textarea'].includes(tag)) {
    add({
      locator: `getByLabel('${esc(accessibleName)}')`,
      method: 'getByLabel',
      args: { label: accessibleName },
      score: 85,
    });
  }

  // 5. getByPlaceholder — for inputs (80)
  const placeholder = attr(attrs, 'placeholder');
  if (placeholder) {
    add({
      locator: `getByPlaceholder('${esc(placeholder)}')`,
      method: 'getByPlaceholder',
      args: { placeholder },
      score: 80,
    });
  }

  // 6. getByText — from visible text content (70-80)
  if (attrs.textContent && attrs.textContent.length < 80) {
    add({
      locator: `getByText('${esc(attrs.textContent)}')`,
      method: 'getByText',
      args: { text: attrs.textContent },
      score: 75,
    });
  }

  // 7. locator('#id') — if id exists and doesn't look auto-generated (50-70)
  const id = attr(attrs, 'id');
  if (id && !isAutoGenerated(id)) {
    add({
      locator: `locator('#${esc(id)}')`,
      method: 'locator',
      args: { selector: `#${id}` },
      score: 65,
    });
  }

  // 8. locator('[name="..."]') — for form elements (60)
  const name = attr(attrs, 'name');
  if (name) {
    add({
      locator: `locator('[name="${esc(name)}"]')`,
      method: 'locator',
      args: { selector: `[name="${name}"]` },
      score: 60,
    });
  }

  // 9. getByAltText — for images (60)
  const alt = attr(attrs, 'alt');
  if (alt) {
    add({
      locator: `getByAltText('${esc(alt)}')`,
      method: 'getByAltText',
      args: { text: alt },
      score: 60,
    });
  }

  // 10. getByTitle (50)
  const title = attr(attrs, 'title');
  if (title) {
    add({
      locator: `getByTitle('${esc(title)}')`,
      method: 'getByTitle',
      args: { title },
      score: 50,
    });
  }

  // 11. CSS class-based locators — capped at 3 most stable classes
  const clsStr = attr(attrs, 'class');
  if (clsStr) {
    const classes = clsStr
      .split(/\s+/)
      .filter((c) => c.length > 1)
      .map((cls) => ({
        cls,
        score: classifyCssStability(cls),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    for (const { cls, score } of classes) {
      add({
        locator: `locator('.${esc(cls)}')`,
        method: 'locator',
        args: { selector: `.${cls}` },
        score,
      });
    }
  }

  return alts.sort((a, b) => b.score - a.score);
}

// ── CSS class stability ──────────────────────────────────────────────────────

/**
 * Score a CSS class name on a 0-40 stability scale.
 *
 * Heuristics (inherited from common CSS-naming conventions):
 * - Hash-like suffixes (≥4 hex chars) → 10 — auto-generated, fragile
 * - CSS-in-JS patterns (css-, sc-, emotion-, styled-, _) → 15
 * - Tailwind/utility classes → 25
 * - BEM-style semantic → 35
 * - Plain semantic → 40
 */
export function classifyCssStability(className: string): number {
  // Hex hash patterns: contains 8+ consecutive hex digits
  if (/[a-f0-9]{8,}/i.test(className)) return 10;

  // CSS-in-JS patterns — check before utility/semantic since prefixes like
  // "css-", "emotion-" are generated and fragile
  if (/^(?:css|sc|emotion|styled)-/i.test(className)) return 15;

  // Tailwind/utility classes
  if (
    /^(bg|text|border|shadow|opacity|font|w-|h-|m[tblrxy]?-|p[tblrxy]?-|flex|grid|gap|rounded|absolute|relative|fixed|sticky|block|inline|hidden|overflow|z-|top-|right-|bottom-|left-|inset-|justify-|items-|self-|content-|order-|col-|row-)/.test(
      className,
    )
  )
    return 25;

  // BEM-style: block__element--modifier
  if (/__/.test(className) || /--/.test(className)) return 35;

  // Plain semantic class: hyphenated word pairs or camelCase
  if (/^[a-z]+(-[a-z]+)+$/.test(className)) return 40;
  if (/^[a-z]+[A-Z][a-zA-Z]+$/.test(className)) return 40;

  // Hyphenated strings with digit-containing suffixes that look hashed
  if (className.includes('_')) return 15;
  if (/^[a-z]+-[a-z0-9]{5,}$/.test(className) && /[0-9]/.test(className)) return 15;

  // Unknown — score conservatively
  return 15;
}

// ── Auto-generation detection ────────────────────────────────────────────────

/**
 * Detects GUID-like, auto-incremented, or hash-suffixed IDs that are
 * likely regenerated on each render and unstable for testing.
 */
export function isAutoGenerated(value: string): boolean {
  // GUID / UUID patterns
  if (/^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)) return true;
  // Hash-like (8+ hex chars)
  if (/^[a-f0-9]{8,}$/i.test(value)) return true;
  // Numeric auto-increment with hash suffix
  if (/^[a-z]+-\d+$/.test(value)) return true;
  // Random-looking CSS-in-JS IDs
  if (/^(emotion-|styled-|css-|sc-)/.test(value)) return true;
  // Angular-style generated IDs (ng-xxx-N)
  if (value.startsWith('ng-')) return true;
  return false;
}

// ── Accessible name extraction ───────────────────────────────────────────────

/**
 * Extract the accessible name from a YAML-like ariaSnapshot() output.
 *
 * Format example:
 *   - button "Submit order"
 *   - heading "Welcome, Alice"
 *   - textbox "Email" [ref=e12]
 *   - generic
 *
 * Returns the first quoted string after the role, or null if none found.
 */
export function extractAccessibleName(ariaSnapshot: string | null): string | null {
  if (!ariaSnapshot) return null;

  // Match the role line:  - role "name" [...]
  // The name is the first double-quoted string after the role keyword.
  const match = ariaSnapshot.match(/- \w+ "([^"]+)"/);
  if (match) return match[1];

  return null;
}

/**
 * Approximate the accessible name from HTML attributes when ariaSnapshot()
 * is unavailable. Priority: aria-label > text content > title > placeholder.
 */
export function approximateAccessibleName(attrs: ElementAttributes): string | null {
  const a = attrs.attributes;

  const ariaLabel = a['aria-label'];
  if (ariaLabel) return ariaLabel;

  if (attrs.textContent) return attrs.textContent;

  const title = a['title'];
  if (title) return title;

  const placeholder = a['placeholder'];
  if (placeholder) return placeholder;

  return null;
}

// ── Runtime locator suggestion (the "element changed" case) ──────────────────

/** A failed locator action, used to suggest a fresh locator from the live page. */
export interface FailedLocatorInfo {
  method: string;
  args: unknown[];
}

export interface LocatorSuggestion {
  /** The failed locator rendered as source, e.g. `getByText('Go to page')`. */
  failing: string;
  /** Fresh locator suggestions for the element's current identity, best first. */
  suggestions: string[];
}

/** Name-based locator methods — the only ones whose target can be re-found by accessible name. */
const NAME_BASED_METHODS = new Set([
  'getByText',
  'getByRole',
  'getByLabel',
  'getByPlaceholder',
  'getByTitle',
  'getByAltText',
]);

const escAttr = (s: string): string => s.replaceAll('\\', '\\\\').replaceAll("'", "\\'");

/** Parse `ariaSnapshot()` lines into role/name pairs (mirrors the server-side matcher). */
function parseAriaRoleName(ariaSnapshot: string): Array<{ role: string; name: string | null }> {
  const out: Array<{ role: string; name: string | null }> = [];
  for (const line of ariaSnapshot.split('\n')) {
    const m = /^\s*-\s+([a-z]+)(?:\s+"((?:[^"\\]|\\.)*)")?/i.exec(line);
    if (!m) continue;
    const role = m[1];
    const name = m[2] == null ? null : m[2].replace(/\\(.)/g, '$1');
    if (!name && (role === 'generic' || role === 'group' || role === 'list' || role === 'paragraph')) continue;
    out.push({ role, name });
  }
  return out;
}

/** Token-set (Dice) similarity, 0-1, case- and punctuation-insensitive. */
function nameSimilarity(a: string | null, b: string | null): number {
  const tok = (s: string | null): Set<string> =>
    new Set(
      (s ?? '')
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter(Boolean),
    );
  const sa = tok(a);
  const sb = tok(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let common = 0;
  for (const t of sa) if (sb.has(t)) common++;
  return (2 * common) / (sa.size + sb.size);
}

const SUGG_TEXT_ROLES = new Set([
  'button',
  'link',
  'heading',
  'menuitem',
  'tab',
  'option',
  'cell',
  'columnheader',
  'rowheader',
  'gridcell',
  'treeitem',
  'listitem',
  'checkbox',
  'radio',
  'switch',
]);
const SUGG_FIELD_ROLES = new Set(['textbox', 'combobox', 'searchbox', 'spinbutton', 'slider']);

/** Extract the role (for getByRole) and the targeted accessible name from a failed locator's args. */
function failedNameAndRole(failed: FailedLocatorInfo): { role: string | null; name: string | null } {
  if (failed.method === 'getByRole') {
    const role = typeof failed.args[0] === 'string' ? (failed.args[0] as string) : null;
    const opts = failed.args[1] as Record<string, unknown> | undefined;
    const name = opts && typeof opts.name === 'string' ? (opts.name as string) : null;
    return { role, name };
  }
  const first = failed.args.find((a) => typeof a === 'string');
  return { role: null, name: typeof first === 'string' ? (first as string) : null };
}

/** Render the failed locator back to source for the annotation message. */
function renderFailing(failed: FailedLocatorInfo): string {
  const { role, name } = failedNameAndRole(failed);
  if (failed.method === 'getByRole') {
    return name
      ? `getByRole('${escAttr(role ?? '')}', { name: '${escAttr(name)}' })`
      : `getByRole('${escAttr(role ?? '')}')`;
  }
  return `${failed.method}('${escAttr(name ?? '')}')`;
}

/** Build fresh locator suggestions for a matched candidate, with the failed method's style first. */
function freshSuggestions(candidate: { role: string; name: string }, failedMethod: string): string[] {
  const out: string[] = [];
  const role = candidate.role;
  const name = candidate.name;
  const push = (s: string) => {
    if (!out.includes(s)) out.push(s);
  };

  const roleLoc = `getByRole('${escAttr(role)}', { name: '${escAttr(name)}' })`;
  const textLoc = `getByText('${escAttr(name)}')`;
  const labelLoc = `getByLabel('${escAttr(name)}')`;

  // Same-style first: a broken getByText is re-suggested as getByText where viable.
  if (failedMethod === 'getByText' && SUGG_TEXT_ROLES.has(role)) push(textLoc);
  if (failedMethod === 'getByLabel' && SUGG_FIELD_ROLES.has(role)) push(labelLoc);

  push(roleLoc);
  if (SUGG_TEXT_ROLES.has(role)) push(textLoc);
  else if (SUGG_FIELD_ROLES.has(role)) push(labelLoc);

  return out;
}

/**
 * Best-effort runtime suggestion for a locator that matched nothing: find the
 * element on the *current* page that the failed locator most likely targeted
 * (by accessible name similarity, restricted to the failed role when given) and
 * return fresh locators for it.
 *
 * Unlike the server lookup this has no pre-captured fingerprint — only the
 * failed locator + the live page — so it's a hint, not a guarantee. Returns null
 * for non-name-based locators (testid/CSS), when the targeted name is still
 * present (so the failure wasn't a rename), or when no candidate is confident.
 */
export function suggestLocatorsFromAria(
  failed: FailedLocatorInfo,
  ariaSnapshot: string | null,
): LocatorSuggestion | null {
  if (!ariaSnapshot || !NAME_BASED_METHODS.has(failed.method)) return null;

  const { role, name } = failedNameAndRole(failed);
  if (!name) return null;

  const candidates = parseAriaRoleName(ariaSnapshot);
  if (candidates.length === 0) return null;

  const sameRole = role ? candidates.filter((c) => c.role === role) : [];
  const pool = sameRole.length > 0 ? sameRole : candidates;

  // The targeted name is still on the page → not a rename, nothing to suggest.
  if (pool.some((c) => nameSimilarity(c.name, name) >= 0.8)) return null;

  let best: { role: string; name: string | null } | null = null;
  let bestScore = -1;
  for (const c of pool) {
    const s = nameSimilarity(c.name, name);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (!best || !best.name) return null;
  if (bestScore < 0.2 && pool.length !== 1) return null;

  const suggestions = freshSuggestions({ role: best.role, name: best.name }, failed.method);
  if (suggestions.length === 0) return null;

  return { failing: renderFailing(failed), suggestions };
}

// ── Call-site capture ────────────────────────────────────────────────────────

/**
 * Capture the calling test's source location (`file:line:col`) from the current
 * stack, for stamping onto a locator snapshot. The path is made cwd-relative so
 * it matches the location format Playwright embeds in error messages — which is
 * what the server's exact-match healing lookup (`extractErrorLocation`) parses.
 *
 * Stamping at action *call* time (rather than correlating with `pw:api` step
 * indices at step *end* time) avoids three classes of misalignment: `pw:api`
 * steps with no wrapped locator (e.g. `page.keyboard.press`), cross-worker step
 * interleaving, and concurrent actions reordering by end time.
 *
 * Returns null when no user frame can be identified — the snapshot keeps
 * `location: null` and the server falls back to fingerprint / ARIA lookup.
 */
export function captureCallerLocation(): string | null {
  const stack = new Error().stack ?? '';
  const lines = stack.split('\n');
  // The capture machinery's own frames sit at the top of the stack: this module
  // (locator-healing) then the single fixtures-proxy frame that called it. Skip
  // exactly those, so the first remaining frame is the real test call site. A
  // USER file named `fixtures.*` further down the stack must be kept, so the
  // fixtures-proxy frame is only skipped when it directly follows this module.
  let prevWasCaptureModule = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line.startsWith('at')) continue;
    const m = line.match(/^at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    if (!m) {
      prevWasCaptureModule = false;
      continue;
    }
    let file = m[2]!;
    if (!file || file.startsWith('node:')) {
      prevWasCaptureModule = false;
      continue;
    }
    file = file.replace(/^file:\/\/\/?/, '');
    // Must look like a source file (has an extension).
    if (!/\.[a-z]+$/i.test(file)) {
      prevWasCaptureModule = false;
      continue;
    }
    // This module — always an internal frame; remember it so the immediately
    // following fixtures-proxy frame can be skipped too.
    if (/[\\/]locator-healing\.[a-z]+$/i.test(file)) {
      prevWasCaptureModule = true;
      continue;
    }
    // The fixtures proxy that called us — skip only when it directly follows
    // this module, so a user's own `fixtures.*` deeper down is not dropped.
    if (prevWasCaptureModule && /[\\/]fixtures\.[a-z]+$/i.test(file)) {
      prevWasCaptureModule = false;
      continue;
    }
    if (/[\\/]node_modules[\\/]/.test(file)) {
      prevWasCaptureModule = false;
      continue;
    }
    let rel = file;
    try {
      rel = path.relative(process.cwd(), file);
    } catch {
      /* keep absolute if relative fails */
    }
    rel = rel.split(path.sep).join('/');
    if (rel.startsWith('./')) rel = rel.slice(2);
    return `${rel}:${m[3]!}:${m[4]!}`;
  }
  return null;
}
