/**
 * Workflow transitions in the neutral shape the binding form and the server
 * share, and the one rule for which transition a sync policy's "transition id or
 * status name" means on an issue. Pure: the Jira client reads the transitions,
 * this only compares them.
 */
import type { TrackerField } from './fields';

/** Jira's status categories: to do, in progress, done. */
export type TransitionStatusCategory = 'new' | 'indeterminate' | 'done';

export interface TrackerTransitionOption {
  id: string;
  /** The transition's own name, e.g. "Resolve issue". */
  name: string;
  /** The status it leads to, e.g. "Done". */
  toStatus: string | null;
  toStatusCategory: TransitionStatusCategory | null;
  /** The fields its screen asks for; empty when it has no screen. */
  fields: TrackerField[];
}

/** An issue the binding form reads transitions from, with the transitions it offers. */
export interface TransitionSample {
  /** The issue read, or null when the project has none in that state yet. */
  issue: { key: string; status: string | null } | null;
  transitions: TrackerTransitionOption[];
}

/**
 * The transition a policy's setting means on an issue: the one with that id,
 * else the one leading to a status of that name, else the one of that name —
 * case-insensitively, on the site's own names. Null when the issue offers none
 * of them (it is already there, or the workflow has no such step).
 */
export function matchTransition<T extends { id: string; name: string; toStatus?: string | null }>(
  available: readonly T[],
  idOrName: string | null | undefined,
): T | null {
  const wanted = idOrName?.trim();
  if (!wanted) return null;
  const byId = available.find((t) => t.id === wanted);
  if (byId) return byId;
  const lower = wanted.toLowerCase();
  return (
    available.find((t) => (t.toStatus ?? '').trim().toLowerCase() === lower) ??
    available.find((t) => t.name.trim().toLowerCase() === lower) ??
    null
  );
}

/** The value a picked transition fills a policy's setting with: its target status, else its name. */
export function transitionSettingValue(t: Pick<TrackerTransitionOption, 'name' | 'toStatus'>): string {
  return t.toStatus?.trim() || t.name;
}
