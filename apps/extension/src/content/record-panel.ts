import { probeElementAttrs, type ProbeArg } from '@piwitests/picker-dom';
import {
  generateAlternatives,
  approximateAccessibleName,
  resolveAriaRole,
  CAPTURED_ATTRIBUTES,
  TAG_TO_ROLE,
  INPUT_TYPE_TO_ROLE,
} from '@piwitests/core/locator-generation';
import {
  normalizeSteps,
  buildSession,
  type RawCaptureEvent,
  type RecordedTarget,
  type RecordedStep,
} from '@piwitests/core/recording';
import { rankFunctionMatches, type TestFunctionEntry, type RankedFunctionMatch } from '@piwitests/core/function-match';
import { renderSpec } from '@piwitests/core/codegen';
import { classifyInputKind, isPasswordInput } from './record-capture.js';
import {
  getRecordingState,
  appendRecordingEvent,
  stopRecording,
  discardRecording,
  type RecordingState,
} from '../shared/recording-storage.js';
import { getCachedCatalog } from '../shared/catalog-cache.js';
import { requestCatalogRefresh } from '../shared/catalog-refresh.js';
import { ensureSessionAccess } from '../shared/session-access.js';
import { getConnectionSettings } from '../shared/connection-settings.js';
import { getActiveProjectOverride, resolveActiveProject } from '../shared/active-project.js';

const HUD_HOST_ID = 'piwi-record-hud-host';
const PANEL_HOST_ID = 'piwi-record-review-host';
const FRAME_HOST_ID = 'piwi-record-frame-host';

const ROLE_SOURCES = [...new Set(['[role]', 'input', 'select', ...Object.keys(TAG_TO_ROLE)])].join(',');
const PROBE_ARG: ProbeArg = {
  keep: [...CAPTURED_ATTRIBUTES],
  tagRoles: TAG_TO_ROLE,
  inputRoles: INPUT_TYPE_TO_ROLE,
  roleSources: ROLE_SOURCES,
  includeStructural: true,
};

/** The DOM shapes a click/action can reasonably land on — a click deeper inside one of these snaps up to it, same intent as the picker overlay's own snapping (not the identical algorithm — see AGENTS.md note in this file's own doc comment below). */
const ACTIONABLE_SELECTOR =
  'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [contenteditable="true"], [data-testid]';

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * A stable identity for an element, for as long as this document lives.
 *
 * `normalizeSteps` needs to know whether two consecutive `input` events came
 * from the same field, and two unlabelled `<input>`s are indistinguishable by
 * everything else a `RecordedTarget` carries — same tag, same role, no name, no
 * test id, and no locator alternative either. The prefix keeps keys from two
 * pages of one recording from ever colliding.
 */
const elementKeys = new WeakMap<Element, string>();
const KEY_PREFIX = Math.random().toString(36).slice(2, 8);
let nextElementKey = 0;

function elementKeyFor(el: Element): string {
  let key = elementKeys.get(el);
  if (key == null) {
    key = `${KEY_PREFIX}-${++nextElementKey}`;
    elementKeys.set(el, key);
  }
  return key;
}

/**
 * Element → `RecordedTarget`, mirroring `top-locator.ts`'s probe pipeline but
 * keeping the top few ranked alternatives (not just the winner) and the
 * role/testId/text a catalog pattern match needs. Lives here rather than a
 * separate pure file because it calls `generateAlternatives`, which per
 * `extension/AGENTS.md`'s two-strategy rule can only be tested by driving
 * the real built bundle — same reasoning as `agent-context.ts`.
 */
function deriveRecordedTarget(el: Element): RecordedTarget {
  const attrs = probeElementAttrs(el, PROBE_ARG);
  const accessibleName = approximateAccessibleName({ ...attrs, accessibleName: null });
  const role = resolveAriaRole({ ...attrs, accessibleName });
  const ranked = generateAlternatives({ ...attrs, accessibleName });
  return {
    tagName: attrs.tagName,
    role,
    accessibleName,
    testId: attrs.attributes['data-testid'] ?? null,
    text: el.textContent ? normalizeText(el.textContent).slice(0, 200) : null,
    alternatives: ranked.slice(0, 5).map((r) => ({ locator: r.locator, method: r.method, score: r.score })),
    elementKey: elementKeyFor(el),
  };
}

/**
 * `deriveRecordedTarget` for a field mid-burst, computed once per element.
 *
 * The probe behind it walks the document to count same-role and same-text
 * elements and to score anchor ancestors — cheap once per click, but it used to
 * run on *every* `input` event, so a probe of the whole page sat between one
 * keystroke and the next. Coalescing already discards all but the last value of
 * a burst, and `normalizeSteps` keeps the target from the burst's first event,
 * so re-deriving it per keystroke changed nothing it produced.
 */
const fieldTargets = new WeakMap<Element, RecordedTarget>();

function fieldTarget(el: Element): RecordedTarget {
  let derived = fieldTargets.get(el);
  if (derived == null) {
    derived = deriveRecordedTarget(el);
    fieldTargets.set(el, derived);
  }
  return derived;
}

function nearestActionable(el: Element): Element {
  return el.closest(ACTIONABLE_SELECTOR) ?? el;
}

function withinOwnUi(e: Event): boolean {
  const path = e.composedPath();
  return path.some(
    (n) => n instanceof HTMLElement && (n.id === HUD_HOST_ID || n.id === PANEL_HOST_ID || n.id === FRAME_HOST_ID),
  );
}

/**
 * A border drawn around the viewport for as long as the recording runs, so
 * it's obvious at a glance that this tab is being captured — the HUD alone
 * is easy to overlook, and easy to mistake for a leftover from a previous
 * session.
 *
 * Its own host rather than part of the HUD: `renderHud` tears its host down
 * and rebuilds it on *every* captured step, which would make a border flicker
 * constantly. `pointer-events: none` throughout so it never intercepts a
 * click the recorder is supposed to be capturing.
 */
function ensureRecordingFrame(): void {
  if (document.getElementById(FRAME_HOST_ID)) return;
  const host = document.createElement('div');
  host.id = FRAME_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    .frame {
      position: fixed; inset: 0; pointer-events: none;
      border: 3px solid rgba(239,68,68,.9);
      box-shadow: inset 0 0 0 1px rgba(239,68,68,.35), inset 0 0 18px rgba(239,68,68,.18);
      animation: breathe 2.6s ease-in-out infinite;
    }
    @keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
    @media (prefers-reduced-motion: reduce) { .frame { animation: none; } }
  `;
  const frame = document.createElement('div');
  frame.className = 'frame';
  root.append(style, frame);
}

function removeRecordingFrame(): void {
  document.getElementById(FRAME_HOST_ID)?.remove();
}

async function copyToClipboard(text: string, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  const original = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
}

const SHARED_STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
`;

function renderHud(state: RecordingState, catalog: TestFunctionEntry[]): void {
  document.getElementById(HUD_HOST_ID)?.remove();
  document.getElementById(PANEL_HOST_ID)?.remove();
  ensureRecordingFrame();

  const host = document.createElement('div');
  host.id = HUD_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:auto 16px 16px auto;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    ${SHARED_STYLE}
    .bar {
      display: flex; flex-direction: column; gap: 8px; background: #111827; color: #f9fafb;
      border-radius: 12px; padding: 10px 12px; box-shadow: 0 8px 30px rgba(0,0,0,.4);
      font-size: 12.5px; min-width: 260px; max-width: 340px;
    }
    @media (prefers-color-scheme: light) {
      .bar { background: #ffffff; color: #111827; box-shadow: 0 8px 30px rgba(0,0,0,.2); border: 1px solid #e5e7eb; }
    }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; flex-shrink: 0; animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
    .title { font-weight: 600; flex: 1; }
    button { border-radius: 6px; padding: 4px 9px; font: inherit; font-size: 11.5px; cursor: pointer;
      border: 1px solid rgba(128,128,128,.3); background: rgba(128,128,128,.12); color: inherit; }
    button:hover, button:focus-visible { background: rgba(128,128,128,.25); }
    button.stop { background: #dc2626; border-color: #dc2626; color: #fff; }
    .section-title { color: #9ca3af; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; margin-top: 2px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; word-break: break-all; display: block; }
    .match { display: flex; align-items: center; gap: 6px; padding: 3px 0; }
    .match-name { font-family: ui-monospace, monospace; font-size: 11px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .match-bar { width: 34px; height: 4px; border-radius: 2px; background: rgba(128,128,128,.25); overflow: hidden; flex-shrink: 0; }
    .match-bar-fill { height: 100%; background: #7c3aed; }
    .match-badge { font-size: 9.5px; padding: 1px 4px; border-radius: 4px; flex-shrink: 0; }
    .match-badge.complete { background: rgba(34,197,94,.2); color: #22c55e; }
    .match-badge.partial { color: #9ca3af; }
    .empty { color: #9ca3af; font-size: 11px; }
    .warn { color: #fca5a5; font-size: 11px; line-height: 1.35; }
    @media (prefers-color-scheme: light) { .warn { color: #b91c1c; } }
  `;
  root.appendChild(style);

  const steps = normalizeSteps(state.events);
  const matches = catalog.length > 0 ? rankFunctionMatches(steps, catalog).slice(0, 3) : [];
  const lastTarget = [...state.events].reverse().find((e) => e.target)?.target ?? null;

  const bar = document.createElement('div');
  bar.className = 'bar';

  const topRow = document.createElement('div');
  topRow.className = 'row';
  const dot = document.createElement('div');
  dot.className = 'dot';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = `Recording — ${steps.length} step${steps.length === 1 ? '' : 's'}`;
  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.className = 'stop';
  stopBtn.textContent = 'Stop';
  stopBtn.addEventListener('click', () => void handleStop());
  topRow.append(dot, title, stopBtn);
  bar.appendChild(topRow);

  if (captureError) {
    const warn = document.createElement('div');
    warn.className = 'warn';
    warn.setAttribute('role', 'alert');
    warn.textContent = captureError;
    bar.appendChild(warn);
  }

  if (lastTarget?.alternatives[0]) {
    const locTitle = document.createElement('div');
    locTitle.className = 'section-title';
    locTitle.textContent = 'Last locator';
    const code = document.createElement('code');
    code.textContent = lastTarget.alternatives[0].locator;
    bar.append(locTitle, code);
  }

  if (catalog.length > 0) {
    const matchTitle = document.createElement('div');
    matchTitle.className = 'section-title';
    matchTitle.textContent = 'Matching functions';
    bar.appendChild(matchTitle);
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No catalog match yet';
      bar.appendChild(empty);
    } else {
      for (const m of matches) bar.appendChild(renderMatchRow(m));
    }
  }

  root.appendChild(bar);
}

function renderMatchRow(m: RankedFunctionMatch): HTMLElement {
  const row = document.createElement('div');
  row.className = 'match';
  const name = document.createElement('div');
  name.className = 'match-name';
  name.textContent = m.entry.name;
  const barWrap = document.createElement('div');
  barWrap.className = 'match-bar';
  const fill = document.createElement('div');
  fill.className = 'match-bar-fill';
  fill.style.width = `${Math.round(m.score * 100)}%`;
  barWrap.appendChild(fill);
  const badge = document.createElement('span');
  badge.className = `match-badge ${m.complete ? 'complete' : 'partial'}`;
  badge.textContent = m.complete ? 'ready' : `${m.matchedIndices.length}/${m.entry.steps.length}`;
  row.append(name, barWrap, badge);
  return row;
}

function describeStep(step: RecordedStep): string {
  const target = step.target;
  const label = target?.testId
    ? `testId=${target.testId}`
    : (target?.accessibleName ?? target?.text ?? target?.tagName ?? '');
  const value = step.redacted ? '••••••' : step.value;
  return `${step.action}${label ? ` — ${label}` : ''}${value ? ` = "${value}"` : ''}`;
}

async function renderReviewPanel(events: RawCaptureEvent[]): Promise<void> {
  document.getElementById(HUD_HOST_ID)?.remove();
  document.getElementById(PANEL_HOST_ID)?.remove();
  // Recording is over by the time the review panel opens — drop the border
  // before anything else, so it never outlives the capture it signals.
  removeRecordingFrame();

  const steps = normalizeSteps(events);
  const session = buildSession(steps, events[0]?.timestamp ?? Date.now());
  const [connection, override] = await Promise.all([getConnectionSettings(), getActiveProjectOverride()]);
  const activeProject = resolveActiveProject(connection, override, location.href);
  // Worth waiting for here, unlike in the live HUD: this is the one-shot that
  // feeds "Copy as TypeScript", and generating a spec against a catalog that
  // predates a function added mid-session would silently emit raw locators
  // where a call belonged.
  await requestCatalogRefresh(activeProject?.projectId ?? null);
  const catalog = await getCachedCatalog(activeProject?.projectId ?? null);
  const withCatalog = renderSpec(session, { catalog });
  const raw = renderSpec(session);

  const host = document.createElement('div');
  host.id = PANEL_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    ${SHARED_STYLE}
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: flex-start; justify-content: center; padding-top: 6vh; }
    .panel { background: #111827; color: #f9fafb; border-radius: 12px; padding: 16px; width: min(680px, 92vw); max-height: 84vh;
      overflow: auto; box-shadow: 0 8px 40px rgba(0,0,0,.5); font-size: 13px; line-height: 1.5; }
    @media (prefers-color-scheme: light) { .panel { background: #ffffff; color: #111827; box-shadow: 0 8px 40px rgba(0,0,0,.2); } }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .title { font-weight: 600; font-size: 14px; }
    .sub { color: #9ca3af; font-size: 12px; }
    .close { background: none; border: none; color: inherit; opacity: .7; cursor: pointer; font-size: 18px; line-height: 1; padding: 4px 8px; border-radius: 6px; }
    .close:hover, .close:focus-visible { opacity: 1; background: rgba(128,128,128,.15); }
    .steps { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; max-height: 240px; overflow: auto; margin-bottom: 12px; }
    .step { padding: 6px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px;
      border-bottom: 1px solid rgba(128,128,128,.15); display: flex; gap: 8px; align-items: center; }
    .step:last-child { border-bottom: none; }
    .step-idx { color: #9ca3af; flex-shrink: 0; width: 20px; }
    .step-fn { margin-left: auto; font-size: 10px; padding: 1px 5px; border-radius: 4px; background: rgba(124,58,237,.2); color: #a78bfa; flex-shrink: 0; }
    .actions { display: flex; gap: 6px; flex-wrap: wrap; }
    button.action { background: rgba(128,128,128,.12); color: inherit; border: 1px solid rgba(128,128,128,.3);
      border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
    button.action:hover, button.action:focus-visible { background: rgba(128,128,128,.25); }
    button.action.primary { background: #7c3aed; border-color: #7c3aed; color: #fff; }
    button.action.danger:hover, button.action.danger:focus-visible { background: rgba(248,113,113,.2); border-color: #f87171; }
    .empty { color: #9ca3af; font-size: 12.5px; padding: 16px; text-align: center; }
  `;
  root.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Piwi recording review');
  panel.tabIndex = -1;

  const header = document.createElement('div');
  header.className = 'header';
  const titleWrap = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent =
    steps.length === 0 ? 'Nothing recorded' : `${steps.length} recorded step${steps.length === 1 ? '' : 's'}`;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent =
    withCatalog.matchedSpans.length > 0
      ? `${withCatalog.matchedSpans.length} step${withCatalog.matchedSpans.length === 1 ? '' : 's'} matched to your function catalog`
      : catalog.length > 0
        ? 'No catalog matches — exported as raw locators'
        : 'Not connected to a Piwi instance — exported as raw locators';
  titleWrap.append(title, sub);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.textContent = '×';
  // Every close path goes through one function, so the document-level Escape
  // listener below is always detached with the panel. Registering it and only
  // removing it on Escape itself meant closing any other way (the ×, the
  // backdrop, Discard) left it attached to the page for good, and each reopen
  // stacked another.
  const closeController = new AbortController();
  const closePanel = (): void => {
    closeController.abort();
    host.remove();
  };
  closeBtn.addEventListener('click', closePanel);
  header.append(titleWrap, closeBtn);
  panel.appendChild(header);

  if (steps.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No steps were captured.';
    panel.appendChild(empty);
  } else {
    const stepsWrap = document.createElement('div');
    stepsWrap.className = 'steps';
    steps.forEach((step, i) => {
      const row = document.createElement('div');
      row.className = 'step';
      const idx = document.createElement('span');
      idx.className = 'step-idx';
      idx.textContent = String(i + 1);
      const desc = document.createElement('span');
      desc.textContent = describeStep(step);
      row.append(idx, desc);
      const span = withCatalog.matchedSpans.find((s) => i >= s.startStep && i <= s.endStep);
      if (span) {
        const fnBadge = document.createElement('span');
        fnBadge.className = 'step-fn';
        fnBadge.textContent = span.functionName;
        row.appendChild(fnBadge);
      }
      stepsWrap.appendChild(row);
    });
    panel.appendChild(stepsWrap);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';

  if (steps.length > 0) {
    const copyPrimary = document.createElement('button');
    copyPrimary.type = 'button';
    copyPrimary.className = 'action primary';
    copyPrimary.textContent = catalog.length > 0 ? 'Copy as TypeScript (with your functions)' : 'Copy as TypeScript';
    copyPrimary.addEventListener('click', () => void copyToClipboard(withCatalog.code, copyPrimary));
    actions.appendChild(copyPrimary);

    if (catalog.length > 0 && withCatalog.matchedSpans.length > 0) {
      const copyRaw = document.createElement('button');
      copyRaw.type = 'button';
      copyRaw.className = 'action';
      copyRaw.textContent = 'Copy raw TypeScript';
      copyRaw.addEventListener('click', () => void copyToClipboard(raw.code, copyRaw));
      actions.appendChild(copyRaw);
    }
  }

  const discardBtn = document.createElement('button');
  discardBtn.type = 'button';
  discardBtn.className = 'action danger';
  discardBtn.textContent = 'Discard';
  discardBtn.addEventListener('click', () => {
    void discardRecording().then(closePanel, closePanel);
  });
  actions.appendChild(discardBtn);
  panel.appendChild(actions);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closePanel();
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') closePanel();
    },
    { capture: true, signal: closeController.signal },
  );

  backdrop.appendChild(panel);
  root.appendChild(backdrop);
  panel.focus();
}

async function handleStop(): Promise<void> {
  const state = await stopRecording();
  stopCapture();
  try {
    chrome.runtime.sendMessage({ type: 'piwi-recording-stopped' });
  } catch {
    // Extension context can be gone (e.g. reloaded mid-recording) — the storage write above already stuck.
  }
  await renderReviewPanel(state.events);
}

function buildEvent(
  kind: RawCaptureEvent['kind'],
  el: Element | null,
  extra: Partial<RawCaptureEvent> = {},
): RawCaptureEvent {
  return {
    kind,
    value: null,
    checked: null,
    inputType: null,
    isPasswordField: false,
    pageUrl: location.href,
    timestamp: Date.now(),
    ...extra,
    // Resolved last, and only derived when the caller has not supplied one —
    // deriving first and letting `extra` overwrite it would still pay for the
    // probe the caller passed a cached target precisely to avoid.
    target: extra.target !== undefined ? extra.target : el ? deriveRecordedTarget(el) : null,
  };
}

async function refreshHud(): Promise<void> {
  const [state, connection, override] = await Promise.all([
    getRecordingState(),
    getConnectionSettings(),
    getActiveProjectOverride(),
  ]);
  if (!state.active) return;
  const activeProject = resolveActiveProject(connection, override, location.href);
  const catalog = await getCachedCatalog(activeProject?.projectId ?? null);
  renderHud(state, catalog);
}

/**
 * Records one captured event and refreshes the HUD, at most one redraw per
 * `HUD_REFRESH_MS` with the last one always landing.
 *
 * The HUD re-runs `rankFunctionMatches` over the whole catalog and rebuilds its
 * host from scratch, which is fine per click and wasteful per keystroke. It is
 * pure presentation, so throttling it cannot reorder or drop a step — the
 * `appendRecordingEvent` call it follows is what actually records, and that one
 * is never skipped.
 */
const HUD_REFRESH_MS = 120;
let hudRefreshAt = 0;
let hudRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleHudRefresh(): void {
  if (hudRefreshTimer != null) return;
  const wait = Math.max(0, hudRefreshAt + HUD_REFRESH_MS - Date.now());
  hudRefreshTimer = setTimeout(() => {
    hudRefreshTimer = null;
    hudRefreshAt = Date.now();
    void refreshHud();
  }, wait);
}

/**
 * The last capture write that failed, surfaced in the HUD.
 *
 * A rejected write used to be an unhandled rejection: session storage filling
 * up mid-recording looked exactly like a recording that was still going fine,
 * and the steps after it were simply absent from the export.
 */
let captureError: string | null = null;

function captureEvent(event: RawCaptureEvent): void {
  void appendRecordingEvent(event)
    .then(() => {
      captureError = null;
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : '';
      captureError = /quota|exceeded/i.test(message)
        ? 'Out of storage — stop and export now, later steps are being lost.'
        : 'A step could not be saved.';
    })
    .then(() => scheduleHudRefresh());
}

/** One TTL-guarded catalog re-fetch for whichever project this page maps to — called once per page load, never from `refreshHud`. */
async function refreshCatalogForThisPage(): Promise<void> {
  const [connection, override] = await Promise.all([getConnectionSettings(), getActiveProjectOverride()]);
  const activeProject = resolveActiveProject(connection, override, location.href);
  await requestCatalogRefresh(activeProject?.projectId ?? null);
}

interface RecorderGlobals {
  /** Aborting this detaches every capture listener at once — see `stopCapture`. */
  __piwiRecordCapture?: AbortController;
  /** Serializes concurrent injections of this script into one document. */
  __piwiRecordPanelRun?: Promise<void>;
  /** Whether this document's `chrome.runtime` stop listener is already registered. */
  __piwiRecordStopListener?: boolean;
}

function recorderGlobals(): RecorderGlobals {
  return globalThis as RecorderGlobals;
}

/**
 * Ends capture on this page: detaches the listeners, drops the HUD, and drops
 * the border that says the tab is being recorded.
 *
 * Idempotent, and safe when nothing was ever attached — it runs both from the
 * HUD's own Stop button and from a stop initiated elsewhere (the popup, or
 * another tab), which reaches this document as a `piwi-recording-stopped`
 * message from the service worker.
 */
function stopCapture(): void {
  const g = recorderGlobals();
  g.__piwiRecordCapture?.abort();
  g.__piwiRecordCapture = undefined;
  document.getElementById(HUD_HOST_ID)?.remove();
  removeRecordingFrame();
}

function attachListeners(): void {
  const g = recorderGlobals();
  g.__piwiRecordCapture?.abort();
  const controller = new AbortController();
  g.__piwiRecordCapture = controller;
  // Capture phase throughout, so a page that stops propagation on its own
  // handlers can't hide an interaction from the recorder; `signal` is what
  // makes the whole set removable in one go from `stopCapture`.
  const opts = { capture: true, signal: controller.signal };

  document.addEventListener(
    'click',
    (e) => {
      if (withinOwnUi(e)) return;
      const raw = e.target;
      if (!(raw instanceof Element)) return;
      const el = nearestActionable(raw);
      const kind = classifyInputKind(el.tagName, (el as HTMLInputElement).type ?? null);
      if (kind === 'checkbox' || kind === 'radio') return; // the resulting `change` event records this one
      captureEvent(buildEvent('click', el));
    },
    opts,
  );

  document.addEventListener(
    'input',
    (e) => {
      if (withinOwnUi(e)) return;
      const el = e.target;
      if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
      const typeAttr = el instanceof HTMLInputElement ? el.type : null;
      const passwordField = isPasswordInput(el.tagName, typeAttr);
      // The raw value never enters the event at all for a password field —
      // redacting later in normalizeSteps would still mean the plaintext sat
      // in chrome.storage.session in the meantime.
      captureEvent(
        buildEvent('input', el, {
          // Cached per field: the probe behind a target is a document-wide walk,
          // and one per keystroke is what made typing lag on a large page.
          target: fieldTarget(el),
          value: passwordField ? null : el.value,
          isPasswordField: passwordField,
        }),
      );
    },
    opts,
  );

  document.addEventListener(
    'change',
    (e) => {
      if (withinOwnUi(e)) return;
      const el = e.target;
      if (!(el instanceof Element)) return;
      const typeAttr = el instanceof HTMLInputElement ? el.type : null;
      const kind = classifyInputKind(el.tagName, typeAttr);
      if (kind === 'checkbox' || kind === 'radio') {
        captureEvent(buildEvent('change', el, { inputType: kind, checked: (el as HTMLInputElement).checked }));
      } else if (kind === 'select') {
        captureEvent(buildEvent('change', el, { inputType: 'select', value: (el as HTMLSelectElement).value }));
      }
    },
    opts,
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (withinOwnUi(e)) return;
      if (e.key !== 'Enter') return;
      const el = e.target instanceof Element ? e.target : null;
      captureEvent(buildEvent('keydown', el, { value: 'Enter' }));
    },
    opts,
  );
}

/**
 * Listens for a stop that came from somewhere other than this page's own HUD —
 * the popup's Stop button, or the HUD in a different tab of the same recording.
 * The service worker fans the stop out with `chrome.tabs.sendMessage`, which is
 * the only thing that reaches a content script: `chrome.runtime.sendMessage`
 * goes to extension pages and the worker, never here, so a stop from the popup
 * used to leave this page's HUD and border standing indefinitely.
 *
 * Registered once per document — repeated starts on the same page must not
 * stack handlers.
 */
function installStopListener(): void {
  const g = recorderGlobals();
  if (g.__piwiRecordStopListener) return;
  g.__piwiRecordStopListener = true;
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'piwi-recording-stopped') stopCapture();
  });
}

/**
 * The recorder's entry point — injected once for the very first page of a
 * recording (via `chrome.scripting.executeScript` from the popup) and once
 * per navigation after that (via a dynamic content-script registration
 * scoped to the granted origin, see `background/index.ts`). Renders the
 * always-on HUD while recording, or the review/export panel once stopped but
 * not yet discarded — the same module handles both so a stray injection on
 * an already-stopped recording still shows something useful instead of
 * nothing.
 */
async function runRecordPanel(): Promise<void> {
  const g = recorderGlobals();
  // Chained rather than latched: this script is injected both by the dynamic
  // registration (on every navigation) and one-off from the popup, and the two
  // can land together. A plain boolean guard would let both pass the
  // "already capturing?" check below before either had attached — and, worse,
  // a guard that stayed latched after a stop made the review panel
  // unreachable, since a re-injection returned before rendering anything.
  // Errors are swallowed into the chain so one bad run never blocks the next:
  // the usual cause is the worker not having widened session-storage access
  // yet, which is transient.
  g.__piwiRecordPanelRun = (g.__piwiRecordPanelRun ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => initRecordPanel())
    .catch((err: unknown) => {
      console.warn('[Piwi Picker] recorder failed to start on this page:', err);
    });
  await g.__piwiRecordPanelRun;
}

async function initRecordPanel(): Promise<void> {
  // Before any session-storage read — see `session-access.ts`.
  await ensureSessionAccess();
  const state = await getRecordingState();

  if (!state.active) {
    // The recording is over, however it ended. Tear the capture surfaces down
    // first — a border that outlives the capture it signals is worse than no
    // border at all — then show whatever is left to review.
    stopCapture();
    if (state.events.length > 0) await renderReviewPanel(state.events);
    return;
  }

  if (recorderGlobals().__piwiRecordCapture) {
    // Already capturing in this document; a second injection only refreshes.
    await refreshHud();
    return;
  }

  // Seed this page's own URL so a mid-recording navigation's `RecordedStep`s
  // carry the right `pageUrl`; only the very first one across the whole
  // recording survives into a `page.goto()` — see `normalizeSteps`.
  await appendRecordingEvent(buildEvent('navigate', null, { value: location.href }));
  attachListeners();
  installStopListener();
  // Once per page, not per step — `refreshHud` runs on every captured
  // interaction and must stay local-only. TTL-guarded, so a recording that
  // crosses many pages still only re-fetches occasionally.
  void refreshCatalogForThisPage().then(() => void refreshHud());
  await refreshHud();
}

void runRecordPanel();
