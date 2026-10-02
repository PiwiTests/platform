/**
 * A resource finding's identity across runs: its verdict, its kind, the scope
 * it outlived and where it was opened, line included, so two leaks of one file
 * are two findings. A Node handle is known by its type and the test that left
 * it; a page never used, by the fixtures that set it up. Its group is the same
 * identity without line numbers: an edit above the line moves a finding to a
 * new identity of the same group, and the history pairs the two
 * (`shared/handlers/resource-findings.ts`). Plain JS, so the demo seed
 * generator computes the same identity as the server and the demo.
 */

const LINE = /(\.[cm]?[jt]sx?):\d+(?::\d+)?/g;
const FIRST_LINE = /\.[cm]?[jt]sx?:(\d+)/;

/** `tests/cart.spec.ts:12:5` as `tests/cart.spec.ts`, wherever it appears in the text. */
function withoutLines(text) {
  return String(text ?? '').replace(LINE, '$1');
}

/** The identity of a finding, the same for every run that reports it at that line. */
export function resourceFingerprint(finding) {
  const detail = finding.verdict === 'handle' || finding.verdict === 'idle' ? String(finding.detail ?? '') : '';
  return [
    finding.verdict,
    finding.kind,
    finding.scope ?? '',
    String(finding.where ?? ''),
    finding.growth?.what ?? '',
    detail,
  ]
    .join('|')
    .slice(0, 500);
}

/** The group of an identity: the identities an edit above their line would turn into one another. */
export function resourceGroup(fingerprint) {
  return withoutLines(fingerprint);
}

/** The first line an identity (or a `file:line`) names, or null when it names none. */
export function openingLine(text) {
  const match = FIRST_LINE.exec(String(text ?? ''));
  return match ? Number(match[1]) : null;
}

/** A leak is an object left open: past its scope with the fixtures, or counted from the steps without them. */
export function isLeak(finding) {
  return finding.verdict === 'leaked' || finding.verdict === 'probable';
}
