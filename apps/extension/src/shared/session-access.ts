/**
 * Waits until `chrome.storage.session` is actually readable from a content
 * script.
 *
 * Session storage defaults to extension-page-only access; the background
 * worker widens it with `setAccessLevel` at startup. But that worker is torn
 * down when idle and restarted on demand, so a content script injected at
 * `document_start` — which is how the recorder re-attaches on every
 * navigation — can run before the widening has been applied, and a read then
 * *throws* rather than returning empty.
 *
 * Pinging the worker fixes both halves at once: sending a message wakes it,
 * and its reply is deliberately withheld until `setAccessLevel` has resolved.
 *
 * Firefox has neither the wider access level nor session storage in content
 * scripts; there `sessionArea()` sends every call to the background script
 * instead (see `session-area.ts`), and this ping only wakes it.
 *
 * Memoized per content-script instance (one document), so this costs a single
 * round-trip no matter how many storage calls follow.
 */
let ready: Promise<void> | null = null;

export function ensureSessionAccess(): Promise<void> {
  ready ??= (async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'piwi-ping' });
    } catch {
      // Worker unreachable (extension reloading, or mid-teardown). Fall
      // through and let the storage call itself decide — retrying here would
      // just stall the caller's UI.
    }
  })();
  return ready;
}

/** Test seam: forget the memoized ping so a fresh document starts clean. */
export function resetSessionAccessForTests(): void {
  ready = null;
}
