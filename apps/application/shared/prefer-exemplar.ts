/**
 * Choose the better display exemplar for a failure cluster.
 *
 * A cluster's sample error is its human-facing face — it drives the AI's
 * "sample error" section, the cheap-model title and the signature fallback
 * name. As the cluster recurs, a later occurrence can carry richer diagnostic
 * text than the one it was created from. `preferExemplar` decides whether a
 * candidate error should replace the current display sample:
 *
 *  1. An error with a Playwright `Call log:` beats one without — the call log is
 *     the most actionable part of a failure.
 *  2. Otherwise the one with the longer pre-stack message head wins — more
 *     detail before the stack trace.
 *  3. Ties keep the current exemplar. Equally-good occurrences must not trigger
 *     a rewrite, so a recurring cluster doesn't churn its row (and invalidate
 *     its embedding) on every run.
 *
 * Pure and side-effect free; ANSI is stripped from both inputs, so it works on
 * raw or capped error text alike.
 */
import { stripAnsi } from './error-fingerprint';

function hasCallLog(text: string): boolean {
  return /call log:/i.test(text);
}

/** Length of the trimmed message that precedes the first stack frame. */
function messageHeadLength(text: string): number {
  const stackStart = text.search(/\n\s+at /);
  return (stackStart === -1 ? text : text.slice(0, stackStart)).trim().length;
}

/** True when `candidate` is a better display exemplar than `current`. */
export function preferExemplar(current: string, candidate: string): boolean {
  const cur = stripAnsi(current);
  const cand = stripAnsi(candidate);

  const curLog = hasCallLog(cur);
  const candLog = hasCallLog(cand);
  if (candLog !== curLog) return candLog;

  return messageHeadLength(cand) > messageHeadLength(cur);
}
