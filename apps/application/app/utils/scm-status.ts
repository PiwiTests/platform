/**
 * The "What changed" line of a failure cluster when no diff resolved: what Piwi
 * knows about the commits (the range, the host's compare page, the local `git
 * log`), what it is missing, and what would fill the gap — from the SCM coverage
 * the diagnosis context reports.
 */
import type { DiagnosisContextCoverage } from '~~/types/api';

type ScmCoverage = NonNullable<DiagnosisContextCoverage['scm']>;

export type ScmStatusKind =
  /** A diff resolved: commits or files to show. */
  | 'resolved'
  /** The last passing run tested the same commit. */
  | 'same-commit'
  /** The range was read and no file changed. */
  | 'no-changes'
  /** No passing run to compare with. */
  | 'no-baseline'
  /** A passing run exists, but the runs record no commit. */
  | 'no-commit'
  /** The range is known, but the runs record no repository URL. */
  | 'no-repository'
  /** The repository is on a host Piwi does not read. */
  | 'unsupported-host'
  /** The host did not return the changes. */
  | 'fetch-failed'
  /** Nothing is known about the commits. */
  | 'unavailable';

export interface ScmStatus {
  kind: ScmStatusKind;
  /** The clause the line leads with. */
  text: string;
  /** What is missing or what to do next, one clause; null when the text says it all. */
  detail: string | null;
  /** The host's own compare page for the range. */
  compare: { url: string; label: string } | null;
  /** The command that lists the range locally. */
  gitCommand: string | null;
  /** A repository access token would let Piwi read the range. */
  needsToken: boolean;
  /** The error the host returned, for a tooltip. */
  error: string | null;
}

const HOST_LABEL: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket' };

function hostName(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** What the range is counted from, as a clause: `since the last passing run`. */
function rangeOrigin(scm: ScmCoverage): string {
  if (scm.baselineKind === 'manual') return 'from the baseline you picked';
  // Without a project-wide passing run, a range that is not a picked baseline
  // starts at the last run this test passed in.
  if (scm.baselineKind === 'test-green' || !scm.hasLastGreen) return 'since this test last passed';
  return 'since the last passing run';
}

/** Describe the SCM coverage of a cluster's diagnosis context in one line. */
export function describeScmStatus(scm: ScmCoverage | null | undefined): ScmStatus {
  const base: ScmStatus = {
    kind: 'unavailable',
    text: 'No commit information for this cluster',
    detail: null,
    compare: null,
    gitCommand: null,
    needsToken: false,
    error: null,
  };
  if (!scm) return base;

  const host = scm.provider ? (HOST_LABEL[scm.provider] ?? scm.provider) : null;
  const known: ScmStatus = {
    ...base,
    compare: scm.compareUrl && host ? { url: scm.compareUrl, label: `Compare on ${host}` } : null,
    gitCommand: scm.gitCommand ?? null,
    error: scm.error ?? null,
  };
  const range = scm.range ? `${scm.range.from}..${scm.range.to}` : null;

  if (scm.filesCount > 0 || scm.commitsCount > 0) {
    return { ...known, kind: 'resolved', text: range ? `${range} ${rangeOrigin(scm)}` : 'Changes found' };
  }

  if (scm.range && scm.range.from === scm.range.to) {
    const when = scm.hasLastGreen ? 'the last passing run' : 'the last run this test passed in';
    return {
      ...known,
      kind: 'same-commit',
      text: `Same commit as ${when} (${scm.range.from})`,
      detail: 'what broke it is not in the code: look at the data, the environment or the test itself',
    };
  }

  if (!scm.hasLastGreen && !scm.baseCommitUsed && !range) {
    return {
      ...known,
      kind: 'no-baseline',
      text: 'No passing run to compare with yet',
      detail: 'pick the last commit you know was good to see what changed since',
    };
  }
  if (!range) {
    return {
      ...known,
      kind: 'no-commit',
      text: 'The runs do not record their commit',
      detail: 'the reporter reads it from the Git checkout the tests run in',
    };
  }

  const text = `${range} ${rangeOrigin(scm)}`;
  if (!scm.repositoryUrl) {
    return {
      ...known,
      kind: 'no-repository',
      text,
      detail: 'the checkout the tests run in has no origin remote, so Piwi cannot list the commits',
    };
  }
  if (!scm.provider) {
    const where = hostName(scm.repositoryUrl) ?? 'This host';
    return {
      ...known,
      kind: 'unsupported-host',
      text,
      detail: `${where} is not a host Piwi reads (GitHub, GitLab and Bitbucket are)`,
    };
  }
  if (scm.localGit && !scm.error) {
    return {
      ...known,
      kind: 'fetch-failed',
      text,
      detail: 'the folder linked to this project does not have these commits: fetch them there, or add an access token',
      needsToken: !scm.hasToken,
    };
  }
  if (scm.error || !scm.hasToken) {
    const what = scm.error ? `${host} did not return the changes` : `${host} returned no changes`;
    return {
      ...known,
      kind: 'fetch-failed',
      text,
      detail: scm.hasToken ? what : `${what}: a private repository needs an access token`,
      needsToken: !scm.hasToken,
    };
  }
  return { ...known, kind: 'no-changes', text: `No file changed ${rangeOrigin(scm)} (${range})` };
}
