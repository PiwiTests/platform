/**
 * A run's environment-incident flag and a person's decision about it, as
 * stored in the run's metadata: the shapes and their readers, free of any
 * database code so the dashboard's pages can read them. The classifier and the
 * writes live in `shared/handlers/run-health.ts`.
 */

/**
 * The run-metadata key that marks a run as an environment incident: its
 * failures come from the environment under test being down, not from the
 * tests or the code.
 */
export const INCIDENT_RUN_METADATA_KEY = 'incident';

/** Where a person's decision about a run's incident flag is kept. */
export const INCIDENT_REVIEW_METADATA_KEY = 'incidentReview';

/** Which rule flagged the run: one of the classifier's, or a person. */
export type IncidentRule = 'host-unreachable' | 'browser-crash' | 'cross-project' | 'person';

/** `metadata.incident`: why the run is an environment incident. */
export interface RunIncident {
  rule: IncidentRule;
  /** One sentence for the run page and the notification. */
  reason: string;
  /** The app's host the failures were reaching, when one stood out. */
  host: string | null;
  /** Ids of the other projects where the same host or fingerprint failed within the window. */
  projects: number[];
  failedTests: number;
  executedTests: number;
  /** Failures navigating or connecting to {@link host}. */
  hostFailures: number;
  decidedBy: 'rule' | 'person';
  /** The person who marked the run, for `decidedBy: 'person'`. */
  by?: string | null;
  decidedAt: string;
  /** The first flagged run of the same incident across projects; the run's own id when it is the first. */
  firstRunId: number;
}

/** `metadata.incidentReview`: a person's decision, which the classifier never overrides. */
export interface IncidentReview {
  decision: 'marked' | 'cleared';
  by: string | null;
  at: string;
}

function metaRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
}

/** A run's incident flag, or null. */
export function readRunIncident(metadata: unknown): RunIncident | null {
  const incident = metaRecord(metadata)[INCIDENT_RUN_METADATA_KEY];
  return incident && typeof incident === 'object' && !Array.isArray(incident) ? (incident as RunIncident) : null;
}

/** A person's decision about a run's incident flag, or null. */
export function readIncidentReview(metadata: unknown): IncidentReview | null {
  const review = metaRecord(metadata)[INCIDENT_REVIEW_METADATA_KEY];
  return review && typeof review === 'object' && !Array.isArray(review) ? (review as IncidentReview) : null;
}

/**
 * Carry the incident flag and a person's decision from a run's stored metadata
 * onto metadata a reporter sent, which never sets either.
 */
export function keepIncidentMetadata(
  stored: unknown,
  incoming: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const kept = metaRecord(stored);
  const keys = [INCIDENT_RUN_METADATA_KEY, INCIDENT_REVIEW_METADATA_KEY].filter((k) => k in kept);
  if (keys.length === 0) return incoming;
  const next = { ...(incoming ?? {}) };
  for (const key of keys) next[key] = kept[key];
  return next;
}

/** Drop the incident keys from metadata a reporter sent: only the server sets them. */
export function withoutIncidentMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const next = { ...metadata };
  delete next[INCIDENT_RUN_METADATA_KEY];
  delete next[INCIDENT_REVIEW_METADATA_KEY];
  return next;
}

/** The longest reason a person may give. */
export const INCIDENT_REASON_MAX = 500;

/** A mark-or-clear request: true marks the run as an incident, false clears the flag. */
export interface RunIncidentRequest {
  incident: boolean;
  /** What the person said about it, for a mark. */
  reason: string | null;
}

/** Validate a mark-or-clear request body. Returns an error message for a bad one. */
export function parseSetRunIncident(body: unknown): RunIncidentRequest | string {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.incident !== 'boolean') return '`incident` must be true or false';
  if (b.reason != null && typeof b.reason !== 'string') return '`reason` must be a string';
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (reason.length > INCIDENT_REASON_MAX) return `\`reason\` is limited to ${INCIDENT_REASON_MAX} characters`;
  if (!b.incident && reason) return '`reason` is only accepted when marking a run';
  return { incident: b.incident, reason: reason || null };
}
