/**
 * Assembly of the hardened DOM-snapshot iframe document, shared by:
 *  - the dashboard (browser) for the demo's `srcdoc` path, and
 *  - the server's `dom-snapshot-frame` endpoint, which serves the same document
 *    over HTTP with `Content-Security-Policy: sandbox allow-scripts` so it can be
 *    loaded via the iframe's `src` (a `srcdoc` frame inherits the desktop page's
 *    strict CSP, which blocks the picker's inline script; a `src`-loaded document
 *    carries its own CSP instead).
 *
 * The snapshot loads into a sandboxed iframe — `sandbox="allow-scripts"` with NO
 * `allow-same-origin`, i.e. an opaque origin — with the picker overlay appended
 * as a `<script>` (see `snapshot-picker-extras.ts`). The picker can touch only
 * its own document and talks to the host purely over `postMessage`, so a
 * sanitizer bypass in the rendered snapshot can't reach the dashboard's
 * cookies, storage, or API. `<base>` is stripped so the snapshot's relative
 * subresources can't be redirected to the tested app.
 *
 * Lives in `shared/` (not `app/utils/`) so both callers above can build the
 * exact same document — the host-only helpers (highlight-hint derivation) stay
 * in `app/utils/snapshot-picker-script.ts`, which re-exports these.
 */
import { installPickerOverlay, probeElementAttrs, type PickerOverlayArg, type ProbeArg } from '@piwitests/picker-dom';
import { installSnapshotPickerExtras, readonlySnapshotScript } from '#shared/snapshot-picker-extras';

/** Configuration handed to the serialized picker (the only bridge into it). */
export interface SnapshotPickerConfig {
  /** Attribute whitelist to probe — the shared `CAPTURED_ATTRIBUTES`. */
  probedAttrs: string[];
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
  // Init runs inside a try/catch and behind error listeners that report any
  // failure to the host over `postMessage` as `piwiError`. Without this, a throw
  // during setup (a serialization slip, a missing browser API) leaves the host
  // stuck on "Initializing picker…" with no clue why; now it shows the error and
  // — in the desktop shell — logs it. A script that is *CSP-blocked* never runs
  // at all, so this can't fire for that case: the host's readiness timeout does.
  return (
    `<script>` +
    `(function(){` +
    `function __piwiReport(e){try{parent.postMessage({type:'piwiError',` +
    `message:String((e&&e.message)||e),stack:(e&&e.stack)?String(e.stack):''},'*');}catch(_){}}` +
    `addEventListener('error',function(e){__piwiReport(e.error||e.message);});` +
    `addEventListener('unhandledrejection',function(e){__piwiReport(e.reason);});` +
    `try{` +
    `globalThis.__piwiProbe = (${probeSrc});` +
    `(${extrasSrc})();` +
    `(${overlaySrc})(${JSON.stringify(overlayArg)});` +
    `}catch(e){__piwiReport(e);}` +
    `})();` +
    `</script>`
  );
}

/** Strip `<base>` so the snapshot's relative subresources can't be redirected to the tested app. */
export function stripBaseTag(html: string): string {
  return html.replace(/<base\b[^>]*>/gi, '');
}

/** Build the full picker document: the snapshot with `<base>` stripped, plus the appended picker script. */
export function buildPickerDocument(html: string, config: SnapshotPickerConfig): string {
  return stripBaseTag(html) + snapshotPickerScriptTag(config);
}

/**
 * Build the read-only document: the snapshot with `<base>` stripped, plus the
 * inert-and-measure script (`readonlySnapshotScript`) — the styled page as the
 * picker shows it, but with no picking overlay, reporting its content height over
 * `postMessage` so the host can size the sandboxed iframe exactly as the picker does.
 */
export function buildReadonlyDocument(html: string): string {
  const src = escScriptClose(String(readonlySnapshotScript));
  return stripBaseTag(html) + `<script>(${src})();</script>`;
}
