/**
 * The waiting half of connecting to a Piwi instance (an RFC 8628 device
 * authorization): poll the instance every `interval` seconds until the user
 * allows or denies Piwi Picker there, the request expires, or the user cancels.
 * Pure apart from the functions it is handed, so a unit test drives it with a
 * fake clock.
 */

export type ConnectPoll =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'approved'; apiKey: string; user: { name: string } | null };

export type ConnectOutcome =
  | Extract<ConnectPoll, { status: 'approved' | 'denied' | 'expired' }>
  | { status: 'cancelled' };

export interface WaitOptions {
  poll: () => Promise<ConnectPoll>;
  /** Seconds between polls, as the instance asked. */
  interval: number;
  /** Seconds until the request expires. */
  expiresIn: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  signal?: AbortSignal;
}

export async function waitForApproval(opts: WaitOptions): Promise<ConnectOutcome> {
  const deadline = opts.now() + opts.expiresIn * 1000;
  let intervalMs = Math.max(1, opts.interval) * 1000;
  while (opts.now() < deadline) {
    await opts.sleep(intervalMs);
    if (opts.signal?.aborted) return { status: 'cancelled' };
    let answer: ConnectPoll;
    try {
      answer = await opts.poll();
    } catch {
      // A dropped request is retried at the next interval; the deadline still bounds the wait.
      continue;
    }
    if (opts.signal?.aborted) return { status: 'cancelled' };
    if (answer.status === 'pending') continue;
    if (answer.status === 'slow_down') {
      intervalMs = Math.max(intervalMs, answer.interval * 1000);
      continue;
    }
    return answer;
  }
  return { status: 'expired' };
}
