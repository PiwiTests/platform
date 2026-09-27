import type { LocatorChain } from '@piwitests/core/locator-chain';
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

export type ViewMark = 'unreachable' | 'ambiguous';

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

function roleChain(role: string, name: string): LocatorChain {
  return {
    calls: [
      {
        method: 'getByRole',
        args: [
          { type: 'string', value: role },
          { type: 'object', entries: [['name', { type: 'string', value: name }]] },
        ],
      },
    ],
  };
}

export interface ViewScanOptions {
  engine?: LocatorEngine;
  /** The attribute `getByTestId` reads. */
  testIdAttribute?: string;
}

/** Every element of the top document a test could reach, or should and cannot, in page order. */
export function scanPlaywrightView(doc: Document = document, options: ViewScanOptions = {}): ViewLabel[] {
  const engine =
    options.engine ?? createPageEngine(doc, options.testIdAttribute ? [options.testIdAttribute] : undefined);
  const testIdAttribute = options.testIdAttribute ?? 'data-testid';
  const model = engine.model;
  const labels: ViewLabel[] = [];
  const elements = engine.elements(doc).slice(0, MAX_ELEMENTS);
  for (const element of elements) {
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
      try {
        count = engine.queryAll(roleChain(known, name)).length;
      } catch {
        count = 1;
      }
      if (count > 1) mark = 'ambiguous';
    }
    labels.push({ element, tag: tagNameOf(element).toLowerCase(), role: known, name, testId, mark, count });
  }
  return labels;
}
