/**
 * The situation of a failing execution, in three lines the execution page puts
 * where each belongs:
 *
 * - `since`, under the headline: why and since when it fails, on which commit
 *   and author (and the owner when there is no cluster);
 * - `latest`, beside it: whether a newer execution of the test failed again or
 *   passed, with one link to it;
 * - `cluster`, the block's Cluster line: how many other tests of the run share
 *   the failure, the cluster and its status, whether an earlier fix did not
 *   hold, and who owns it.
 *
 * `text` joins the three as sentences, for the MCP tools. Each line returns
 * typed parts so the UI can turn the run, commit, cluster and execution into
 * links. Pure assembly over the verdict and the latest-execution summary the
 * endpoints already build; every clause is omitted when its fact is unknown.
 */
import type { FailureVerdict, FailureWhy } from '#shared/failure-verdict';
import type { LatestExecution } from '#shared/latest-execution';
import { relativeTimeAgo } from '#shared/relative-time';
import { isFailedStatus } from '#shared/utils/test-counts';

/** One span of a line: plain text, or a linkable reference the UI can render. */
export interface SituationPart {
  kind: 'text' | 'run' | 'commit' | 'cluster' | 'owner' | 'test' | 'execution';
  text: string;
  /** The entity id behind a `run` / `commit` / `cluster` / `execution` part, for the link. */
  id?: string | number;
  /** An optional app-relative href the UI may use directly. */
  href?: string;
}

/**
 * One line and its parts. An `execution` part is a link the UI shows after the
 * sentence ("Open the latest"); `text` is the sentence without it.
 */
export interface SituationLine {
  text: string;
  parts: SituationPart[];
}

export interface Situation {
  /** The three lines as sentences, for a reader without the page. */
  text: string;
  since: SituationLine;
  latest: SituationLine | null;
  cluster: SituationLine | null;
}

export interface SituationInput {
  why: FailureWhy | null;
  since: FailureVerdict['since'];
  cluster: FailureVerdict['cluster'];
  owner: FailureVerdict['owner'];
  /** The cluster's human triage status (`open` / `resolved` / `ignored`). */
  clusterStatus?: string | null;
  /** The cluster's assignee, named in the cluster line when one is set. */
  assignee?: string | null;
  /** The newer executions of the test, summed up; null leaves the latest line out. */
  latest?: LatestExecution | null;
  /** Fixed for tests; defaults to now. */
  now?: Date;
}

/** The words that lead the since line for an exceptional why. */
const WHY_LEAD: Record<FailureWhy, string> = {
  'new-regression': 'New regression',
  'passed-on-retry': 'Passed on retry',
  'new-flaky': 'Newly flaky',
  infrastructure: 'Infrastructure failure',
};

class LineBuilder {
  readonly parts: SituationPart[] = [];
  push(kind: SituationPart['kind'], text: string, extra: Omit<SituationPart, 'kind' | 'text'> = {}) {
    if (text) this.parts.push({ kind, text, ...extra });
    return this;
  }
  build(): SituationLine {
    const first = this.parts[0];
    if (first?.kind === 'text') first.text = first.text.charAt(0).toUpperCase() + first.text.slice(1);
    const text = this.parts
      .filter((p) => p.kind !== 'execution')
      .map((p) => p.text)
      .join('')
      .trim();
    return { text, parts: this.parts };
  }
}

function pushOwner(line: LineBuilder, owner: FailureVerdict['owner']) {
  if (!owner) return;
  line.push('text', 'Owner ').push('owner', owner.name, { id: owner.name });
}

/** Why and since when, then the commit and author: the line under the headline. */
function sinceLine(input: SituationInput, now: Date): SituationLine {
  const line = new LineBuilder();
  const since = input.since;
  const commit = since.commit;
  const rel = relativeTimeAgo(since.firstFailingAt, now);
  const by = commit?.author ? ` by ${commit.author}` : '';

  if (since.isFirstFailure && input.why === 'new-regression' && commit) {
    // "New regression since a1b2c3d by Alice Chen, 1 day ago"
    line.push('text', `${WHY_LEAD['new-regression']} since `);
    line.push('commit', commit.shortSha, { id: commit.sha });
    line.push('text', `${by}${rel ? `, ${rel}` : ''}`);
  } else if (since.isFirstFailure) {
    // "First failed in this run, on a1b2c3d by Alice Chen, 1 day ago"
    line.push('text', `${input.why ? `${WHY_LEAD[input.why]}, first` : 'first'} failed in this run`);
    if (commit) {
      line.push('text', ', on ');
      line.push('commit', commit.shortSha, { id: commit.sha });
      line.push('text', by);
    }
    if (rel) line.push('text', `, ${rel}`);
  } else {
    // "Failing since run #4, 2 days ago, this run on a1b2c3d by Alice Chen"
    line.push('text', `${input.why ? `${WHY_LEAD[input.why]}, failing` : 'failing'} since `);
    line.push('run', `run #${since.firstFailingRunId}`, {
      id: since.firstFailingRunId,
      href: `/test-runs/${since.firstFailingRunId}`,
    });
    if (rel) line.push('text', `, ${rel}`);
    if (commit) {
      line.push('text', ', this run on ');
      line.push('commit', commit.shortSha, { id: commit.sha });
      line.push('text', by);
    }
  }

  // Without a cluster line, the owner ends this one.
  if (!input.cluster && input.owner) {
    line.push('text', '. ');
    pushOwner(line, input.owner);
  }
  return line.build();
}

/** "run #2", "run #2 and run #1". */
function runList(ids: number[]): string {
  const names = ids.map((id) => `run #${id}`);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** What the newest execution did, in a run (`passed in run #62`). */
function outcomeWords(status: string, retries: number): string {
  if (isFailedStatus(status)) return 'failed';
  if (status === 'passed') return retries > 0 ? 'passed on retry' : 'passed';
  if (status === 'skipped') return 'was skipped';
  if (status === 'didnotrun') return 'did not run';
  if (status === 'interrupted') return 'was interrupted';
  return status;
}

/** Whether a newer execution failed again or passed: the line beside the since line. */
function latestLine(latest: LatestExecution, input: SituationInput, now: Date): SituationLine | null {
  const line = new LineBuilder();
  const newest = latest.newest;
  if (!newest) {
    line.push(
      'text',
      latest.laterInOtherProject && latest.projectName
        ? `Latest ${latest.projectName} execution of this test`
        : 'Latest execution of this test',
    );
    return line.build();
  }

  const failed = isFailedStatus(newest.status);
  const anotherError = failed && !newest.sameCluster && input.cluster != null;
  if (newest.sameRun) {
    // "Not the latest: attempt 2 of this run passed"
    const did = failed ? 'failed again' : outcomeWords(newest.status, 0);
    line.push('text', `Not the latest: attempt ${newest.retries + 1} of this run ${did}`);
  } else {
    const rel = relativeTimeAgo(newest.at, now);
    let what: string;
    if (failed) {
      const again = `failed again${anotherError ? ' with another error' : ''}`;
      const count = latest.failedAgainCount;
      what =
        count > 2
          ? `${again} in ${count} later runs, most recently run #${newest.runId}`
          : `${again} in ${runList(latest.failedAgainRunIds.length ? latest.failedAgainRunIds : [newest.runId])}`;
    } else {
      what = `${outcomeWords(newest.status, newest.retries)} in run #${newest.runId}`;
    }
    line.push('text', `Not the latest: ${what}${rel ? `, ${rel}` : ''}`);
  }
  line.push('execution', 'Open the latest', {
    id: newest.executionId,
    href: `/test-run-cases/${newest.executionId}`,
  });
  return line.build();
}

/** The cluster, its status and assignee, a fix that did not hold, and the owner. */
function clusterLine(input: SituationInput): SituationLine | null {
  const cluster = input.cluster;
  if (!cluster) return null;
  const line = new LineBuilder();
  const others = cluster.otherTestsInRun;
  if (others > 0) line.push('text', `Same failure in ${others} other test${others === 1 ? '' : 's'} of this run: `);
  line.push('cluster', `${others > 0 ? 'cluster' : 'Cluster'} #${cluster.id}`, {
    id: cluster.id,
    href: `/failure-clusters/${cluster.id}`,
  });
  const status = input.clusterStatus?.trim() || 'open';
  const assignee = input.assignee?.trim() ? `, assigned to ${input.assignee.trim()}` : '';
  line.push('text', `, ${status}${assignee}.`);
  if (input.since.fixedBefore) line.push('text', ' A fix landed once and did not hold.');
  if (input.owner) {
    line.push('text', ' ');
    pushOwner(line, input.owner);
    line.push('text', '.');
  }
  return line.build();
}

/** A sentence ends with a period unless it already ends in punctuation. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** Build the situation's three lines and the text that joins them. */
export function buildSituation(input: SituationInput): Situation {
  const now = input.now ?? new Date();
  const since = sinceLine(input, now);
  const latest = input.latest ? latestLine(input.latest, input, now) : null;
  const cluster = clusterLine(input);
  const text = [since, latest, cluster]
    .filter((l): l is SituationLine => l != null && l.text.length > 0)
    .map((l) => sentence(l.text))
    .join(' ');
  return { text, since, latest, cluster };
}
