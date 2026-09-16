/**
 * The retry arithmetic shared by every outbox sweeper — notifications, auto-heal
 * and integrations. All three snapshot a payload at enqueue, attempt it, and on
 * failure bump `attempts`, record the error, and reschedule with progressive
 * backoff until a bounded cap turns the row terminally `failed`.
 *
 * The sweepers keep their own loops (they read different tables and act on
 * different providers); only the "when does the next attempt run, and is this the
 * last one" decision lives here so the three agree.
 */

/** After this many attempts a failed row is terminal rather than retried. */
export const OUTBOX_MAX_ATTEMPTS = 5;

/** Minutes to wait before attempt N, indexed by the just-incremented count. */
export const OUTBOX_BACKOFF_MINUTES = [1, 5, 15, 60, 240];

export interface NextAttempt {
  /** `failed` once the attempt cap is reached, else `pending` for another try. */
  status: 'pending' | 'failed';
  /** When the retry is due — the row's current value when terminal. */
  scheduledFor: Date | null;
}

/**
 * Decide a failed row's next state from its just-incremented attempt count.
 *
 * `attempts` is the count *after* this failure. When a provider hands back an
 * explicit wait (Jira's `429 Retry-After`), pass it as `retryAfterMs` and it
 * wins over the progressive backoff; otherwise the backoff table applies.
 */
export function nextAttempt(
  attempts: number,
  now: Date,
  currentScheduledFor: Date | null,
  retryAfterMs?: number | null,
): NextAttempt {
  if (attempts >= OUTBOX_MAX_ATTEMPTS) return { status: 'failed', scheduledFor: currentScheduledFor };
  const backoffMs =
    retryAfterMs != null && retryAfterMs > 0
      ? retryAfterMs
      : (OUTBOX_BACKOFF_MINUTES[Math.min(attempts, OUTBOX_BACKOFF_MINUTES.length - 1)] ?? 240) * 60 * 1000;
  return { status: 'pending', scheduledFor: new Date(now.getTime() + backoffMs) };
}
