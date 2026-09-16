/**
 * Turn a locator-healing recommendation into a git-applyable edit.
 *
 * `locator-edit.ts` rewrites the failing locator call on a source line; this
 * module wraps that rewrite in a unified diff so the panel, the fix plan and the
 * MCP tools can hand out something `git apply` accepts, not only a display
 * string.
 *
 * When the captured `testSource` snippet is available it carries the lines
 * around the failing one, so the diff is built with real context and applies
 * with a plain `git apply`. Without it (only the single failing line is known)
 * the diff is context-free — still valid, but `git apply` needs `--unidiff-zero`
 * to place it.
 *
 * Pure + unit-tested (`tests/unit/heal-edit.test.ts`). Deterministic string
 * rewrite only; nothing here is model output.
 */
import { buildLocatorEdit } from '#shared/locator-edit';
import { parseCallsiteLocation } from '#shared/callsite-location';
import type { LocatorEdit } from '#shared/locator-healing.types';

/** A parsed row of a captured `testSource` snippet: its 1-based line and code. */
interface SourceRow {
  line: number;
  text: string;
}

// The reporter formats each snippet row as `<marker><padded line no> | <code>`
// and marks the failing line with `>` (reporter `source-snippet.ts`). The caret
// underline row (`   |   ^`) has no line number, so it never matches.
const SOURCE_ROW_RE = /^([>*\s])\s*(\d+)\s*\|\s?(.*)$/;

function parseSourceRows(testSource: string): SourceRow[] {
  const rows: SourceRow[] = [];
  for (const raw of testSource.split('\n')) {
    const m = SOURCE_ROW_RE.exec(raw);
    if (m) rows.push({ line: Number(m[2]), text: m[3]! });
  }
  return rows;
}

/**
 * A context-free unified diff for a single changed line. Valid, but with no
 * context lines `git apply` places it only under `--unidiff-zero`.
 */
export function buildUnifiedLineDiff(filePath: string, line: number, oldLine: string, newLine: string): string {
  return [`--- a/${filePath}`, `+++ b/${filePath}`, `@@ -${line},1 +${line},1 @@`, `-${oldLine}`, `+${newLine}`].join(
    '\n',
  );
}

/**
 * A context-bearing unified diff built from the captured `testSource` rows: the
 * maximal run of consecutively-numbered rows around `targetLine`, with that line
 * changed and its neighbors kept as context. Applies with a plain `git apply`.
 * Returns null when the target row isn't in the snippet, or the run has no
 * neighbor (a lone line — the caller falls back to the context-free form).
 */
function buildContextPatch(filePath: string, rows: SourceRow[], targetLine: number, newText: string): string | null {
  const ti = rows.findIndex((r) => r.line === targetLine);
  if (ti === -1) return null;
  // Grow a window of strictly consecutive line numbers around the target.
  let lo = ti;
  let hi = ti;
  while (lo > 0 && rows[lo - 1]!.line === rows[lo]!.line - 1) lo--;
  while (hi < rows.length - 1 && rows[hi + 1]!.line === rows[hi]!.line + 1) hi++;
  if (hi === lo) return null; // no neighbor to use as context

  const window = rows.slice(lo, hi + 1);
  const start = window[0]!.line;
  const count = window.length; // a one-line replacement leaves the count unchanged
  const body = window.map((r) => (r.line === targetLine ? `-${r.text}\n+${newText}` : ` ${r.text}`));
  return [`--- a/${filePath}`, `+++ b/${filePath}`, `@@ -${start},${count} +${start},${count} @@`, ...body].join('\n');
}

/**
 * Apply one locator-line rewrite to a file's full content, used as the
 * dispatcher's head-content guard: it proves the edit still fits the current
 * file before anything is committed.
 *
 * - `applied` — the old line was found (at the recorded line, or a unique match
 *   elsewhere) and replaced; `content` is the rewritten file.
 * - `already-applied` — the new line is already present (a prior attempt landed,
 *   or the file was fixed by hand); nothing to do, and not an error.
 * - `stale` — the old line is gone and not already healed, or matches
 *   ambiguously; the caller must not write a guess.
 *
 * EOL style (LF/CRLF) and trailing-newline presence are preserved, so a CRLF
 * file never turns a one-line change into a whole-file diff.
 */
export type ApplyLineResult = { kind: 'applied'; content: string } | { kind: 'already-applied' } | { kind: 'stale' };

export function applyLineEdit(
  content: string,
  edit: { line: number; oldLine: string; newLine: string },
): ApplyLineResult {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingNewline = /\r?\n$/.test(content);
  const lines = content.split(/\r?\n/);
  if (hadTrailingNewline) lines.pop(); // the empty element after the final newline

  const idx = edit.line - 1;
  const at = idx >= 0 && idx < lines.length ? lines[idx] : undefined;

  let target = -1;
  if (at === edit.oldLine) {
    target = idx;
  } else if (at === edit.newLine) {
    return { kind: 'already-applied' };
  } else {
    const oldMatches: number[] = [];
    let hasNewLine = false;
    lines.forEach((t, i) => {
      if (t === edit.oldLine) oldMatches.push(i);
      if (t === edit.newLine) hasNewLine = true;
    });
    if (oldMatches.length === 1) target = oldMatches[0]!;
    else if (oldMatches.length === 0 && hasNewLine) return { kind: 'already-applied' };
    else return { kind: 'stale' }; // gone, or ambiguous — never write a guess
  }

  lines[target] = edit.newLine;
  return { kind: 'applied', content: lines.join(eol) + (hadTrailingNewline ? eol : '') };
}

export interface HealEditInput {
  /** The failing call site (`file:line:col`), when identified. */
  location: string | null | undefined;
  /** The failing source line — number + text — parsed from the captured source. */
  sourceLine: { line: number; text: string } | null | undefined;
  /** The failing locator's method (`getByRole`, …), used to find the call to rewrite. */
  failingMethod: string | null | undefined;
  /** The recommended replacement locator expression. */
  recommendedLocator: string | null | undefined;
  /** The full captured source snippet, used to build a context-bearing diff. */
  testSource?: string | null;
  /** File path to use when the call site carries none (e.g. the test's own path). */
  fallbackFilePath?: string | null;
}

/**
 * Compose a ready-to-apply {@link LocatorEdit} from a healing result's parts, or
 * null when there is no line to rewrite, no recommendation, or the rewrite is a
 * no-op. `unifiedDiff` is null when no file path can be resolved (the old/new
 * lines are still returned so a caller can show the change).
 */
export function buildHealEdit(input: HealEditInput): LocatorEdit | null {
  const line = input.sourceLine?.line ?? null;
  const text = input.sourceLine?.text ?? null;
  if (line == null || !text || !input.failingMethod || !input.recommendedLocator) return null;

  const rewrite = buildLocatorEdit(text, input.failingMethod, input.recommendedLocator);
  if (!rewrite) return null;

  const filePath = parseCallsiteLocation(input.location)?.file ?? input.fallbackFilePath ?? null;
  let unifiedDiff: string | null = null;
  if (filePath) {
    const rows = input.testSource ? parseSourceRows(input.testSource) : [];
    unifiedDiff =
      buildContextPatch(filePath, rows, line, rewrite.new) ??
      buildUnifiedLineDiff(filePath, line, rewrite.old, rewrite.new);
  }

  return { filePath, line, oldLine: rewrite.old, newLine: rewrite.new, unifiedDiff };
}
