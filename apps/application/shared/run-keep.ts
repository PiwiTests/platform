/** Longest keep reason accepted; longer input is truncated. */
export const KEEP_REASON_MAX_LENGTH = 200;

/** Trim a keep reason to its stored form: `null` when blank, cut at the maximum length. */
export function normalizeKeepReason(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  return trimmed ? trimmed.slice(0, KEEP_REASON_MAX_LENGTH) : null;
}
