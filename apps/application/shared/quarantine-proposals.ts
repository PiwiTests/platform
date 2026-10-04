/**
 * The two quarantine proposals a person or an agent can dismiss: quarantining
 * a candidate (`quarantine`), or releasing a test whose release is proposed
 * (`release`). Pure, so the routes, the MCP tool and the dashboard share it.
 */
export const QUARANTINE_PROPOSALS = ['quarantine', 'release'] as const;
export type QuarantineProposal = (typeof QUARANTINE_PROPOSALS)[number];

export function isQuarantineProposal(value: unknown): value is QuarantineProposal {
  return typeof value === 'string' && (QUARANTINE_PROPOSALS as readonly string[]).includes(value);
}

/** Longest dismissal reason kept, like a quarantine or release reason; longer input is truncated. */
export const DISMISS_REASON_MAX_LENGTH = 500;

/** Trim a dismissal reason to its stored form: `null` when blank, cut at the maximum length. */
export function normalizeDismissReason(reason: unknown): string | null {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  return trimmed ? trimmed.slice(0, DISMISS_REASON_MAX_LENGTH) : null;
}
