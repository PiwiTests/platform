/**
 * Helpers for reading a run's `metadata` JSON and diffing the environment / SCM /
 * browser context of two runs. Shared by the run-comparison handler and the
 * server-side regression-context builder so the diff stays identical on both.
 */

import { compareUrl } from '#shared/scm-urls';

/** One field that changed between two runs, for the "what changed" summary. */
export interface MetaDiffEntry {
  key: string;
  label: string;
  before: string | null;
  after: string | null;
}

/** The commit span between a baseline run and a later run, with a copyable git command. */
export interface CommitRange {
  fromSha: string;
  toSha: string;
  fromShort: string;
  toShort: string;
  repositoryUrl: string | null;
  compareUrl: string | null;
  gitCommand: string;
}

/** The slice of `test_runs.metadata` these helpers read. */
interface RunMetadataLike {
  scm?: { branch?: string | null } | null;
  ci?: { provider?: string | null } | null;
  htmlReport?: { projects?: Array<{ use?: { browserName?: string | null } | null }> } | null;
}

/** Build a provider-specific "compare two commits" URL, or null when the host is unknown. */
export function buildCompareUrl(repositoryUrl: string, fromSha: string, toSha: string): string | null {
  return compareUrl(repositoryUrl, fromSha, toSha);
}

/**
 * The commit span from a baseline commit to a later one, with a compare URL when
 * the repository host is known and the `git log --oneline` command that lists it.
 * Returns null when either commit is missing or the two are the same.
 */
export function buildCommitRange(
  repositoryUrl: string | null,
  fromSha: string | null | undefined,
  toSha: string | null | undefined,
): CommitRange | null {
  if (!fromSha || !toSha || fromSha === toSha) return null;
  return {
    fromSha,
    toSha,
    fromShort: fromSha.slice(0, 7),
    toShort: toSha.slice(0, 7),
    repositoryUrl,
    compareUrl: repositoryUrl ? buildCompareUrl(repositoryUrl, fromSha, toSha) : null,
    gitCommand: `git log --oneline ${fromSha}..${toSha}`,
  };
}

/** Comma-separated list of the distinct browser names configured in a run's report. */
export function getBrowserList(meta: RunMetadataLike | null | undefined): string {
  const projects = meta?.htmlReport?.projects;
  if (!projects?.length) return '';
  const names = [...new Set(projects.map((p) => p.use?.browserName).filter(Boolean))] as string[];
  return names.join(', ');
}

/** Diff two runs' environment, branch, CI provider and browser set. */
export function computeMetadataDiff(
  prevMeta: RunMetadataLike | null | undefined,
  currMeta: RunMetadataLike | null | undefined,
  prevEnv: string | null,
  currEnv: string | null,
): MetaDiffEntry[] {
  const diff: MetaDiffEntry[] = [];

  if (prevEnv !== currEnv) {
    diff.push({ key: 'environment', label: 'Environment', before: prevEnv, after: currEnv });
  }
  const prevBranch: string | null = prevMeta?.scm?.branch ?? null;
  const currBranch: string | null = currMeta?.scm?.branch ?? null;
  if (prevBranch !== currBranch) {
    diff.push({ key: 'branch', label: 'Branch', before: prevBranch, after: currBranch });
  }
  const prevCi: string | null = prevMeta?.ci?.provider ?? null;
  const currCi: string | null = currMeta?.ci?.provider ?? null;
  if (prevCi !== currCi) {
    diff.push({ key: 'ci_provider', label: 'CI provider', before: prevCi, after: currCi });
  }
  const prevBrowsers = getBrowserList(prevMeta);
  const currBrowsers = getBrowserList(currMeta);
  if (prevBrowsers !== currBrowsers) {
    diff.push({ key: 'browsers', label: 'Browsers', before: prevBrowsers || null, after: currBrowsers || null });
  }

  return diff;
}
