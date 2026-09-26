import { BUILD_ID } from './build-id.js';

/**
 * What a tool says when the background worker ignores a message it should
 * know: the worker only leaves a message unanswered when its build predates
 * that message, which happens when the extension was rebuilt without being
 * reloaded (see `build-id.ts`).
 */
export const OUTDATED_WORKER_MESSAGE =
  'Piwi Picker was rebuilt without being reloaded, and its background worker still runs the previous build. Reload the extension from its popup, or from the browser’s extensions page.';

export type WorkerState = 'current' | 'outdated' | 'unreachable';

/** Whether the background worker runs the same build as the caller. */
export async function workerState(): Promise<WorkerState> {
  try {
    const answer = (await chrome.runtime.sendMessage({ type: 'piwi-ping' })) as { build?: unknown } | undefined;
    return answer?.build === BUILD_ID ? 'current' : 'outdated';
  } catch {
    return 'unreachable';
  }
}
