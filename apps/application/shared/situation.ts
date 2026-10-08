/**
 * The situation sentence: one line of prose that says, for a failing execution,
 * what is going on — since when, on which commit and author, in how many other
 * tests, which cluster and its state, and who owns it. It replaces the three
 * competing "since when" wordings and the fact-row chips with a single sentence,
 * and returns typed parts so the UI can turn the run, commit, cluster and owner
 * into links.
 *
 * Pure assembly over the verdict the endpoints already build; every clause is
 * omitted when its fact is unknown.
 */
import type { FailureVerdict, FailureWhy } from '#shared/failure-verdict';
import { relativeTimeAgo } from '#shared/relative-time';

/** One span of the sentence — plain text, or a linkable reference the UI can render. */
export interface SituationPart {
  kind: 'text' | 'run' | 'commit' | 'cluster' | 'owner' | 'test';
  text: string;
  /** The entity id behind a `run` / `commit` / `cluster` part, for the link. */
  id?: string | number;
  /** An optional app-relative href the UI may use directly. */
  href?: string;
}

export interface Situation {
  text: string;
  parts: SituationPart[];
}

export interface SituationInput {
  why: FailureWhy | null;
  since: FailureVerdict['since'];
  cluster: FailureVerdict['cluster'];
  owner: FailureVerdict['owner'];
  /** The cluster's human triage status (`open` / `resolved` / `ignored`). */
  clusterStatus?: string | null;
  /** The cluster's assignee, when one is set — overrides "unassigned". */
  assignee?: string | null;
  /** Fixed for tests; defaults to now. */
  now?: Date;
}

/** The badge that leads the sentence for an exceptional why. */
const WHY_LEAD: Record<FailureWhy, string> = {
  'new-regression': 'New regression',
  'passed-on-retry': 'Passed on retry',
  'new-flaky': 'Newly flaky',
  infrastructure: 'Infrastructure failure',
};

/** Build the one-sentence situation and its typed parts. */
export function buildSituation(input: SituationInput): Situation {
  const parts: SituationPart[] = [];
  const push = (kind: SituationPart['kind'], text: string, extra: Omit<SituationPart, 'kind' | 'text'> = {}) => {
    if (text) parts.push({ kind, text, ...extra });
  };

  const since = input.since;
  const now = input.now ?? new Date();

  // Lead — the exceptional why, when there is one.
  if (input.why) push('text', `${WHY_LEAD[input.why]} — `);

  // Since when — said once.
  if (since.isFirstFailure) {
    push('text', 'first failed in this run');
  } else {
    push('text', 'failing since ');
    push('run', `run #${since.firstFailingRunId}`, {
      id: since.firstFailingRunId,
      href: `/test-runs/${since.firstFailingRunId}`,
    });
  }
  const rel = relativeTimeAgo(since.firstFailingAt, now);
  if (rel) push('text', ` (${rel})`);

  // Commit and author — once.
  if (since.commit) {
    push('text', ' on ');
    push('commit', since.commit.shortSha, { id: since.commit.sha });
    if (since.commit.author) push('text', ` by ${since.commit.author}`);
  }
  push('text', '. ');

  // Cluster — its status, assignee-or-unassigned, and the fixed-before fact.
  if (input.cluster) {
    const others = input.cluster.otherTestsInRun;
    if (others > 0) {
      push('text', `Same failure in ${others} other test${others === 1 ? '' : 's'} → `);
    } else {
      push('text', 'In ');
    }
    push('cluster', `cluster #${input.cluster.id}`, {
      id: input.cluster.id,
      href: `/failure-clusters/${input.cluster.id}`,
    });
    const status = input.clusterStatus?.trim() || 'open';
    const assigneeText = input.assignee?.trim() ? `assigned to ${input.assignee.trim()}` : 'unassigned';
    const fixedBefore = since.fixedBefore ? '; fixed once before, the fix did not hold' : '';
    push('text', ` (${status}, ${assigneeText}${fixedBefore}). `);
  }

  // Owner — closes the sentence.
  if (input.owner) {
    push('text', 'Owner ');
    push('owner', input.owner.name, { id: input.owner.name });
    push('text', '.');
  }

  // Capitalize the first word when no lead badge started the sentence.
  if (parts.length > 0 && parts[0]!.kind === 'text') {
    parts[0]!.text = parts[0]!.text.charAt(0).toUpperCase() + parts[0]!.text.slice(1);
  }

  const text = parts
    .map((p) => p.text)
    .join('')
    .trim();
  return { text, parts };
}
