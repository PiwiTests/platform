/**
 * The cluster state: one sentence with one verb that says whether a failure
 * cluster is still failing, fixed, regressed, resolved, ignored, snoozed or
 * quarantined — and the single control that changes it. It replaces the four
 * contradicting status signals (a segmented button, a verification badge, its
 * own sentence and a snooze menu) with one line the reader can act on.
 *
 * Pure: it reads the cluster's stored fields and the project's run order (which
 * run is latest, how recent the last occurrence is) and never queries anything.
 */
import type { SituationPart } from '#shared/situation';
import { isCurrentlySnoozed } from '#shared/inbox-queues';
import { relativeTimeAgo, durationApprox, toEpochMs } from '#shared/relative-time';

export type ClusterStateKind =
  | 'failing'
  | 'failing-assigned'
  | 'quiet'
  | 'fix-verified-open'
  | 'stopped-failing-open'
  | 'ticket-done'
  | 'regressed'
  | 'resolved'
  | 'ignored'
  | 'snoozed'
  | 'quarantined';

export type ClusterStateAction = 'mark-resolved' | 'reopen' | 'unsnooze' | 'release' | null;

export interface ClusterState {
  kind: ClusterStateKind;
  sentence: string;
  action: ClusterStateAction;
  /** The sentence split into typed spans, so the UI can link the run references. */
  parts: SituationPart[];
}

export interface ClusterStateCluster {
  status: string;
  assignee?: string | null;
  fixVerification?: string | null;
  fixCommit?: string | null;
  fixLandedRunId?: number | null;
  lastSeenRunId: number;
  lastSeenAt?: string | Date | number | null;
  updatedAt?: string | Date | number | null;
  triageNote?: string | null;
  snoozedUntil?: string | Date | null;
  snoozeMode?: string | null;
  /** The run the failure came back in, when it regressed. */
  regressedSinceRunId?: number | null;
  /** How many tests the cluster spans, and how many of them are currently quarantined. */
  affectedTests: number;
  quarantinedTests: number;
  /** The cluster's known tracker issue, when one is pinned (its status drives the reconcile). */
  knownIssue?: { key: string; statusCategory?: string | null } | null;
}

export interface ClusterStateProject {
  /** The project's run ids, newest first (by start time). */
  runIdsNewestFirst: number[];
  now?: Date;
}

/**
 * A cluster is *failing* when its last occurrence is the project's latest run,
 * or within the last few runs — recent enough that the next run is expected to
 * fail too. Beyond that window an open cluster is *quiet*: still open, but it
 * has not been seen for a while.
 */
const FAILING_RUN_WINDOW = 3;

export function computeClusterState(cluster: ClusterStateCluster, project: ClusterStateProject): ClusterState {
  const now = project.now ?? new Date();
  const runs = project.runIdsNewestFirst;
  const latestRunId = runs.length > 0 ? runs[0]! : null;
  const seenIndex = runs.indexOf(cluster.lastSeenRunId); // 0 = latest run
  const isFailing = cluster.lastSeenRunId === latestRunId || (seenIndex >= 0 && seenIndex < FAILING_RUN_WINDOW);
  const runsSinceLastSeen = seenIndex >= 0 ? seenIndex : runs.length;

  const parts: SituationPart[] = [];
  const t = (text: string) => parts.push({ kind: 'text', text });
  const run = (id: number | null | undefined) => {
    if (id == null) {
      t('a run');
      return;
    }
    parts.push({ kind: 'run', text: `run #${id}`, id, href: `/test-runs/${id}` });
  };
  const done = (kind: ClusterStateKind, action: ClusterStateAction): ClusterState => ({
    kind,
    action,
    sentence: parts
      .map((p) => p.text)
      .join('')
      .trim(),
    parts,
  });

  // Terminal human status wins.
  if (cluster.status === 'resolved') {
    const rel = relativeTimeAgo(cluster.updatedAt, now);
    t(`Resolved${rel ? ` ${rel}` : ''}`);
    if (cluster.assignee?.trim()) t(` by ${cluster.assignee.trim()}`);
    t(cluster.triageNote?.trim() ? `: "${cluster.triageNote.trim()}".` : '.');
    return done('resolved', null);
  }
  if (cluster.status === 'ignored') {
    t(cluster.triageNote?.trim() ? `Ignored: "${cluster.triageNote.trim()}".` : 'Ignored.');
    return done('ignored', null);
  }

  // A snooze the user set hides the cluster; it overrides the machine state.
  if (isCurrentlySnoozed({ snoozedUntil: cluster.snoozedUntil ?? null, snoozeMode: cluster.snoozeMode ?? null }, now)) {
    if (cluster.snoozeMode === 'until-recurs') {
      t('Snoozed until it recurs — open underneath.');
    } else {
      const until = toEpochMs(cluster.snoozedUntil ?? null);
      const when = until != null ? new Date(until).toISOString().slice(0, 10) : null;
      t(when ? `Snoozed until ${when} — open underneath.` : 'Snoozed — open underneath.');
    }
    return done('snoozed', 'unsnooze');
  }

  // The ticket has been closed but the cluster is still open — offer to reconcile
  // (the resolve-on-close policy does this automatically when it is on).
  if (cluster.status === 'open' && cluster.knownIssue?.key && cluster.knownIssue.statusCategory === 'done') {
    t(`${cluster.knownIssue.key} is Done — mark this cluster resolved?`);
    return done('ticket-done', 'mark-resolved');
  }

  // Fix verification: a fix that regressed, held, or stopped the failures. It is
  // a stronger claim than the quarantine overlay below — a fix that landed
  // outranks tests that are merely parked.
  if (cluster.fixVerification === 'regressed') {
    const commit = cluster.fixCommit?.trim();
    t(commit ? `Fixed by ${commit}, back since ` : 'Fixed earlier, back since ');
    run(cluster.regressedSinceRunId ?? cluster.lastSeenRunId);
    t(' — the fix did not hold.');
    return done('regressed', cluster.status === 'resolved' ? 'reopen' : null);
  }
  if (cluster.fixVerification === 'diagnosis-verified') {
    t('Fixed in ');
    run(cluster.fixLandedRunId);
    const commit = cluster.fixCommit?.trim();
    t(`${commit ? ` (${commit})` : ''} and verified, still marked open.`);
    return done('fix-verified-open', 'mark-resolved');
  }
  if (cluster.fixVerification === 'stopped-failing') {
    t('Stopped failing in ');
    run(cluster.fixLandedRunId);
    t(' — no fix identified, still open.');
    return done('stopped-failing-open', 'mark-resolved');
  }

  // Every test parked in quarantine: the cluster stays open until they are released.
  if (cluster.affectedTests > 0 && cluster.quarantinedTests >= cluster.affectedTests) {
    t(
      `All ${cluster.affectedTests} test${cluster.affectedTests === 1 ? ' is' : 's are'} quarantined; the cluster stays open until ${
        cluster.affectedTests === 1 ? 'it is' : 'they are'
      } released.`,
    );
    return done('quarantined', 'release');
  }

  // Still failing, or quiet-but-open.
  if (isFailing) {
    if (cluster.assignee?.trim()) {
      const since = relativeTimeAgo(cluster.updatedAt, now);
      const sinceDur = since && since !== 'just now' ? ` since ${since.replace(/ ago$/, '')}` : '';
      t(`Still failing — ${cluster.assignee.trim()} is on it${sinceDur}.`);
      return done('failing-assigned', null);
    }
    const rel = relativeTimeAgo(cluster.lastSeenAt, now);
    t(`Still failing — last seen${rel ? ` ${rel}` : ''} in `);
    run(cluster.lastSeenRunId);
    t(', open, unassigned.');
    return done('failing', null);
  }

  const rel = toEpochMs(cluster.lastSeenAt ?? null);
  const span = rel != null ? durationApprox(now.getTime() - rel) : null;
  t(
    `Not seen for ${runsSinceLastSeen} run${runsSinceLastSeen === 1 ? '' : 's'}${span ? ` (${span})` : ''}, still open.`,
  );
  return done('quiet', 'mark-resolved');
}
