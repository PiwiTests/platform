/**
 * Code reach: the application source files whose functions ran during a test,
 * from Chromium's JavaScript coverage. A file counts when at least one of its
 * functions ran, not counting a script's top-level code (importing a module
 * runs its top level, so it says nothing about the test) and code that maps to
 * no source. The reporter feeds this with `page.coverage` entries; this module
 * holds the pure part.
 */
import { lineStarts, offsetToPosition, type SourceMapLookup } from './source-map';

/** One script of a JavaScript coverage report, as Playwright's `stopJSCoverage` returns it. */
export interface JsCoverageEntry {
  url: string;
  source?: string;
  functions: Array<{
    functionName: string;
    isBlockCoverage?: boolean;
    ranges: Array<{ startOffset: number; endOffset: number; count: number }>;
  }>;
}

/** Files reached per test at most. */
export const MAX_CODE_REACH_FILES = 2000;

/**
 * The start offsets of the functions that ran in a script, without its
 * top-level function (the one spanning the whole script).
 */
export function executedFunctionOffsets(entry: JsCoverageEntry): number[] {
  const length = entry.source?.length ?? Number.POSITIVE_INFINITY;
  const out: number[] = [];
  entry.functions.forEach((fn, i) => {
    const whole = fn.ranges[0];
    if (!whole || whole.count <= 0) return;
    const topLevel = whole.startOffset === 0 && (whole.endOffset >= length || (i === 0 && fn.functionName === ''));
    if (topLevel) return;
    out.push(whole.startOffset);
  });
  return out;
}

/** Whether any function of the script other than its top level ran. */
export function scriptRan(entry: JsCoverageEntry): boolean {
  return executedFunctionOffsets(entry).length > 0;
}

/** The sources (indexes into `map.sources`) of the functions that ran, through the script's source map. */
export function reachedSources(entry: JsCoverageEntry, map: SourceMapLookup): Set<number> {
  const offsets = executedFunctionOffsets(entry);
  const reached = new Set<number>();
  if (!offsets.length || entry.source === undefined) return reached;
  const starts = lineStarts(entry.source);
  for (const offset of offsets) {
    const { line, column } = offsetToPosition(starts, offset);
    const source = map.sourceAt(line, column);
    if (source !== null) reached.add(source);
  }
  return reached;
}

/**
 * A reached file list as it goes on the wire: repository-relative POSIX
 * paths, `node_modules` and paths leaving the repository dropped, sorted,
 * capped at {@link MAX_CODE_REACH_FILES}.
 */
export function finalizeCodeReach(files: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const raw of files) {
    const file = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!file || file.startsWith('../') || file.startsWith('/') || /^[A-Za-z]:\//.test(file)) continue;
    if (/(^|\/)node_modules\//.test(file)) continue;
    out.add(file);
  }
  return [...out].sort().slice(0, MAX_CODE_REACH_FILES);
}
