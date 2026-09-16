/**
 * Host-side helpers for the DOM-snapshot locator picker: deriving highlight
 * hints, and assembling the hardened iframe document.
 *
 * The snapshot loads into a sandboxed iframe — `sandbox="allow-scripts"` with NO
 * `allow-same-origin`, i.e. an opaque origin — with the picker overlay appended
 * as a `<script>` (see `snapshot-picker-overlay.ts`). The picker can touch only
 * its own document and talks to the host purely over `postMessage`, so a
 * sanitizer bypass in the rendered snapshot can't reach the dashboard's
 * cookies, storage, or API. `<base>` is stripped so the snapshot's relative
 * subresources can't be redirected to the tested app.
 */

import type { RankedLocator } from '#shared/locator-healing.types';
import { installPickerOverlay, probeElementAttrs, type PickerOverlayArg, type ProbeArg } from '@piwitests/picker-dom';
import { installSnapshotPickerExtras } from './snapshot-picker-overlay';

/** Configuration handed to the serialized picker (the only bridge into it). */
export interface SnapshotPickerConfig {
  /** Attribute whitelist to probe — the shared `CAPTURED_ATTRIBUTES`. */
  probedAttrs: string[];
}

/** A text hint the in-iframe picker highlights on open. */
export interface PickerHint {
  text: string;
}

/**
 * Search hints for pre-highlighting the element the failing locator meant to
 * hit: the failing locator's own name/text, then any element-match / ARIA
 * candidate names. Deduped (case-insensitively), trimmed, and capped. Pure so it
 * can be unit-tested; the picker posts the result into the iframe after ready.
 */
export function deriveHighlightHints(input: {
  failingLocator?: { method: string; args: Record<string, unknown> } | null;
  fromElementMatch?: RankedLocator[] | null;
  fromAriaSnapshot?: RankedLocator[] | null;
}): PickerHint[] {
  const out: PickerHint[] = [];
  const seen = new Set<string>();
  const push = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const text = value.trim();
    if (text.length < 2 || text.length > 80) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text });
  };
  const nameOf = (args: Record<string, unknown> | undefined): unknown =>
    args && (args.name ?? args.text ?? args.label ?? args.placeholder ?? args.alt ?? args.title);

  push(nameOf(input.failingLocator?.args));
  for (const a of input.fromElementMatch ?? []) push(nameOf(a.args));
  for (const a of input.fromAriaSnapshot ?? []) push(nameOf(a.args));
  return out.slice(0, 6);
}

/** Escape a serialized function/value so a stray `</script>` in it can't close the tag early. */
const escScriptClose = (src: string): string => src.replace(/<\/(script)/gi, '<\\/$1');

/**
 * The `<script>` tag to append to the snapshot HTML. Three self-contained
 * pieces run in sequence, each re-serialized independently via
 * `Function.prototype.toString()` — a serialized function can carry no
 * imports, so they can't just import one another:
 *
 *  1. `probeElementAttrs` is installed on `globalThis.__piwiProbe` — the
 *     shared core overlay reads it from there when a pick commits, since it
 *     runs standalone in this iframe with no Node process to probe from later
 *     (contrast the reporter's live picker, which probes after the fact from
 *     Node against a live element handle).
 *  2. The snapshot-only chrome (`installSnapshotPickerExtras`) — search,
 *     highlight hints, extended inertness, content-height reporting. Installs
 *     `globalThis.__piwiSnapshotExtras` before the core overlay runs, so its
 *     `onPick`/`onClose` hooks are in place before they're ever needed.
 *  3. The shared core overlay (`installPickerOverlay`), run with
 *     `transport: 'postMessage'`.
 */
export function snapshotPickerScriptTag(config: SnapshotPickerConfig): string {
  const probeArg: ProbeArg = { keep: config.probedAttrs, includeStructural: false, includeLabelText: true };
  const overlayArg: PickerOverlayArg = { transport: 'postMessage', probeArg };
  const probeSrc = escScriptClose(String(probeElementAttrs));
  const extrasSrc = escScriptClose(String(installSnapshotPickerExtras));
  const overlaySrc = escScriptClose(String(installPickerOverlay));
  return (
    `<script>` +
    `globalThis.__piwiProbe = (${probeSrc});` +
    `(${extrasSrc})();` +
    `(${overlaySrc})(${JSON.stringify(overlayArg)});` +
    `</script>`
  );
}

/** Strip `<base>` so the snapshot's relative subresources can't be redirected to the tested app. */
export function stripBaseTag(html: string): string {
  return html.replace(/<base\b[^>]*>/gi, '');
}

/** Build the full blob HTML: the snapshot with `<base>` stripped, plus the appended picker script. */
export function buildPickerDocument(html: string, config: SnapshotPickerConfig): string {
  return stripBaseTag(html) + snapshotPickerScriptTag(config);
}

/**
 * A read-only rendering of the same snapshot: the styled page as the picker
 * shows it, but with no picking overlay. The appended script only makes the
 * document inert (no navigation, no submits, no text selection getting in the
 * reader's way) and reports its content height over `postMessage` so the host
 * can size the sandboxed iframe exactly as the picker does. Runs in the same
 * hardened `sandbox="allow-scripts"` (opaque-origin) frame — the message shape
 * matches the picker's `piwiContentHeight`.
 */
function readonlySnapshotScript(): void {
  const post = (): void => {
    const doc = document.documentElement;
    const height = Math.max(doc.scrollHeight, doc.offsetHeight, document.body?.scrollHeight ?? 0);
    parent.postMessage({ type: 'piwiContentHeight', height }, '*');
  };
  // Neutralize anything that would navigate or mutate away from the snapshot.
  document.addEventListener(
    'click',
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.('a,button,[type=submit]');
      if (anchor) event.preventDefault();
    },
    true,
  );
  document.addEventListener('submit', (event) => event.preventDefault(), true);
  if (document.readyState === 'complete' || document.readyState === 'interactive') post();
  else document.addEventListener('DOMContentLoaded', post);
  addEventListener('load', post);
  try {
    new ResizeObserver(() => post()).observe(document.documentElement);
  } catch {
    /* ResizeObserver may be unavailable — the load handler still reports once. */
  }
}

/** Build the read-only blob HTML: the snapshot with `<base>` stripped, plus the inert-and-measure script. */
export function buildReadonlyDocument(html: string): string {
  const src = escScriptClose(String(readonlySnapshotScript));
  return stripBaseTag(html) + `<script>(${src})();</script>`;
}
