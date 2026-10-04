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

const CANCELLED = Symbol('cancelled');

/** `work`, or `CANCELLED` as soon as `signal` aborts, whichever comes first. */
function unlessAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof CANCELLED> {
  if (!signal) return work;
  if (signal.aborted) return Promise.resolve(CANCELLED);
  return new Promise((resolve, reject) => {
    const abort = () => resolve(CANCELLED);
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(err);
      },
    );
  });
}

/** Polls until an answer other than pending; an abort ends the wait at once, mid-sleep or mid-poll. */
export async function waitForApproval(opts: WaitOptions): Promise<ConnectOutcome> {
  const deadline = opts.now() + opts.expiresIn * 1000;
  let intervalMs = Math.max(1, opts.interval) * 1000;
  while (opts.now() < deadline) {
    if ((await unlessAborted(opts.sleep(intervalMs), opts.signal)) === CANCELLED) return { status: 'cancelled' };
    let answer: ConnectPoll | typeof CANCELLED;
    try {
      answer = await unlessAborted(opts.poll(), opts.signal);
    } catch {
      // A dropped request is retried at the next interval; the deadline still bounds the wait.
      continue;
    }
    if (answer === CANCELLED || opts.signal?.aborted) return { status: 'cancelled' };
    if (answer.status === 'pending') continue;
    if (answer.status === 'slow_down') {
      intervalMs = Math.max(intervalMs, answer.interval * 1000);
      continue;
    }
    return answer;
  }
  return { status: 'expired' };
}
