/**
 * Parse a captured call-site string into its parts.
 *
 * Capture records a locator's call site as `file:line:col` (the column is
 * optional), where the file is whatever `path.relative(process.cwd(), …)`
 * produced on the machine that ran the test — so it can be a POSIX path
 * (`tests/checkout.spec.ts:42:5`) or a Windows absolute path whose drive letter
 * carries its own colon (`C:/repo/tests/checkout.spec.ts:42:5`). The parse is
 * end-anchored on the trailing `:line[:col]` so a colon inside the path can
 * never be mistaken for the line number — the bug a naive `location.split(':')`
 * hits, which yields `file = "C"` and `line = NaN`.
 */
export interface CallsiteLocation {
  file: string;
  line: number;
  column: number | null;
}

// Everything up to the last `:line` (or `:line:col`) is the file. The file group
// is lazy so the numeric tail wins, and `$` forces the match to the end.
const CALLSITE_RE = /^(.*?):(\d+)(?::(\d+))?$/;

export function parseCallsiteLocation(location: string | null | undefined): CallsiteLocation | null {
  if (!location) return null;
  const m = CALLSITE_RE.exec(location);
  if (!m || !m[1]) return null;
  return { file: m[1], line: Number(m[2]), column: m[3] ? Number(m[3]) : null };
}
