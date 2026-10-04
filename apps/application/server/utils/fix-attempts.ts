/**
 * The runs' side of fix attempts: when a cluster's fix lands, each attempt
 * still `applied` that the fix carries is recorded `verified`; when the cluster
 * fails again, each attempt a fix verified is recorded `regressed`.
 *
 * An attempt is tied to the fix that landed by, in order: its commit (the run's
 * commit or one of the commits since the cluster last failed), a
 * `Piwi-Cluster: <id>` trailer naming the cluster in one of those commits, or
 * its branch being the run's. An attempt nothing ties stays `applied`.
 */
import { listFixAttempts, type FixAttempt } from '#shared/handlers/fix-attempts';
import { clusterIdsFromCommitMessage } from '#shared/commit-trailers';
import { sameCommit, type FixAttemptLink } from '#shared/fix-attempts';
import { recordOutcome } from './outcomes';
import { createScmProvider } from './scm';
import type { DbClient } from '../database';

/** A commit between the cluster's last failure and the fix, with its message. */
interface RangeCommit {
  sha: string;
  message: string;
}

/** Which open attempts a landed fix carries, and how each is tied to it. */
function tieFixAttempts(
  attempts: FixAttempt[],
  fix: { clusterId: number; commit: string | null; branch: string | null; commits: RangeCommit[] },
): Array<{ attempt: FixAttempt; link: FixAttemptLink }> {
  const trailer = fix.commits.some((c) => clusterIdsFromCommitMessage(c.message).includes(fix.clusterId));
  const tied: Array<{ attempt: FixAttempt; link: FixAttemptLink }> = [];
  for (const attempt of attempts) {
    if (attempt.outcome !== 'applied') continue;
    const { commit, branch } = attempt.details;
    let link: FixAttemptLink | null = null;
    if (commit && (sameCommit(commit, fix.commit) || fix.commits.some((c) => sameCommit(commit, c.sha)))) {
      link = 'commit';
    } else if (trailer) {
      link = 'trailer';
    } else if (branch && fix.branch && branch === fix.branch) {
      link = 'branch';
    }
    if (link) tied.push({ attempt, link });
  }
  return tied;
}

/** The commits from `fromSha` to `toSha` with their messages; empty when SCM cannot say. */
async function rangeCommits(
  db: DbClient,
  projectId: number,
  repositoryUrl: string | null,
  fromSha: string | null,
  toSha: string | null,
): Promise<RangeCommit[]> {
  if (!repositoryUrl || !fromSha || !toSha || fromSha === toSha) return [];
  try {
    const provider = await createScmProvider(repositoryUrl, db, projectId);
    const changes = provider ? await provider.fetchChanges(fromSha, toSha) : null;
    return (changes?.commits ?? []).map((c) => ({ sha: c.sha, message: c.message }));
  } catch {
    return [];
  }
}

/** Record `verified` on the attempts the fix that landed in `runId` carries. Returns how many. */
export async function verifyFixAttempts(
  db: DbClient,
  input: {
    projectId: number;
    clusterId: number;
    runId: number;
    commit: string | null;
    branch: string | null;
    fromCommit: string | null;
    repositoryUrl: string | null;
  },
): Promise<number> {
  const open = (await listFixAttempts(db, input.clusterId)).filter((a) => a.outcome === 'applied');
  if (open.length === 0) return 0;
  const commits = await rangeCommits(db, input.projectId, input.repositoryUrl, input.fromCommit, input.commit);
  const tied = tieFixAttempts(open, {
    clusterId: input.clusterId,
    commit: input.commit,
    branch: input.branch,
    commits,
  });
  for (const { attempt, link } of tied) {
    await recordOutcome(db, {
      projectId: input.projectId,
      kind: 'fix-attempt',
      subjectType: 'cluster',
      subjectId: input.clusterId,
      suggestionKey: attempt.key,
      outcome: 'verified',
      runId: input.runId,
      commit: input.commit,
      details: { ...attempt.details, link } as unknown as Record<string, unknown>,
    });
  }
  return tied.length;
}

/** Record `regressed` on the attempts a fix verified, when the cluster fails again in `runId`. */
export async function regressFixAttempts(
  db: DbClient,
  input: { projectId: number; clusterId: number; runId: number; commit: string | null },
): Promise<number> {
  const verified = (await listFixAttempts(db, input.clusterId)).filter((a) => a.outcome === 'verified');
  for (const attempt of verified) {
    await recordOutcome(db, {
      projectId: input.projectId,
      kind: 'fix-attempt',
      subjectType: 'cluster',
      subjectId: input.clusterId,
      suggestionKey: attempt.key,
      outcome: 'regressed',
      runId: input.runId,
      commit: input.commit,
      details: attempt.details as unknown as Record<string, unknown>,
    });
  }
  return verified.length;
}
