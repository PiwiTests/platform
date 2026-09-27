import type { ClusterStateKind } from '#shared/cluster-state';

/**
 * The color a cluster's state reads in at a glance — red still failing, green
 * fixed, amber quiet or parked, neutral resolved / ignored / snoozed — as the
 * state line's dot class and as the situation block's edge (none when neutral).
 */
export interface ClusterStateColor {
  dot: string;
  edge: string | null;
}

const ERROR: ClusterStateColor = { dot: 'bg-error', edge: 'var(--ui-error)' };
const WARNING: ClusterStateColor = { dot: 'bg-warning', edge: 'var(--ui-warning)' };
const SUCCESS: ClusterStateColor = { dot: 'bg-success', edge: 'var(--ui-success)' };
const MUTED: ClusterStateColor = { dot: 'bg-muted', edge: null };

const BY_KIND: Record<ClusterStateKind, ClusterStateColor> = {
  failing: ERROR,
  'failing-assigned': ERROR,
  regressed: ERROR,
  quiet: WARNING,
  quarantined: WARNING,
  'fix-verified-open': SUCCESS,
  'stopped-failing-open': SUCCESS,
  'ticket-done': SUCCESS,
  resolved: SUCCESS,
  ignored: MUTED,
  snoozed: MUTED,
};

export function clusterStateColor(kind: ClusterStateKind | null | undefined): ClusterStateColor {
  return (kind && BY_KIND[kind]) || MUTED;
}
