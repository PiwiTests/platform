import {
  BUG_EVIDENCE_LIMITS,
  type BugConsoleEntry,
  type BugContext,
  type BugFailedRequest,
  type BugScreenshot,
} from '@piwitests/core/bug-report';

/**
 * A bug recording's evidence, in `chrome.storage.session` beside the recording
 * itself (`recording-storage.ts`).
 *
 * Kept under its own keys rather than inside `RecordingState`: every captured
 * step rewrites that state, and a screenshot is hundreds of kilobytes that
 * would be copied on each keystroke. Screenshots have a key of their own for
 * the same reason, since console entries arrive far more often.
 */
const EVIDENCE_KEY = 'piwiBugEvidence';
const SCREENSHOTS_KEY = 'piwiBugScreenshots';

export interface StoredBugEvidence {
  console: BugConsoleEntry[];
  consoleDropped: number;
  requests: BugFailedRequest[];
  requestsDropped: number;
  /** The outline taken at the last marked step, or at Finish when nothing was marked. */
  outline: string | null;
  /** Why the last screenshot could not be taken, until one is. */
  screenshotNote: string | null;
  /** The title typed in the finish panel. */
  title: string | null;
  /** The page's context, taken at Finish. */
  context: BugContext | null;
  /** How many screenshots are kept, so the HUD need not read them to count them. */
  screenshots: number;
}

export interface StoredBugScreenshot {
  moment: BugScreenshot['moment'];
  step: number | null;
  takenAt: number;
  /** A `data:image/png;base64,…` URL. */
  dataUrl: string;
}

const EMPTY: StoredBugEvidence = {
  console: [],
  consoleDropped: 0,
  requests: [],
  requestsDropped: 0,
  outline: null,
  screenshotNote: null,
  title: null,
  context: null,
  screenshots: 0,
};

export async function getBugEvidence(): Promise<StoredBugEvidence> {
  const stored = await chrome.storage.session.get(EVIDENCE_KEY);
  const value = stored[EVIDENCE_KEY];
  return value && typeof value === 'object' ? { ...EMPTY, ...(value as StoredBugEvidence) } : { ...EMPTY };
}

/**
 * Serializes writes within one document, as `appendRecordingEvent` does: each
 * one reads the whole value and writes it back, and entries arrive in bursts.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function update(change: (current: StoredBugEvidence) => StoredBugEvidence): Promise<StoredBugEvidence> {
  const run = writeQueue.then(async () => {
    const next = change(await getBugEvidence());
    await chrome.storage.session.set({ [EVIDENCE_KEY]: next });
    return next;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

/** Adds console entries and failed requests, keeping the first of each up to the limit and counting the rest. */
export function appendBugEntries(entries: {
  console?: BugConsoleEntry[];
  requests?: BugFailedRequest[];
}): Promise<StoredBugEvidence> {
  return update((current) => {
    const consoleEntries = [...current.console];
    const requests = [...current.requests];
    let { consoleDropped, requestsDropped } = current;
    for (const e of entries.console ?? []) {
      if (consoleEntries.length < BUG_EVIDENCE_LIMITS.console) consoleEntries.push(e);
      else consoleDropped++;
    }
    for (const r of entries.requests ?? []) {
      if (requests.length < BUG_EVIDENCE_LIMITS.requests) requests.push(r);
      else requestsDropped++;
    }
    return { ...current, console: consoleEntries, consoleDropped, requests, requestsDropped };
  });
}

export function setBugEvidenceFields(
  fields: Partial<Pick<StoredBugEvidence, 'outline' | 'screenshotNote' | 'title' | 'context'>>,
): Promise<StoredBugEvidence> {
  return update((current) => ({ ...current, ...fields }));
}

export async function getBugScreenshots(): Promise<StoredBugScreenshot[]> {
  const stored = await chrome.storage.session.get(SCREENSHOTS_KEY);
  const value = stored[SCREENSHOTS_KEY];
  return Array.isArray(value) ? (value as StoredBugScreenshot[]) : [];
}

/**
 * Keeps a screenshot, at most `BUG_EVIDENCE_LIMITS.screenshots`: once full, a
 * new one replaces the last, so the latest moment (usually Finish) is always
 * there. Clears the note saying why one was missing.
 */
export async function addBugScreenshot(shot: StoredBugScreenshot): Promise<void> {
  const shots = await getBugScreenshots();
  if (shots.length >= BUG_EVIDENCE_LIMITS.screenshots) shots[shots.length - 1] = shot;
  else shots.push(shot);
  await chrome.storage.session.set({ [SCREENSHOTS_KEY]: shots });
  await update((current) => ({ ...current, screenshotNote: null, screenshots: shots.length }));
}

export async function clearBugEvidence(): Promise<void> {
  await chrome.storage.session.remove(EVIDENCE_KEY);
  await chrome.storage.session.remove(SCREENSHOTS_KEY);
}
