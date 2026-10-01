import { BUG_EVIDENCE_LIMITS } from '@piwitests/core/bug-report';
import { getRecordingState, recordingMode, RECORDING_KEY, type RecordingState } from '../shared/recording-storage.js';
import {
  clearRecordingViews,
  countRecordingViews,
  getRecordingViews,
  putRecordingView,
  type StoredStepView,
} from '../shared/step-views.js';
import { captureThroughDebugger } from './cdp-evidence.js';

/**
 * The page as each step of a bug recording began: the recorder asks for a
 * view once the page has settled after a step, or as an action starts when
 * none is left, under an id it makes up, and keeps the id on the step. The
 * worker takes the screenshot, through the recording's debugging session or,
 * without one, `captureVisibleTab` (which works under the `activeTab` grant
 * only), and keeps it as a JPEG the size of the viewport in CSS pixels.
 */

/** The widest a view is kept, in CSS pixels: a wider page is scaled down to it. */
const VIEW_MAX_WIDTH = 1280;
const JPEG_QUALITY = 0.6;
/** An id as the recorder makes them. */
const VIEW_ID = /^[a-z0-9-]{1,40}$/;

function viewportOf(v: unknown): { width: number; height: number } | null {
  const size = v as { width?: unknown; height?: unknown } | null;
  const ok = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0 && (n as number) <= 10_000;
  return size && ok(size.width) && ok(size.height) ? { width: size.width, height: size.height } : null;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** A screenshot as a JPEG as wide as the viewport in CSS pixels, at most {@link VIEW_MAX_WIDTH}. */
async function viewJpeg(dataUrl: string, viewport: { width: number; height: number } | null): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const width = Math.max(1, Math.min(bitmap.width, viewport?.width ?? bitmap.width, VIEW_MAX_WIDTH));
  const height = Math.max(1, Math.round((bitmap.height * width) / bitmap.width));
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  return `data:image/jpeg;base64,${base64(new Uint8Array(await blob.arrayBuffer()))}`;
}

async function captureTab(tab: chrome.tabs.Tab): Promise<string | null> {
  const viaDebugger = await captureThroughDebugger(tab.id!, 'jpeg');
  if (viaDebugger) return viaDebugger;
  if (!tab.active || tab.windowId == null) return null;
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 85 }).catch(() => null);
}

/**
 * Takes the view the recorder asked for in its tab and keeps it, up to the
 * number of step screenshots a report keeps. `captured` is called once the
 * screenshot is taken, before it is encoded and kept, so the recorder shows
 * its own surfaces again as soon as possible.
 */
export async function handleStepView(
  message: { id?: unknown; viewport?: unknown },
  tab: chrome.tabs.Tab | undefined,
  captured: (ok: boolean) => void,
): Promise<void> {
  const id = message.id;
  if (typeof id !== 'string' || !VIEW_ID.test(id) || tab?.id == null) return captured(false);
  const state = await getRecordingState();
  if (!state.active || recordingMode(state) !== 'bug') return captured(false);
  if ((await countRecordingViews().catch(() => Infinity)) >= BUG_EVIDENCE_LIMITS.stepShots) return captured(false);
  const shot = await captureTab(tab);
  captured(!!shot);
  if (!shot) return;
  const viewport = viewportOf(message.viewport);
  try {
    await putRecordingView({ id, dataUrl: await viewJpeg(shot, viewport), takenAt: Date.now(), viewport });
  } catch (err) {
    console.warn('[Piwi Picker] step screenshot not kept:', err);
  }
}

/** The views the recorder kept for these ids, for the report's archive. */
export async function handleGetStepViews(message: { ids?: unknown }): Promise<StoredStepView[]> {
  const ids = Array.isArray(message.ids)
    ? message.ids.filter((id): id is string => typeof id === 'string' && VIEW_ID.test(id))
    : [];
  return getRecordingViews(ids.slice(0, BUG_EVIDENCE_LIMITS.stepShots)).catch(() => []);
}

/** A recording that starts, or one discarded, leaves no view behind. */
export function clearViewsWithRecording(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = area === 'session' ? changes[RECORDING_KEY] : undefined;
    if (!change) return;
    const next = change.newValue as RecordingState | undefined;
    const previous = change.oldValue as RecordingState | undefined;
    if (!next || next.startedAt !== previous?.startedAt) void clearRecordingViews().catch(() => undefined);
  });
}
