/**
 * Which elements of the current page a project's tests reach: every chain of
 * the project's locator index is resolved against the live DOM with the
 * Playwright-faithful engine (`locator-engine.ts`), and the matches are folded
 * per element — which chains reach it, which tests use those chains, whether
 * they operate it or only assert on it. The interactive elements no chain
 * reaches are the page's untested surface.
 *
 * The index records which chain each test used, not the page it ran on: a
 * chain that resolves here counts even when its test used it on another page.
 * A chain resolving to a single element is the strong signal; one resolving to
 * several is reported as ambiguous.
 *
 * DOM-only logic, no `chrome.*`: the entry point (`coverage-overlay.ts`) wires
 * it to storage and draws the result.
 */
import { tryParseLocatorChain, type LocatorChain } from '@piwitests/core/locator-chain';
import type { LocatorIndex } from '@piwitests/core/locator-index';
import { isInteractionAction } from '@piwitests/core/step-locators';
import { normalizeWhiteSpace, parentElementOrShadowHost, tagNameOf, type DomModel } from './engine-aria.js';
import { createLocatorEngine, type LocatorEngine } from './locator-engine.js';

/** Operated by at least one test (clicked, filled, …), or only asserted on. */
export type CoverageKind = 'operated' | 'checked';

export interface CoverageMatch {
  /** Position of the chain in `LocatorIndex.locators`. */
  entry: number;
  /** How many elements the chain resolves to on this page. */
  count: number;
}

export interface CoveredElement {
  element: Element;
  matches: CoverageMatch[];
  /** Positions in `LocatorIndex.tests` of the tests whose chains reach the element. */
  tests: number[];
  kind: CoverageKind;
  /** Every chain reaching the element also resolves to other elements here. */
  ambiguous: boolean;
  visible: boolean;
  description: string;
}

export interface UncoveredElement {
  element: Element;
  description: string;
}

export interface PageTest {
  /** Position in `LocatorIndex.tests`. */
  test: number;
  /** The covered elements the test reaches on this page. */
  elements: Element[];
}

export interface CoverageScan {
  /** Elements at least one chain resolves to, in page order. */
  covered: CoveredElement[];
  /** Visible interactive elements no chain reaches, directly, through a child or through their label. */
  uncovered: UncoveredElement[];
  /** Tests reaching this page, those reaching the most elements first. */
  tests: PageTest[];
  /** Visible interactive elements that count as covered. */
  coveredInteractive: number;
  /** Visible interactive elements no chain reaches; `uncovered` lists at most the first 500. */
  uncoveredCount: number;
  /** Chains resolving to nothing on this page. */
  unmatched: number;
  /** Chains the engine could not evaluate here, with why. */
  errors: Array<{ entry: number; message: string }>;
  evaluated: number;
  durationMs: number;
}

export interface ScanOptions {
  /** Playwright's `testIdAttribute` for the project. */
  testIdAttributes?: string[];
  /** Elements to leave out entirely, such as the extension's own overlay. */
  ignore?: (element: Element) => boolean;
  /** Checked between slices of work; returning false abandons the scan. */
  keepGoing?: () => boolean;
  /** Milliseconds of work between yields back to the page. */
  sliceMs?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Roles people operate — what a test clicks, types into or toggles. */
const INTERACTIVE_ROLES = new Set([
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

/** Cap on the untested elements listed, so a pathological page stays responsive. */
const MAX_UNCOVERED = 500;

const parsedChains = new WeakMap<LocatorIndex, Array<LocatorChain | null>>();

function chainsOf(index: LocatorIndex): Array<LocatorChain | null> {
  let chains = parsedChains.get(index);
  if (!chains) {
    chains = index.locators.map((entry) => tryParseLocatorChain(entry.locator));
    parsedChains.set(index, chains);
  }
  return chains;
}

function shorten(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A short, human description: `button "Pay now"`, `textbox "Email"`, `div.card "Blue mug…"`. */
export function describeElement(element: Element, model: DomModel): string {
  const role = model.role(element);
  const name = normalizeWhiteSpace(model.accessibleName(element, false));
  if (role && name) return `${role} "${shorten(name)}"`;
  const tag = tagNameOf(element).toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const cls = !id && element.classList.length ? `.${element.classList[0]}` : '';
  const text = normalizeWhiteSpace(element.textContent || '');
  const placeholder = element.getAttribute('placeholder');
  const hint = text ? ` "${shorten(text, 40)}"` : placeholder ? ` [placeholder="${shorten(placeholder, 40)}"]` : '';
  return `${role ?? tag}${id}${cls}${hint}`;
}

function isInteractive(element: Element, model: DomModel): boolean {
  const editable = element.getAttribute('contenteditable');
  if (editable !== null && editable !== 'false') {
    const parent = parentElementOrShadowHost(element);
    const parentEditable = parent?.getAttribute('contenteditable');
    return parentEditable === null || parentEditable === undefined || parentEditable === 'false';
  }
  const role = model.role(element);
  if (!role || !INTERACTIVE_ROLES.has(role)) return false;
  // A native <option> is operated through its <select>, never on its own.
  if (tagNameOf(element) === 'OPTION' && element.closest('select,datalist')) return false;
  return true;
}

/** The documents of the same-origin frames inside `doc`, nested ones included. */
function frameDocuments(engine: LocatorEngine, doc: Document): Document[] {
  const out: Document[] = [];
  for (const element of engine.elements(doc)) {
    const tag = tagNameOf(element);
    if (tag !== 'IFRAME' && tag !== 'FRAME') continue;
    let frameDoc: Document | null = null;
    try {
      frameDoc = (element as HTMLIFrameElement).contentDocument;
    } catch {
      frameDoc = null;
    }
    if (frameDoc?.documentElement) out.push(frameDoc, ...frameDocuments(engine, frameDoc));
  }
  return out;
}

function yieldToPage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Resolve every chain of the index against `doc` and fold the result per
 * element. Works in slices so the page stays responsive; answers null when
 * `keepGoing` stopped it.
 */
export async function scanCoverage(
  index: LocatorIndex,
  doc: Document,
  options: ScanOptions = {},
): Promise<CoverageScan | null> {
  const started = performance.now();
  const sliceMs = options.sliceMs ?? 12;
  const engine = createLocatorEngine(doc, { testIdAttributes: options.testIdAttributes, ignore: options.ignore });
  const model = engine.model;
  const chains = chainsOf(index);
  const byElement = new Map<Element, CoverageMatch[]>();
  const errors: CoverageScan['errors'] = [];
  let unmatched = 0;
  let sliceStart = performance.now();

  for (let i = 0; i < chains.length; i++) {
    if (performance.now() - sliceStart > sliceMs) {
      options.onProgress?.(i, chains.length);
      await yieldToPage();
      if (options.keepGoing && !options.keepGoing()) return null;
      sliceStart = performance.now();
    }
    const chain = chains[i];
    if (!chain) {
      errors.push({ entry: i, message: 'the locator could not be read' });
      continue;
    }
    let found: Element[];
    try {
      found = engine.queryAll(chain);
    } catch (error) {
      errors.push({ entry: i, message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (found.length === 0) {
      unmatched++;
      continue;
    }
    for (const element of found) {
      let matches = byElement.get(element);
      if (!matches) byElement.set(element, (matches = []));
      matches.push({ entry: i, count: found.length });
    }
  }
  options.onProgress?.(chains.length, chains.length);

  // Page order: the page's own elements, then each same-origin frame's.
  const docs = [doc, ...frameDocuments(engine, doc)];
  const order = new Map<Element, number>();
  for (const d of docs) for (const element of engine.elements(d)) order.set(element, order.size);

  const covered: CoveredElement[] = [];
  for (const [element, matches] of byElement) {
    const tests = new Set<number>();
    let operated = false;
    for (const match of matches) {
      for (const use of index.locators[match.entry]!.uses) {
        tests.add(use.test);
        if (use.actions.some(isInteractionAction)) operated = true;
      }
    }
    covered.push({
      element,
      matches,
      tests: [...tests],
      kind: operated ? 'operated' : 'checked',
      ambiguous: matches.every((m) => m.count > 1),
      visible: model.isVisible(element),
      description: describeElement(element, model),
    });
  }
  const position = (element: Element) => order.get(element) ?? Number.MAX_SAFE_INTEGER;
  covered.sort((a, b) => position(a.element) - position(b.element));

  const perTest = new Map<number, Element[]>();
  for (const c of covered) {
    for (const test of c.tests) {
      let list = perTest.get(test);
      if (!list) perTest.set(test, (list = []));
      list.push(c.element);
    }
  }
  const tests = [...perTest.entries()]
    .map(([test, elements]) => ({ test, elements }))
    .sort((a, b) => b.elements.length - a.elements.length || a.test - b.test);

  // An interactive element counts as covered when a chain reaches it, a child
  // of it (the text inside a button), or its label (Playwright acts through labels).
  const reached = new Set<Element>();
  for (const element of byElement.keys()) {
    reached.add(element);
    for (let parent = parentElementOrShadowHost(element); parent; parent = parentElementOrShadowHost(parent)) {
      reached.add(parent);
    }
    const label = element.closest('label') as HTMLLabelElement | null;
    if (label?.control) reached.add(label.control);
  }
  const uncovered: UncoveredElement[] = [];
  let coveredInteractive = 0;
  let uncoveredCount = 0;
  for (const d of docs) {
    for (const element of engine.elements(d)) {
      if (!isInteractive(element, model) || !model.isVisible(element)) continue;
      if (reached.has(element)) {
        coveredInteractive++;
        continue;
      }
      uncoveredCount++;
      if (uncovered.length < MAX_UNCOVERED) uncovered.push({ element, description: describeElement(element, model) });
    }
  }

  return {
    covered,
    uncovered,
    tests,
    coveredInteractive,
    uncoveredCount,
    unmatched,
    errors,
    evaluated: chains.length,
    durationMs: Math.round(performance.now() - started),
  };
}

/**
 * The tests reaching one element, from a finished scan: through chains that
 * resolve to the element itself, to something inside it (the text of a
 * button), or to one of its labels. Tests are ordered by how many of those
 * chains they use.
 */
export function testsReaching(
  scan: CoverageScan,
  index: LocatorIndex,
  target: Element,
): { tests: number[]; entries: number[] } {
  const labels = new Set<Element>(Array.from((target as HTMLInputElement).labels ?? []));
  const entries = new Set<number>();
  for (const covered of scan.covered) {
    const element = covered.element;
    let reaches = element === target || labels.has(element) || [...labels].some((label) => label.contains(element));
    for (
      let parent = parentElementOrShadowHost(element);
      !reaches && parent;
      parent = parentElementOrShadowHost(parent)
    ) {
      if (parent === target) reaches = true;
    }
    if (reaches) for (const match of covered.matches) entries.add(match.entry);
  }
  const weight = new Map<number, number>();
  for (const entry of entries) {
    for (const use of index.locators[entry]!.uses) weight.set(use.test, (weight.get(use.test) ?? 0) + 1);
  }
  const tests = [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([test]) => test);
  return { tests, entries: [...entries] };
}
