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

export interface InteractiveElement {
  element: Element;
  /** A chain reaches it, a child of it, or its label. */
  reached: boolean;
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
  /** Every visible interactive element, in page order. */
  interactive: InteractiveElement[];
  /** The short description the lists show for an element. */
  describe(element: Element): string;
}

/** A scan narrowed to one element and what is inside it. */
export interface ScopedScan extends CoverageScan {
  scope: Element;
  /** Tested elements containing the scope, nearest first: the card a test checks around a button. */
  containers: CoveredElement[];
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
  const interactive: InteractiveElement[] = [];
  for (const d of docs) {
    for (const element of engine.elements(d)) {
      if (isInteractive(element, model) && model.isVisible(element)) {
        interactive.push({ element, reached: reached.has(element) });
      }
    }
  }
  const describe = (element: Element) => describeElement(element, model);

  return {
    covered,
    tests: testsOf(covered),
    ...surfaceOf(interactive, describe),
    unmatched,
    errors,
    evaluated: chains.length,
    durationMs: Math.round(performance.now() - started),
    interactive,
    describe,
  };
}

/** The tests reaching some covered elements, those reaching the most first. */
function testsOf(covered: CoveredElement[]): PageTest[] {
  const perTest = new Map<number, Element[]>();
  for (const c of covered) {
    for (const test of c.tests) {
      let list = perTest.get(test);
      if (!list) perTest.set(test, (list = []));
      list.push(c.element);
    }
  }
  return [...perTest.entries()]
    .map(([test, elements]) => ({ test, elements }))
    .sort((a, b) => b.elements.length - a.elements.length || a.test - b.test);
}

function surfaceOf(
  interactive: InteractiveElement[],
  describe: (element: Element) => string,
): Pick<CoverageScan, 'uncovered' | 'coveredInteractive' | 'uncoveredCount'> {
  const uncovered: UncoveredElement[] = [];
  let coveredInteractive = 0;
  let uncoveredCount = 0;
  for (const { element, reached } of interactive) {
    if (reached) {
      coveredInteractive++;
      continue;
    }
    uncoveredCount++;
    if (uncovered.length < MAX_UNCOVERED) uncovered.push({ element, description: describe(element) });
  }
  return { uncovered, coveredInteractive, uncoveredCount };
}

/**
 * An element's containers, nearest first: its parents across shadow roots,
 * then the frame element of its document and that frame's own containers.
 */
export function containersOf(element: Element): Element[] {
  const out: Element[] = [];
  let current: Element | null = element;
  while (current) {
    let parent: Element | null = parentElementOrShadowHost(current) ?? null;
    if (!parent) {
      try {
        parent = current.ownerDocument.defaultView?.frameElement ?? null;
      } catch {
        parent = null;
      }
    }
    if (parent) out.push(parent);
    current = parent;
  }
  return out;
}

function labelsOf(element: Element): Element[] {
  return Array.from((element as HTMLInputElement).labels ?? []);
}

/** Whether `element` is `scope`, inside it, or inside one of its labels (Playwright acts on a field through its label). */
function withinScope(scope: Element, labels: Element[]): (element: Element) => boolean {
  return (element) =>
    element === scope ||
    labels.some((label) => label === element || label.contains(element)) ||
    containersOf(element).includes(scope);
}

/**
 * Narrow a scan to one element: the tested and untested elements inside it
 * (the element itself included), the tests reaching them, and the tested
 * elements around it.
 */
export function scopeScan(scan: CoverageScan, scope: Element): ScopedScan {
  const within = withinScope(scope, labelsOf(scope));
  const covered = scan.covered.filter((c) => within(c.element));
  const around = containersOf(scope);
  const depth = new Map(around.map((element, i) => [element, i]));
  const containers = scan.covered
    .filter((c) => depth.has(c.element))
    .sort((a, b) => depth.get(a.element)! - depth.get(b.element)!);
  const interactive = scan.interactive.filter((i) => within(i.element));
  return {
    ...scan,
    covered,
    tests: testsOf(covered),
    ...surfaceOf(interactive, scan.describe),
    interactive,
    scope,
    containers,
  };
}

/**
 * The container a wider look at `element` would take: the nearest one whose
 * box is larger (a wrapper of the same size would show the same thing). Null
 * when that is the whole page.
 */
export function widerScope(element: Element): Element | null {
  const box = element.getBoundingClientRect();
  for (const container of containersOf(element)) {
    const tag = tagNameOf(container);
    if (tag === 'BODY' || tag === 'HTML') return null;
    const r = container.getBoundingClientRect();
    if (r.width > box.width + 1 || r.height > box.height + 1) return container;
  }
  return null;
}

export interface ReachGroup {
  /** Tests reaching this way and not in a closer group, those using the most chains first. */
  tests: number[];
  /** Positions in `LocatorIndex.locators` of the chains reaching this way. */
  entries: number[];
  elements: Element[];
}

/** How the tests of a scan reach one element, closest first. */
export interface ElementReach {
  /** Chains resolving to the element itself, or to one of its labels. */
  self: ReachGroup;
  /** Chains resolving to something inside it: the text of a button, the fields of a form. */
  inside: ReachGroup;
  /** Chains resolving to an element containing it: a test checking the card around a button. */
  containers: ReachGroup;
}

export function elementReach(scan: CoverageScan, index: LocatorIndex, target: Element): ElementReach {
  const labels = labelsOf(target);
  const around = new Set(containersOf(target));
  const found: Record<keyof ElementReach, CoveredElement[]> = { self: [], inside: [], containers: [] };
  for (const covered of scan.covered) {
    const element = covered.element;
    if (element === target || labels.some((label) => label === element || label.contains(element))) {
      found.self.push(covered);
    } else if (around.has(element)) {
      found.containers.push(covered);
    } else if (containersOf(element).includes(target)) {
      found.inside.push(covered);
    }
  }
  const seen = new Set<number>();
  const group = (list: CoveredElement[]): ReachGroup => {
    const entries = [...new Set(list.flatMap((c) => c.matches.map((m) => m.entry)))];
    const weight = new Map<number, number>();
    for (const entry of entries) {
      for (const use of index.locators[entry]!.uses) {
        if (!seen.has(use.test)) weight.set(use.test, (weight.get(use.test) ?? 0) + 1);
      }
    }
    const tests = [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([test]) => test);
    tests.forEach((test) => seen.add(test));
    return { tests, entries, elements: list.map((c) => c.element) };
  };
  const self = group(found.self);
  const inside = group(found.inside);
  const containers = group(found.containers);
  return { self, inside, containers };
}
