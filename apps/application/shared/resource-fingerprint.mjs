/**
 * A resource finding's identity across runs: its verdict, its kind, the scope
 * it outlived and where it was opened, with line numbers dropped so an edit
 * above the line does not make an old leak look new. A Node handle is known by
 * its type and the test that left it; a page never used, by the fixtures that
 * set it up. Plain JS, so the demo seed generator computes the same identity
 * as the server and the demo.
 */

const LINE = /(\.[cm]?[jt]sx?):\d+(?::\d+)?/g;

/** `tests/cart.spec.ts:12:5` as `tests/cart.spec.ts`, wherever it appears in the text. */
export function withoutLines(text) {
  return String(text ?? '').replace(LINE, '$1');
}

/** The identity of a finding, the same for every run that reports it. */
export function resourceFingerprint(finding) {
  const detail = finding.verdict === 'handle' || finding.verdict === 'idle' ? withoutLines(finding.detail) : '';
  return [
    finding.verdict,
    finding.kind,
    finding.scope ?? '',
    withoutLines(finding.where),
    finding.growth?.what ?? '',
    detail,
  ]
    .join('|')
    .slice(0, 500);
}

/** A leak is an object left open: past its scope with the fixtures, or counted from the steps without them. */
export function isLeak(finding) {
  return finding.verdict === 'leaked' || finding.verdict === 'probable';
}
