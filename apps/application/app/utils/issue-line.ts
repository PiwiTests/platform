/**
 * Whether a failure page shows its Issue row, and in which form. One rule for
 * the execution page and the cluster page, so the ticket sits in the same place
 * on both: a tracked cluster always shows its issue; an untracked one offers to
 * file or link only while it is open and not snoozed, and only to a viewer who
 * can do one of the two; a filing waiting on the tracker shows as such.
 */
export interface IssueLineFacts {
  hasKnownIssue: boolean;
  filingQueued: boolean;
  /** The cluster's triage status (`open`, `resolved`, `ignored`). */
  clusterStatus: string | null | undefined;
  snoozed: boolean;
  canFile: boolean;
  canLink: boolean;
}

export type IssueLineForm = 'tracked' | 'queued' | 'untracked' | null;

export function issueLineForm(facts: IssueLineFacts): IssueLineForm {
  if (facts.hasKnownIssue) return 'tracked';
  if (facts.filingQueued) return 'queued';
  const wantsTicket = (facts.clusterStatus ?? 'open') === 'open' && !facts.snoozed;
  if (wantsTicket && (facts.canFile || facts.canLink)) return 'untracked';
  return null;
}
