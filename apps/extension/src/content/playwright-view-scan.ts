import { normalizeWhiteSpace, parentElementOrShadowHost, tagNameOf } from './engine-aria.js';
import type { LocatorEngine } from './locator-engine.js';
import { createPageEngine, isPiwiElement } from './verified-locators.js';

/**
 * The page as a Playwright test sees it: each element a test could reach,
 * labelled with the role and accessible name `getByRole` sees and its test
 * id, and two marks:
 *
 * - `unreachable`: an element that looks operable (a `tabindex`, an `onclick`,
 *   a pointer cursor of its own) with no role Playwright recognizes, or an
 *   operable role with no name, and no test id either, so no stable locator
 *   reaches it;
 * - `ambiguous`: `getByRole(role, { name })` finds it among others, so a test
 *   needs `exact`, a scope or `.nth()`.
 */

type ViewMark = 'unreachable' | 'ambiguous';

export interface ViewLabel {
  element: Element;
  tag: string;
  role: string | null;
  name: string;
  testId: string | null;
  mark: ViewMark | null;
  /** For an ambiguous element: how many elements its `getByRole` finds. */
  count: number;
}

/** Roles people operate: without a name, only a test id or the element's position reaches them. */
const OPERABLE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'combobox',
  'listbox',
  'textbox',
  'searchbox',
  'slider',
  'spinbutton',
  'treeitem',
]);

/** Roles worth a label besides the operable ones: what tests assert on and scope to. */
const LABELLED_ROLES = new Set([
  ...OPERABLE_ROLES,
  'heading',
  'img',
  'dialog',
  'alertdialog',
  'alert',
  'status',
  'navigation',
  'main',
  'banner',
  'contentinfo',
  'complementary',
  'region',
  'form',
  'search',
  'table',
  'grid',
  'tablist',
  'tabpanel',
  'menu',
  'menubar',
  'toolbar',
  'tree',
  'progressbar',
]);

/** Roles that make an element no target of its own. */
const NO_ROLE = new Set(['generic', 'presentation', 'none']);

/** How many elements a scan looks at, so a pathological page stays responsive. */
const MAX_ELEMENTS = 20_000;

function hasOwnPointer(element: Element, engine: LocatorEngine): boolean {
  const style = engine.model.style(element);
  if (style?.cursor !== 'pointer') return false;
  const parent = parentElementOrShadowHost(element);
  return !parent || engine.model.style(parent)?.cursor !== 'pointer';
}

/** It takes clicks or focus by itself: a `tabindex`, an `onclick`, or a pointer cursor its parent does not have. */
function looksOperable(element: Element, engine: LocatorEngine): boolean {
  const tabIndex = element.getAttribute('tabindex');
  if (tabIndex !== null && Number(tabIndex) >= 0) return true;
  if (element.hasAttribute('onclick') || typeof (element as HTMLElement).onclick === 'function') return true;
  return hasOwnPointer(element, engine);
}

/** Inside a control that already has a role people operate (the icon in a button, the text in a link). */
function insideOperable(element: Element, engine: LocatorEngine): boolean {
  for (let parent = parentElementOrShadowHost(element); parent; parent = parentElementOrShadowHost(parent)) {
    const role = engine.model.role(parent);
    if (role && OPERABLE_ROLES.has(role)) return true;
  }
  return false;
}

/** The names of the elements carrying one role, joined so that one `indexOf` pass finds those containing a name. */
interface RoleNames {
  joined: string;
  /** Where each name starts in `joined`. */
  starts: number[];
  /** How many elements carry each name. */
  counts: number[];
}

/**
 * How many elements `getByRole(role, { name })` finds on the engine's page,
 * without evaluating one query per element: the elements Playwright's role
 * engine sees (open shadow roots included, none hidden from the accessibility
 * tree) are grouped by role once, and each role's names are read only when
 * that role is asked about. The name matches as `getByRole` matches it by
 * default, a case-insensitive substring: "Product 1" also finds "Product 10".
 */
function roleNameCounter(engine: LocatorEngine, doc: Document): (role: string, name: string) => number {
  const model = engine.model;
  let byRole: Map<string, Element[]> | null = null;
  const names = new Map<string, RoleNames>();
  const counted = new Map<string, number>();

  const namesOf = (role: string): RoleNames => {
    let found = names.get(role);
    if (found) return found;
    if (!byRole) {
      byRole = new Map();
      for (const element of engine.elements(doc)) {
        const elementRole = model.role(element);
        if (!elementRole) continue;
        let list = byRole.get(elementRole);
        if (!list) byRole.set(elementRole, (list = []));
        list.push(element);
      }
    }
    const perName = new Map<string, number>();
    for (const element of byRole.get(role) ?? []) {
      if (model.isHiddenForAria(element)) continue;
      const name = model.normalizedAccessibleName(element, false).toUpperCase();
      perName.set(name, (perName.get(name) ?? 0) + 1);
    }
    // Whitespace is normalized, so no name holds the separator.
    found = { joined: '', starts: [], counts: [] };
    for (const [name, count] of perName) {
      found.starts.push(found.joined.length);
      found.counts.push(count);
      found.joined += `${name}\n`;
    }
    names.set(role, found);
    return found;
  };

  return (role, name) => {
    const needle = normalizeWhiteSpace(name).toUpperCase();
    const key = `${role}\n${needle}`;
    const known = counted.get(key);
    if (known !== undefined) return known;
    const { joined, starts, counts } = namesOf(role);
    let count = 0;
    for (let from = 0; ;) {
      const at = joined.indexOf(needle, from);
      if (at < 0) break;
      // The name holding the match: the last one starting at or before it.
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (starts[mid]! <= at) low = mid;
        else high = mid - 1;
      }
      count += counts[low]!;
      from = starts[low + 1] ?? joined.length;
    }
    counted.set(key, count);
    return count;
  };
}

export interface ViewScanOptions {
  engine?: LocatorEngine;
  /** The attribute `getByTestId` reads. */
  testIdAttribute?: string;
  /** Checked between slices of work; returning false abandons the scan. */
  keepGoing?: () => boolean;
  /** Milliseconds of work between yields back to the page. */
  sliceMs?: number;
}

/**
 * Every element of the top document a test could reach, or should and cannot,
 * in page order. Works in slices so the page stays responsive; answers null
 * when `keepGoing` stopped it.
 */
export async function scanPlaywrightView(
  doc: Document = document,
  options: ViewScanOptions = {},
): Promise<ViewLabel[] | null> {
  const engine =
    options.engine ?? createPageEngine(doc, options.testIdAttribute ? [options.testIdAttribute] : undefined);
  const testIdAttribute = options.testIdAttribute ?? 'data-testid';
  const sliceMs = options.sliceMs ?? 12;
  const model = engine.model;
  const countRoleName = roleNameCounter(engine, doc);
  const labels: ViewLabel[] = [];
  const elements = engine.elements(doc).slice(0, MAX_ELEMENTS);
  let sliceStart = performance.now();
  for (const element of elements) {
    if (performance.now() - sliceStart > sliceMs) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (options.keepGoing && !options.keepGoing()) return null;
      sliceStart = performance.now();
    }
    if (isPiwiElement(element) || !model.isVisible(element)) continue;
    const testId = element.getAttribute(testIdAttribute);
    const hidden = model.isHiddenForAria(element);
    const role = hidden ? null : model.role(element);
    const known = role && !NO_ROLE.has(role) ? role : null;
    const name = known ? normalizeWhiteSpace(model.accessibleName(element, false)) : '';
    let mark: ViewMark | null = null;
    if (!testId) {
      if (known && OPERABLE_ROLES.has(known) && !name) mark = 'unreachable';
      else if (!known && !hidden && looksOperable(element, engine) && !insideOperable(element, engine))
        mark = 'unreachable';
    }
    if (!mark && !testId && !(known && LABELLED_ROLES.has(known))) continue;
    let count = 1;
    if (!mark && known && name) {
      count = countRoleName(known, name);
      if (count > 1) mark = 'ambiguous';
    }
    labels.push({ element, tag: tagNameOf(element).toLowerCase(), role: known, name, testId, mark, count });
  }
  return labels;
}
