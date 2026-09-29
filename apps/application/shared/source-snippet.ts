/**
 * The reporter's captured source snippet (`TestSourceFrame.snippet`,
 * `testSource`): one row per line, `<marker><padded line no> | <code>`, with
 * `>` on the failing line and `*` on the test declaration when the two differ
 * (reporter `source-snippet.ts`).
 */

/** One row of a source snippet. */
export interface SnippetRow {
  /** The row's prefix up to and including the ` | ` separator, as written; '' for a row without one. */
  gutter: string;
  /** The 1-based source line, or null for a row that is not a numbered line (a caret underline). */
  line: number | null;
  /** The source text after the gutter. */
  code: string;
  /** The `>`-marked line the frame points at. */
  failing: boolean;
}

const SNIPPET_ROW = /^([>*\s]\s*(\d+)\s*\|\s?)(.*)$/;

export function parseSourceSnippet(snippet: string): SnippetRow[] {
  return snippet.split('\n').map((raw) => {
    const m = SNIPPET_ROW.exec(raw);
    if (!m) return { gutter: '', line: null, code: raw, failing: false };
    return { gutter: m[1]!, line: Number(m[2]), code: m[3]!, failing: raw.startsWith('>') };
  });
}
