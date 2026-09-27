/**
 * What the editor service knows about one file, computed from the project's
 * indexes and the file's text: the locators a test file calls on each line
 * and how stable they are, and, for an application file, the locators its
 * unsaved changes break. Pure: the language server turns these into
 * diagnostics, quick fixes, hovers and summary lines.
 */
import { extractDiffAnchors, type DiffAnchor, type DiffFile } from '@piwitests/core/diff-anchors';
import {
  predictLocatorBreaks,
  sameFilePath,
  callSiteFile,
  callSiteLine,
  type LocatorBreak,
} from '@piwitests/core/locator-break';
import { buildLiteralEdit, buildLocatorEdit } from '@piwitests/core/locator-edit';
import { recommendLocatorFix } from '@piwitests/core/locator-fix';
import type { LocatorIndex, LocatorIndexEntry, LocatorIndexTest, LocatorIndexUse } from '@piwitests/core/locator-index';
import { assessLocatorChain, stabilityLabels, type LocatorStability } from '@piwitests/core/locator-stability';
import {
  parseLeafLocatorCall,
  renderLocatorChain,
  scanLocatorChain,
  tryParseLocatorChain,
} from '@piwitests/core/locator-chain';
import type { RankedLocator } from '@piwitests/core/locator-healing-types';
import type { CallSiteAlternatives, CodeIndex } from './piwi-client.js';

/** A locator the index knows at one line of a file. */
export interface LineLocator {
  /** 1-based line. */
  line: number;
  entry: LocatorIndexEntry;
  /** The uses whose call site is this line. */
  uses: LocatorIndexUse[];
  tests: LocatorIndexTest[];
  actions: string[];
  stability: LocatorStability | null;
}

/** The locators the index knows at each line of a file, by its path relative to the Playwright config. */
export function locatorsInFile(index: LocatorIndex, relativePath: string): LineLocator[] {
  const byKey = new Map<string, LineLocator>();
  for (const entry of index.locators) {
    for (const use of entry.uses) {
      for (const site of use.callSites) {
        if (!sameFilePath(callSiteFile(site), relativePath)) continue;
        const line = callSiteLine(site);
        if (line === null) continue;
        const key = `${line}\u0000${entry.locator}`;
        let found = byKey.get(key);
        if (!found) {
          const chain = tryParseLocatorChain(entry.locator);
          found = {
            line,
            entry,
            uses: [],
            tests: [],
            actions: [],
            stability: chain ? assessLocatorChain(chain) : null,
          };
          byKey.set(key, found);
        }
        if (!found.uses.includes(use)) {
          found.uses.push(use);
          const test = index.tests[use.test];
          if (test && !found.tests.includes(test)) found.tests.push(test);
          for (const a of use.actions) if (!found.actions.includes(a)) found.actions.push(a);
        }
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.line - b.line || b.tests.length - a.tests.length);
}

/** The columns of the locator call on a source line: the leaf method's name through its closing parenthesis, else the trimmed line. */
export function locatorRange(lineText: string, locator: string): { start: number; end: number } {
  const leaf = parseLeafLocatorCall(locator);
  if (leaf) {
    const re = new RegExp(`(?<![\\w$])${leaf.method}\\s*\\(`);
    const m = re.exec(lineText);
    if (m) {
      let depth = 0;
      let quote: string | null = null;
      for (let i = m.index + m[0].length - 1; i < lineText.length; i++) {
        const ch = lineText[i]!;
        if (quote) {
          if (ch === '\\') i++;
          else if (ch === quote) quote = null;
          continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') quote = ch;
        else if (ch === '(') depth++;
        else if (ch === ')' && --depth === 0) return { start: m.index, end: i + 1 };
      }
      return { start: m.index, end: lineText.length };
    }
  }
  const start = lineText.length - lineText.trimStart().length;
  return { start, end: lineText.trimEnd().length };
}

/** A stability finding on a locator line, for a diagnostic. */
export interface StabilityFinding {
  line: number;
  locator: string;
  level: 'brittle' | 'watch';
  message: string;
}

/** Brittle (a warning) and watch (a hint) locators of a test file. */
export function stabilityFindings(locators: LineLocator[]): StabilityFinding[] {
  const out: StabilityFinding[] = [];
  for (const l of locators) {
    const level = l.stability?.level;
    if (level !== 'brittle' && level !== 'watch') continue;
    const tests = `${l.tests.length} ${l.tests.length === 1 ? 'test' : 'tests'}`;
    out.push({
      line: l.line,
      locator: l.entry.locator,
      level,
      message: `${level === 'brittle' ? 'Brittle' : 'Worth a look'}: ${stabilityLabels(l.stability!)} · ${tests}`,
    });
  }
  return out;
}

/**
 * The replacement for a brittle locator at a call site: among the
 * alternatives stored the last time it passed, those the stability rules call
 * stable, picked the way locator healing picks. Null when none qualifies.
 */
export function stableReplacement(
  locator: string,
  line: number,
  relativePath: string,
  stored: CallSiteAlternatives[],
): RankedLocator | null {
  const site = stored.find(
    (s) => callSiteLine(s.location) === line && sameFilePath(callSiteFile(s.location), relativePath),
  );
  if (!site) return null;
  const stable = site.alternatives.filter((a) => {
    const chain = tryParseLocatorChain(a.locator);
    return chain && assessLocatorChain(chain).level === 'stable' && a.locator !== locator;
  });
  if (!stable.length) return null;
  const method = parseLeafLocatorCall(locator)?.method;
  return recommendLocatorFix(method, stable)?.recommended ?? null;
}

/**
 * The line with the locator replaced by `replacement`: the whole chain when
 * the line holds it (`page.locator('.row').nth(2).click()` keeps `page.` and
 * `.click()`), else its last locating call. Null when the line holds neither.
 */
export function replaceLocatorOnLine(lineText: string, locator: string, replacement: string): string | null {
  const chain = tryParseLocatorChain(locator);
  const first = chain?.calls[0]?.method;
  if (chain && first) {
    const re = new RegExp(`(?<![\\w$])${first}\\s*\\(`, 'g');
    for (const m of lineText.matchAll(re)) {
      const scanned = scanLocatorChain(lineText.slice(m.index));
      if (scanned && renderLocatorChain(scanned.chain) === renderLocatorChain(chain)) {
        const next = lineText.slice(0, m.index) + replacement + lineText.slice(m.index + scanned.end);
        return next === lineText ? null : next;
      }
    }
  }
  const method = parseLeafLocatorCall(locator)?.method;
  return buildLocatorEdit(lineText, method, replacement)?.new ?? null;
}

/** Which files each test reaches, from the code index; undefined when it holds no client reach. */
export function reachFrom(codeIndex: CodeIndex | null): ((testId: number, file: string) => boolean) | undefined {
  if (!codeIndex?.reach.some((r) => r.origin === 'client')) return undefined;
  const filesOf = new Map<number, string[]>();
  for (const r of codeIndex.reach) {
    for (const t of r.tests) {
      const id = codeIndex.tests[t]?.id;
      if (id !== undefined) filesOf.set(id, [...(filesOf.get(id) ?? []), codeIndex.files[r.file]!]);
    }
  }
  return (testId, file) => (filesOf.get(testId) ?? []).some((reached) => sameFilePath(reached, file));
}

/** The tests of the code index that reach a file (repository-relative). */
export function testsReaching(codeIndex: CodeIndex | null, repoRelativePath: string): LocatorIndexTest[] {
  if (!codeIndex) return [];
  const out = new Map<number, LocatorIndexTest>();
  for (const r of codeIndex.reach) {
    if (!sameFilePath(codeIndex.files[r.file]!, repoRelativePath)) continue;
    for (const t of r.tests) {
      const test = codeIndex.tests[t];
      if (test) out.set(test.id, test);
    }
  }
  return [...out.values()];
}

/** The breaks an application file's unsaved changes cause, from its diff against the committed version. */
export function breaksOfChange(
  diff: DiffFile,
  index: LocatorIndex,
  options: {
    translations?: (key: string, side: 'old' | 'new') => string | undefined;
    readFile?: (path: string, side: 'old' | 'new') => string | undefined;
    reach?: (testId: number, file: string) => boolean;
  } = {},
): LocatorBreak[] {
  const anchors = extractDiffAnchors([diff], {
    testIdAttributes: index.testIdAttributes ?? undefined,
    isTestFile: (file) => /(?:^|\/)[^/]+\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file),
    translations: options.translations,
    readFile: options.readFile,
  });
  return predictLocatorBreaks(anchors, index, { reach: options.reach });
}

/** The breaks grouped by the anchor that causes them. */
export function breaksByAnchor(breaks: LocatorBreak[]): Array<{ anchor: DiffAnchor; breaks: LocatorBreak[] }> {
  const groups = new Map<DiffAnchor, LocatorBreak[]>();
  for (const b of breaks) groups.set(b.anchor, [...(groups.get(b.anchor) ?? []), b]);
  return [...groups].map(([anchor, list]) => ({ anchor, breaks: list }));
}

/** One line edit at a call site. */
export interface CallSiteEdit {
  /** The call site's file, relative to the Playwright config. */
  file: string;
  /** 1-based line. */
  line: number;
  oldText: string;
  newText: string;
}

/**
 * The call-site edits that apply a set of breaks' rewrites: each call site
 * whose line holds the old string gets it replaced, keeping its quotes. `lineOf`
 * reads a line of a file (the open buffer or the disk); a call site it cannot
 * read, or whose line does not hold the string, is left out.
 */
export function rewriteEdits(
  breaks: LocatorBreak[],
  lineOf: (file: string, line: number) => string | null,
): CallSiteEdit[] {
  const edits = new Map<string, CallSiteEdit>();
  for (const b of breaks) {
    if (!b.rewrite || !b.replacements?.length) continue;
    for (const use of b.uses) {
      for (const site of use.callSites) {
        const file = callSiteFile(site);
        const line = callSiteLine(site);
        if (line === null) continue;
        const key = `${file}:${line}`;
        const current = edits.get(key)?.newText ?? lineOf(file, line);
        if (current === null) continue;
        let next = current;
        for (const [before, after] of b.replacements) next = buildLiteralEdit(next, before, after)?.new ?? next;
        if (next === current) continue;
        edits.set(key, { file, line, oldText: edits.get(key)?.oldText ?? current, newText: next });
      }
    }
  }
  return [...edits.values()];
}

/** How a break reads in a diagnostic: `3 tests find this by "Pay now": getByRole('button', { name: 'Pay now' })`. */
export function breakMessage(anchor: DiffAnchor, breaks: LocatorBreak[]): string {
  const tests = new Set(breaks.flatMap((b) => b.tests.map((t) => t.id))).size;
  const change = anchor.after !== undefined ? `"${anchor.before}" → "${anchor.after}"` : `"${anchor.before}" removed`;
  const list = breaks
    .slice(0, 3)
    .map((b) => b.locator)
    .join(', ');
  const more = breaks.length > 3 ? ` and ${breaks.length - 3} more` : '';
  return `${tests} ${tests === 1 ? 'test finds' : 'tests find'} an element by "${anchor.before}" (${change}): ${list}${more}`;
}
