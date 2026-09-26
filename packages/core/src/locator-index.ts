/**
 * The locator index as a Piwi instance serves it to its clients: every
 * distinct locator chain a project's tests used, with the tests that used it
 * and how. The browser extension evaluates these chains against a live page
 * to show which elements are tested; the dashboard's Locators page matches
 * pasted locators against them.
 *
 * Also the pure half of that matching: reading locator chains out of pasted
 * text, and looking them up in an index by exact chain, by target call, by a
 * target that would find the same element, or as a container.
 */
import {
  LOCATING_METHODS,
  locatorTarget,
  renderLocatorChain,
  scanLocatorChain,
  tryParseLocatorChain,
  type LocatorArg,
  type LocatorCall,
  type LocatorChain,
} from './locator-chain';

/** Outcome of a test's latest execution, reduced to what a coverage view colors by. */
export type LocatorIndexTestStatus = 'passed' | 'flaky' | 'failed' | 'skipped';

export interface LocatorIndexTest {
  /** The dashboard's test case id. */
  id: number;
  title: string;
  /** Project-relative spec file. */
  file: string;
  /** Describe blocks around the test, outermost first. */
  suite: string[];
  /** Latest execution outcome; null when unknown. */
  status: LocatorIndexTestStatus | null;
}

/** How one test uses one chain. */
export interface LocatorIndexUse {
  /** Position of the test in `LocatorIndex.tests`. */
  test: number;
  /** `click`, `fill`, `expect.toBeVisible`, … in first-seen order. */
  actions: string[];
  /** Project-relative `file:line:col` call sites. */
  callSites: string[];
  /** Playwright projects the use was recorded in (`chromium`, `mobile-safari`, …); empty when unknown. */
  projects: string[];
  /**
   * The branches whose runs recorded it. In a view of one branch, the default
   * branch's name here means the test did not run on that branch, so its use
   * on the default branch stands in.
   */
  branches: string[];
}

export interface LocatorIndexEntry {
  /** Canonical chain, e.g. `getByRole('form', { name: 'Shipping' }).getByLabel('Country')`. */
  locator: string;
  /** When a test last used it, ISO 8601. */
  lastSeenAt: string;
  uses: LocatorIndexUse[];
}

/** A branch whose runs recorded uses of their own. */
export interface LocatorIndexBranch {
  name: string;
  /** When a test of that branch last used a locator, ISO 8601. */
  lastSeenAt: string;
  /** Tests that ran on that branch. */
  tests: number;
}

/** Asks an instance for every branch together instead of one branch. */
export const ALL_BRANCHES = '*';

export interface LocatorIndex {
  projectId: number;
  projectName: string;
  /**
   * The branch described: the default branch's uses, with those of the tests
   * that ran on this branch replaced by what they did there. Null for every
   * branch together.
   */
  branch: string | null;
  /** The project's default branch. */
  defaultBranch: string;
  /** Branches with uses of their own, most recently seen first. */
  branches: LocatorIndexBranch[];
  /** When the index was first built from stored runs; null when it never was. */
  builtAt: string | null;
  generatedAt: string;
  /** The attributes `getByTestId` reads in this project (Playwright's `testIdAttribute`), when a run reported one. */
  testIdAttributes: string[] | null;
  tests: LocatorIndexTest[];
  /** Most widely used chains first. */
  locators: LocatorIndexEntry[];
  /** True when the project has more chains than the response carries. */
  truncated: boolean;
}

/** A locator chain found in pasted text. */
export interface ExtractedLocator {
  /** The text as it appeared. */
  input: string;
  /** Canonical chain; null when the text looked like a locator but could not be read. */
  locator: string | null;
}

const CHAIN_START = /(?:getBy(?:Role|Text|Label|Placeholder|AltText|Title|TestId)|locator|frameLocator)\s*\(/g;
const PAGE_RECEIVER = /\b(?:this\.)?page\s*\.\s*(?=(?:getBy[A-Za-z]+|locator|frameLocator)\s*\()/g;

/**
 * Every locator chain in a block of text: one per line as the extension copies
 * them, or inside test code (`await page.getByRole('button').click()` gives
 * `getByRole('button')`, with the `page.` receivers dropped). Duplicates are
 * dropped; a call that starts like a locator but does not parse is kept with a
 * null `locator`.
 */
export function extractLocatorExpressions(source: string): ExtractedLocator[] {
  // Nested locators in test code carry the page receiver too (`filter({ has: page.getByRole(…) })`).
  const text = source.replace(PAGE_RECEIVER, '');
  const out: ExtractedLocator[] = [];
  const seen = new Set<string>();
  CHAIN_START.lastIndex = 0;
  let consumed = 0;
  let m: RegExpExecArray | null;
  while ((m = CHAIN_START.exec(text)) !== null) {
    const at = m.index;
    if (at < consumed) continue;
    const previous = text[at - 1];
    if (previous !== undefined && /[\w$]/.test(previous)) continue;
    const scanned = scanLocatorChain(text.slice(at));
    if (!scanned) {
      const lineEnd = text.indexOf('\n', at);
      const input = text.slice(at, lineEnd === -1 ? undefined : lineEnd).trim();
      if (!seen.has(`!${input}`)) {
        seen.add(`!${input}`);
        out.push({ input, locator: null });
      }
      consumed = at + m[0].length;
      continue;
    }
    const locator = renderLocatorChain(scanned.chain);
    consumed = at + scanned.end;
    CHAIN_START.lastIndex = consumed;
    if (seen.has(locator)) continue;
    seen.add(locator);
    out.push({ input: text.slice(at, consumed), locator });
  }
  return out;
}

/** How an indexed chain relates to a looked-up locator, closest first. */
export type LocatorMatchKind = 'exact' | 'target' | 'similar' | 'scope';

export const LOCATOR_MATCH_KINDS: readonly LocatorMatchKind[] = ['exact', 'target', 'similar', 'scope'];

export interface LocatorLookupHit {
  /** The indexed chain. */
  locator: string;
  kind: LocatorMatchKind;
  /** Positions in `LocatorIndex.tests` of the tests that use it. */
  tests: number[];
  /** Actions those tests perform through it. */
  actions: string[];
}

export interface LocatorLookup {
  input: string;
  locator: string | null;
  /** Closest first: the exact chain, then chains ending on the same call, then similar targets, then chains inside it. */
  hits: LocatorLookupHit[];
  /** Distinct tests across every hit. */
  tests: number[];
}

interface ParsedEntry {
  entry: LocatorIndexEntry;
  chain: LocatorChain | null;
  target: string | null;
  targetCall: LocatorCall | null;
}

const parsedIndexes = new WeakMap<LocatorIndex, ParsedEntry[]>();

function lastLocatingCall(chain: LocatorChain): LocatorCall | null {
  for (let i = chain.calls.length - 1; i >= 0; i--) {
    if (LOCATING_METHODS.has(chain.calls[i]!.method)) return chain.calls[i]!;
  }
  return null;
}

function parsedEntries(index: LocatorIndex): ParsedEntry[] {
  let parsed = parsedIndexes.get(index);
  if (!parsed) {
    parsed = index.locators.map((entry) => {
      const chain = tryParseLocatorChain(entry.locator);
      const targetCall = chain ? lastLocatingCall(chain) : null;
      return { entry, chain, target: chain ? locatorTarget(chain) : null, targetCall };
    });
    parsedIndexes.set(index, parsed);
  }
  return parsed;
}

function normalizeSpace(text: string): string {
  return text
    .replace(/[​­]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function option(call: LocatorCall, key: string, position: number): LocatorArg | undefined {
  const opts = call.args[position];
  if (opts?.type !== 'object') return undefined;
  return opts.entries.find(([k]) => k === key)?.[1];
}

function isExact(call: LocatorCall, position: number): boolean {
  const exact = option(call, 'exact', position);
  return exact?.type === 'boolean' && exact.value;
}

/** Whether a locator's text argument finds an element whose text is `value`, with Playwright's rules. */
function textFinds(pattern: LocatorArg, value: string, exact: boolean, mode: 'text' | 'role' | 'attribute'): boolean {
  if (pattern.type === 'regex') {
    try {
      return new RegExp(pattern.source, pattern.flags).test(mode === 'attribute' ? value : normalizeSpace(value));
    } catch {
      return false;
    }
  }
  if (pattern.type !== 'string') return false;
  if (mode === 'attribute') {
    return exact ? value === pattern.value : value.toLowerCase().includes(pattern.value.toLowerCase());
  }
  const actual = normalizeSpace(value);
  const wanted = normalizeSpace(pattern.value);
  if (exact) return actual === wanted;
  return mode === 'role'
    ? actual.toUpperCase().includes(wanted.toUpperCase())
    : actual.toLowerCase().includes(wanted.toLowerCase());
}

const ROLE_STATES = ['checked', 'disabled', 'expanded', 'level', 'pressed', 'selected'];

/**
 * Whether an indexed target call would find the element a pasted call
 * describes, reading the pasted call as the element's exact description (the
 * extension generates it from the element): same method, and the indexed
 * text, name or test id matches the pasted one the way Playwright compares
 * them. A role without a name matches every element of that role, so it
 * never counts.
 */
export function targetWouldMatch(indexed: LocatorCall, described: LocatorCall): boolean {
  if (indexed.method !== described.method) return false;
  const pattern = indexed.args[0];
  const value = described.args[0];
  if (!pattern || value?.type !== 'string') return false;
  switch (indexed.method) {
    case 'getByRole': {
      if (pattern.type !== 'string' || pattern.value.toLowerCase() !== value.value.toLowerCase()) return false;
      for (const state of ROLE_STATES) {
        const want = option(indexed, state, 1);
        const has = option(described, state, 1);
        if (want && has && JSON.stringify(want) !== JSON.stringify(has)) return false;
      }
      const name = option(indexed, 'name', 1);
      const describedName = option(described, 'name', 1);
      if (!name || describedName?.type !== 'string') return false;
      return textFinds(name, describedName.value, isExact(indexed, 1), 'role');
    }
    case 'getByText':
    case 'getByLabel':
      return textFinds(pattern, value.value, isExact(indexed, 1), 'text');
    case 'getByPlaceholder':
    case 'getByAltText':
    case 'getByTitle':
      return textFinds(pattern, value.value, isExact(indexed, 1), 'attribute');
    case 'getByTestId':
      return textFinds(pattern, value.value, true, 'attribute');
    default:
      return false;
  }
}

/**
 * Look pasted locators up in an index. A chain matches exactly, by its target
 * (the same last locating call inside other containers), as a similar target
 * (another call that finds the same element, see `targetWouldMatch`), or as a
 * container other chains search inside.
 */
export function lookupLocators(index: LocatorIndex, inputs: ExtractedLocator[]): LocatorLookup[] {
  const entries = parsedEntries(index);
  return inputs.map(({ input, locator }) => {
    const chain = locator ? tryParseLocatorChain(locator) : null;
    if (!locator || !chain) return { input, locator: null, hits: [], tests: [] };
    const target = locatorTarget(chain);
    const targetCall = lastLocatingCall(chain);
    const hits: LocatorLookupHit[] = [];
    for (const parsed of entries) {
      const entryLocator = parsed.entry.locator;
      let kind: LocatorMatchKind | null = null;
      if (entryLocator === locator) kind = 'exact';
      else if (parsed.target !== null && parsed.target === target) kind = 'target';
      else if (parsed.targetCall && targetCall && targetWouldMatch(parsed.targetCall, targetCall)) kind = 'similar';
      else if (entryLocator.startsWith(`${locator}.`) && continuesWithLocatingCall(parsed.chain, chain.calls.length)) {
        kind = 'scope';
      }
      if (!kind) continue;
      const tests: number[] = [];
      const actions: string[] = [];
      for (const use of parsed.entry.uses) {
        if (!tests.includes(use.test)) tests.push(use.test);
        for (const action of use.actions) if (!actions.includes(action)) actions.push(action);
      }
      hits.push({ locator: entryLocator, kind, tests, actions });
    }
    hits.sort(
      (a, b) =>
        LOCATOR_MATCH_KINDS.indexOf(a.kind) - LOCATOR_MATCH_KINDS.indexOf(b.kind) || b.tests.length - a.tests.length,
    );
    const tests = [...new Set(hits.flatMap((hit) => hit.tests))];
    return { input, locator, hits, tests };
  });
}

function continuesWithLocatingCall(chain: LocatorChain | null, prefixLength: number): boolean {
  if (!chain || chain.calls.length <= prefixLength) return false;
  return chain.calls.slice(prefixLength).some((call) => LOCATING_METHODS.has(call.method));
}
