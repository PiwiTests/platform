import { describeStepInWords } from '@piwitests/core/bug-report';
import { interfacePhrases } from '../shared/core-words.js';
import { pageKey } from '@piwitests/core/page-key';
import { buildSession, normalizeSteps, type RecordedStep } from '@piwitests/core/recording';
import { sessionFromSteps, toStepsDocument, type PiwiSteps } from '@piwitests/core/steps';
import { formatNumber, initI18n, t, tn, uiLanguage } from '../shared/i18n.js';
import { getRecordingState, recordingMode } from '../shared/recording-storage.js';
import {
  getReplayState,
  setReplayState,
  updateReplayState,
  type ReplayState,
  type ReplayStepResult,
} from '../shared/replay-storage.js';
import { ensureSessionAccess } from '../shared/session-access.js';
import { REPLAY_DIALOG_HOST_ID, REPLAY_HUD_HOST_ID, SHARED_STYLE } from './record-ui.js';
import { createWaker, evaluateAssertion, replayVerdict, verdictText, type ReplayVerdict } from './replay-core.js';
import { createCursor, type FakeCursor } from './replay-cursor.js';
import {
  ACTION_TIMEOUT_MS,
  ASSERT_TIMEOUT_MS,
  findAll,
  locatorFor,
  observe,
  performCheck,
  performClick,
  performFill,
  performPress,
  performSelect,
  resolveForAction,
  waitForPageReady,
  waitForStepReady,
} from './replay-actions.js';
import { readStepsFile } from './steps-file.js';

/**
 * Replay: plays a bug report's steps (or any steps file) in this tab, on this
 * tab's origin, with a fake cursor showing each action, and says whether the
 * bug shows here.
 *
 * The background script registers this script for the origin while a replay
 * runs, so every page the replay reaches loads it again; the replay's state in
 * session storage says which step comes next. Opened from the popup with no
 * replay running, it asks for the report to play.
 */

interface ReplayGlobals {
  __piwiReplayEntry?: () => Promise<void>;
  /** The last verdict in this page, for the e2e suite. */
  __piwiReplayVerdict?: ReplayVerdict;
}

const STYLE = `
  ${SHARED_STYLE}
  .box { background: #111827; color: #f9fafb; color-scheme: dark; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.4);
    font-size: 12.5px; line-height: 1.45; overflow-wrap: anywhere; hyphens: auto; }
  @media (prefers-color-scheme: light) {
    .box { background: #ffffff; color: #111827; color-scheme: light; box-shadow: 0 8px 30px rgba(0,0,0,.2); border: 1px solid #e5e7eb; }
  }
  .title { font-weight: 600; font-size: 13px; }
  .sub { color: #9ca3af; font-size: 11.5px; }
  .steps { display: flex; flex-direction: column; gap: 1px; max-height: 220px; overflow: auto; margin: 8px 0; font-size: 11.5px; }
  .step { display: flex; gap: 6px; padding: 2px 4px; border-radius: 4px; }
  .step.current { background: rgba(124,58,237,.18); }
  .icon { width: 14px; flex-shrink: 0; text-align: center; }
  .done .icon, .passed .icon { color: #34d399; }
  .failed .icon, .diverged .icon { color: #f87171; }
  .pending { opacity: .6; }
  .detail { color: #fca5a5; font-size: 11px; padding-left: 20px; }
  .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  button { border-radius: 6px; padding: 4px 9px; font: inherit; font-size: 11.5px; cursor: pointer;
    border: 1px solid rgba(128,128,128,.3); background: rgba(128,128,128,.12); color: inherit; }
  button:hover, button:focus-visible { background: rgba(128,128,128,.25); }
  button.primary { background: #7c3aed; border-color: #7c3aed; color: #fff; }
  button.stop { margin-left: auto; }
  label.check { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; }
  .verdict { border-radius: 8px; padding: 8px 10px; margin-top: 8px; }
  .verdict.reproduced { background: rgba(239,68,68,.16); }
  .verdict.not-reproduced { background: rgba(16,185,129,.16); }
  .verdict.diverged, .verdict.stopped { background: rgba(245,158,11,.16); }
  .verdict.completed { background: rgba(128,128,128,.14); }
  .verdict .title { margin-bottom: 2px; }
  .message { color: #fca5a5; font-size: 12px; margin-top: 6px; }
  .message:empty { display: none; }
  input[type=file] { font: inherit; font-size: 12px; margin: 8px 0; color: inherit; }
  @media (prefers-color-scheme: light) {
    .sub { color: #6b7280; }
    .detail, .message { color: #b91c1c; }
    .done .icon, .passed .icon { color: #059669; }
    .failed .icon, .diverged .icon { color: #dc2626; }
  }
`;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A step in plain words, without the Markdown code marks the report uses. */
function stepWords(step: RecordedStep): string {
  return describeStepInWords(step, interfacePhrases()).replace(/`+/g, '');
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * Whether the page is the one a step happened on, by page key (ids and tokens
 * aside). A replay started on the tab's own page takes that page for the first
 * recorded one, whatever their addresses.
 */
function onPageOf(url: string, startPage: ReplayState['startPage']): boolean {
  const here = pageKey(location.href);
  const there = pageKey(url);
  if (startPage && there === pageKey(startPage.recorded) && here === pageKey(startPage.actual)) return true;
  return here === null || there === null || here === there;
}

async function waitForPage(url: string, timeout: number, startPage: ReplayState['startPage']): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (!onPageOf(url, startPage)) {
    if (Date.now() >= deadline) return false;
    await wait(100);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Talking to the background script

/** Starts a replay; `startOn` is the page it starts on instead of opening the first recorded one. */
async function startReplay(
  steps: PiwiSteps,
  stepMode: boolean,
  startOn: string | null,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'piwi-start-replay',
      steps,
      origin: location.origin,
      stepMode,
      inject: false,
      startOn,
    })) as { ok: boolean; error?: string } | undefined;
    return response ?? { ok: false, error: t('common_workerNoAnswer') };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function notifyFinished(): void {
  try {
    void chrome.runtime.sendMessage({ type: 'piwi-replay-finished' }).catch(() => undefined);
  } catch {
    // The extension was reloaded; the replay has ended either way.
  }
}

// ---------------------------------------------------------------------------
// The panel

let cursor: FakeCursor | null = null;
let loopActive = false;
/** Resolves the wait for Next in step mode, or for Continue after a pause. */

const waker = createWaker();

function waitForRelease(): Promise<void> {
  return waker.wait();
}

function wakeLoop(): void {
  waker.wake();
}

function glyph(result: ReplayStepResult | undefined, current: boolean): string {
  if (current) return '▸';
  switch (result?.status) {
    case 'done':
    case 'passed':
      return '✓';
    case 'failed':
      return '✗';
    case 'diverged':
      return '!';
    default:
      return '·';
  }
}

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (className) b.className = className;
  b.addEventListener('click', onClick);
  return b;
}

/** The replay's panel, drawn again on every change: steps, controls, and the verdict once done. */
let hud: { host: HTMLElement; root: ShadowRoot } | null = null;

function hudRoot(): ShadowRoot {
  if (hud && hud.host.isConnected) {
    hud.root.replaceChildren();
    return hud.root;
  }
  document.getElementById(REPLAY_HUD_HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = REPLAY_HUD_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:auto 16px 16px auto;z-index:2147483647;';
  document.documentElement.appendChild(host);
  hud = { host, root: host.attachShadow({ mode: 'closed', delegatesFocus: true }) };
  return hud.root;
}

function renderHud(state: ReplayState, verdict: ReplayVerdict | null = null): void {
  const root = hudRoot();
  const style = document.createElement('style');
  style.textContent = STYLE;
  const box = document.createElement('div');
  box.className = 'box';
  box.style.cssText = 'padding:10px 12px;width:380px;max-width:calc(100vw - 32px);';
  box.setAttribute('role', 'region');
  box.lang = uiLanguage();
  box.setAttribute('aria-label', t('replay_hudLabel'));

  const steps = sessionFromSteps(state.steps, state.origin).steps;
  const done = state.status === 'done' || state.status === 'stopped';
  const title = document.createElement('div');
  title.className = 'title';
  const status = t(
    done ? 'replay_statusDone' : state.status === 'paused' ? 'replay_statusPaused' : 'replay_statusRunning',
  );
  title.textContent = state.steps.title ? t('replay_statusWithTitle', { status, title: state.steps.title }) : status;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = done
    ? tn('replay_progressDone', steps.length, { origin: state.origin })
    : t('replay_progress', {
        origin: state.origin,
        step: formatNumber(Math.min(state.position + 1, steps.length)),
        total: formatNumber(steps.length),
      });
  box.append(title, sub);

  const list = document.createElement('div');
  list.className = 'steps';
  steps.forEach((step, i) => {
    const result = state.results[i];
    const current = !done && i === state.position;
    const row = document.createElement('div');
    row.className = `step ${current ? 'current' : (result?.status ?? 'pending')}`;
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = glyph(result, current);
    const text = document.createElement('span');
    text.textContent = `${formatNumber(i + 1)}. ${stepWords(step)}`;
    row.append(icon, text);
    list.appendChild(row);
    if (result?.detail && (result.status === 'failed' || result.status === 'diverged')) {
      const detail = document.createElement('div');
      detail.className = 'detail';
      detail.textContent = result.detail;
      list.appendChild(detail);
    }
  });
  box.appendChild(list);

  const controls = document.createElement('div');
  controls.className = 'row';
  if (!done) {
    const paused = state.status === 'paused';
    controls.appendChild(
      button(paused ? t('replay_continue') : t('replay_pause'), () => {
        void updateReplayState((s) => ({ ...s, status: paused ? 'running' : 'paused' })).then((s) => {
          if (s) renderHud(s);
          wakeLoop();
        });
      }),
    );
    if (state.stepMode) controls.appendChild(button(t('replay_nextStep'), wakeLoop, 'primary'));
    const stepLabel = document.createElement('label');
    stepLabel.className = 'check';
    const stepBox = document.createElement('input');
    stepBox.type = 'checkbox';
    stepBox.checked = state.stepMode;
    stepBox.addEventListener('change', () => {
      void updateReplayState((s) => ({ ...s, stepMode: stepBox.checked })).then((s) => {
        if (s) renderHud(s);
        if (!stepBox.checked) wakeLoop();
      });
    });
    stepLabel.append(stepBox, t('replay_stepByStep'));
    controls.appendChild(stepLabel);
    controls.appendChild(
      button(
        t('common_stop'),
        () => {
          void updateReplayState((s) => ({ ...s, status: 'stopped' })).then(() => wakeLoop());
        },
        'stop',
      ),
    );
  } else {
    if (verdict) {
      const { title: verdictTitle, detail } = verdictText(verdict, steps);
      const box2 = document.createElement('div');
      box2.className = `verdict ${verdict.kind}`;
      box2.setAttribute('role', 'status');
      const t = document.createElement('div');
      t.className = 'title';
      t.textContent = verdictTitle;
      const d = document.createElement('div');
      d.textContent = detail;
      box2.append(t, d);
      box.appendChild(box2);
    }
    controls.style.marginTop = '8px';
    controls.appendChild(
      button(
        t('replay_again'),
        () => {
          void (async () => {
            const response = await startReplay(state.steps, state.stepMode, state.startPage?.actual ?? null);
            if (response.ok) void runReplay();
          })();
        },
        'primary',
      ),
    );
    controls.appendChild(
      button(t('common_close'), () => document.getElementById(REPLAY_HUD_HOST_ID)?.remove(), 'stop'),
    );
  }
  box.appendChild(controls);
  root.append(style, box);
}

// ---------------------------------------------------------------------------
// The run

async function recordResult(state: ReplayState, index: number, result: ReplayStepResult): Promise<ReplayState> {
  const results = state.results.slice();
  results[index] = result;
  const next: ReplayState = { ...state, results, position: index + 1, cursor: cursor?.position() ?? state.cursor };
  await setReplayState(next);
  return next;
}

async function finish(state: ReplayState, stopped: boolean): Promise<void> {
  const steps = sessionFromSteps(state.steps, state.origin).steps;
  const verdict = replayVerdict(steps, state.results, stopped);
  const final: ReplayState = { ...state, status: stopped ? 'stopped' : 'done', cursor: cursor?.position() ?? null };
  await setReplayState(final);
  notifyFinished();
  renderHud(final, verdict);
  (globalThis as ReplayGlobals).__piwiReplayVerdict = verdict;
  const shown = cursor;
  cursor = null;
  setTimeout(() => shown?.remove(), 1200);
}

function caption(step: RecordedStep): string {
  return stepWords(step);
}

/** Performs one action step: false when it could not be done here. */
async function act(step: RecordedStep, element: Element): Promise<boolean> {
  const c = cursor!;
  switch (step.action) {
    case 'click':
      await performClick(element, c, caption(step));
      return true;
    case 'fill':
      if (step.redacted) return performFill(element, '', c, caption(step));
      return performFill(element, step.value ?? '', c, caption(step));
    case 'check':
      return performCheck(element, true, c, caption(step));
    case 'uncheck':
      return performCheck(element, false, c, caption(step));
    case 'selectOption':
      return performSelect(element, step.value ?? '', c, caption(step));
    case 'press':
      await performPress(element, step.value ?? 'Enter', c, caption(step));
      return true;
    default:
      return true;
  }
}

async function checkAssertion(state: ReplayState, step: RecordedStep): Promise<ReplayStepResult> {
  const assertion = step.assertion ?? {
    matcher: 'toBeVisible',
    expected: null,
    actual: null,
    negated: false,
    note: null,
  };
  const deadline = Date.now() + ASSERT_TIMEOUT_MS;
  let pointed = false;
  for (;;) {
    const observation = observe(step);
    const { holds, found } = evaluateAssertion(assertion, observation, state.origin);
    if (!pointed && observation.count === 1 && assertion.matcher !== 'toHaveURL') {
      pointed = true;
      const locator = locatorFor(step);
      const element = locator ? findAll(locator)[0] : undefined;
      if (element) {
        const r = element.getBoundingClientRect();
        cursor?.outline(r);
        await cursor?.moveTo(
          r.left + r.width / 2,
          r.top + r.height / 2,
          t('replay_cursorCheck', { step: caption(step) }),
        );
      }
    }
    if (holds) {
      cursor?.outline(null);
      return { status: 'passed', detail: null };
    }
    if (Date.now() >= deadline) {
      cursor?.outline(null);
      return { status: 'failed', detail: t('replay_stepFound', { found }), found };
    }
    await wait(150);
  }
}

/** In step mode: waits for Next, then answers the state if the replay is still on this step and running. */
async function waitForNext(index: number): Promise<ReplayState | null> {
  await waitForRelease();
  const latest = await getReplayState();
  return latest && latest.status === 'running' && latest.position === index ? latest : null;
}

async function runReplay(): Promise<void> {
  if (loopActive) return;
  loopActive = true;
  waker.reset();
  try {
    let state = await getReplayState();
    if (!state || (state.status !== 'running' && state.status !== 'paused') || state.origin !== location.origin) return;
    document.getElementById(REPLAY_DIALOG_HOST_ID)?.remove();
    cursor?.remove();
    cursor = createCursor(state.cursor);
    // The panel shows at once; the first step waits for the page to be ready.
    renderHud(state);
    await waitForPageReady();
    for (;;) {
      state = await getReplayState();
      if (!state) return;
      if (state.status === 'stopped') return void (await finish(state, true));
      renderHud(state);
      if (state.status === 'paused') {
        await waitForRelease();
        continue;
      }
      const steps = sessionFromSteps(state.steps, state.origin).steps;
      const index = state.position;
      const step = steps[index];
      if (!step) return void (await finish(state, false));

      if (step.action === 'goto' && index === 0 && state.startPage) {
        const actual = state.startPage.actual;
        await recordResult(state, index, { status: 'done', detail: t('replay_startedHere') });
        // Replayed again from another page: back to the page it started on.
        if (location.href.split('#')[0] !== actual.split('#')[0]) {
          location.assign(actual);
          await new Promise(() => undefined);
        }
        continue;
      }

      if (step.action === 'goto') {
        const target = step.value ?? step.pageUrl;
        await recordResult(state, index, { status: 'done', detail: null });
        const url = new URL(target, location.href);
        const here = new URL(location.href);
        if (url.href.split('#')[0] === here.href.split('#')[0] && url.hash !== here.hash) {
          location.assign(url.href);
          continue;
        }
        if (url.href === here.href) location.reload();
        else location.assign(url.href);
        // The page unloads; the replay continues on the next one.
        await new Promise(() => undefined);
      }

      if (!(await waitForPage(step.pageUrl, ACTION_TIMEOUT_MS, state.startPage))) {
        const reason = t('replay_reasonOtherPage', { expected: pathOf(step.pageUrl), actual: pathOf(location.href) });
        await recordResult(state, index, { status: 'diverged', detail: reason });
        return void (await finish((await getReplayState())!, false));
      }

      await waitForStepReady();

      if (step.action === 'assert' || step.action === 'assertVisible') {
        if (state.stepMode) {
          const latest = await waitForNext(index);
          if (!latest) continue;
          state = latest;
        }
        const result = await checkAssertion(state, step);
        await recordResult(state, index, result);
        continue;
      }

      const resolved =
        step.action === 'press' && !step.target ? ({ ok: true, element: null } as const) : await resolveForAction(step);
      if (!resolved.ok) {
        await recordResult(state, index, { status: 'diverged', detail: resolved.reason });
        return void (await finish((await getReplayState())!, false));
      }
      if (state.stepMode) {
        if (resolved.element) {
          const r = resolved.element.getBoundingClientRect();
          cursor?.outline(r);
          await cursor?.moveTo(
            r.left + r.width / 2,
            r.top + r.height / 2,
            t('replay_cursorNext', { step: caption(step) }),
          );
        }
        const latest = await waitForNext(index);
        if (!latest) continue;
        state = latest;
      }
      // Saved before acting: the action may leave the page, and the next one continues from here.
      const advanced = await recordResult(state, index, { status: 'done', detail: null });
      const worked = resolved.element
        ? await act(step, resolved.element)
        : (await performPress(null, step.value ?? 'Enter', cursor!, caption(step)), true);
      if (!worked) {
        await setReplayState({
          ...advanced,
          results: Object.assign(advanced.results.slice(), {
            [index]: { status: 'diverged', detail: t('replay_reasonActionFailed') },
          }),
        });
        return void (await finish((await getReplayState())!, false));
      }
      await updateReplayState((s) => ({ ...s, cursor: cursor?.position() ?? s.cursor }));
    }
  } finally {
    loopActive = false;
  }
}

// ---------------------------------------------------------------------------
// Choosing what to replay

/** The bug report recorded in this browser and not discarded yet, as steps. */
async function lastRecordedReport(): Promise<PiwiSteps | null> {
  try {
    const recording = await getRecordingState();
    if (recording.active || recording.events.length === 0 || recordingMode(recording) !== 'bug') return null;
    const steps = normalizeSteps(recording.events);
    if (steps.length === 0) return null;
    return toStepsDocument(buildSession(steps, recording.startedAt ?? steps[0]!.timestamp));
  } catch {
    return null;
  }
}

function openChooser(lastReport: PiwiSteps | null): void {
  document.getElementById(REPLAY_DIALOG_HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = REPLAY_DIALOG_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `${STYLE}
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: flex-start; justify-content: center; padding-top: 8vh; }`;
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const panel = document.createElement('div');
  panel.className = 'box';
  panel.style.cssText = 'padding:16px;width:min(520px,92vw);';
  panel.setAttribute('role', 'dialog');
  panel.lang = uiLanguage();
  panel.setAttribute('aria-label', t('replay_dialogTitle'));
  const close = () => host.remove();

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = t('replay_dialogTitle');
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = t('replay_dialogIntro', { origin: location.origin });
  panel.append(title, sub);

  let chosen: PiwiSteps | null = null;
  const summary = document.createElement('div');
  summary.className = 'sub';
  summary.style.marginTop = '6px';
  const message = document.createElement('div');
  message.className = 'message';
  message.setAttribute('role', 'alert');
  const startLabel = document.createElement('label');
  startLabel.className = 'check';
  startLabel.style.marginTop = '8px';
  startLabel.hidden = true;
  const startBox = document.createElement('input');
  startBox.type = 'checkbox';
  const startText = document.createElement('span');
  startLabel.append(startBox, startText);
  const describe = (steps: PiwiSteps) => {
    chosen = steps;
    const first = steps.steps[0];
    startLabel.hidden = first?.action !== 'goto';
    startBox.checked = false;
    if (first?.action === 'goto') startText.textContent = t('replay_startHere', { path: first.value ?? first.pageUrl });
    const parts = [tn('replay_summary', steps.steps.length, { title: steps.title ?? t('replay_untitled') })];
    if (steps.origin && steps.origin !== location.origin) parts.push(t('replay_recordedOn', { origin: steps.origin }));
    summary.textContent = parts.join(' · ');
    message.textContent = '';
  };

  if (lastReport) {
    const use = button(t('replay_useRecorded'), () => describe(lastReport));
    use.style.marginTop = '10px';
    panel.appendChild(use);
  }

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = '.zip,.json,application/zip,application/json';
  file.setAttribute('aria-label', t('replay_fileLabel'));
  file.addEventListener('change', () => {
    const picked = file.files?.[0];
    if (!picked) return;
    void picked
      .arrayBuffer()
      .then((buffer) => readStepsFile(picked.name, new Uint8Array(buffer)))
      .then(describe, (e: unknown) => {
        chosen = null;
        summary.textContent = '';
        message.textContent = e instanceof Error ? e.message : String(e);
      });
  });
  const fileLabel = document.createElement('div');
  fileLabel.className = 'sub';
  fileLabel.style.marginTop = '10px';
  fileLabel.textContent = t('replay_chooseFile');
  panel.append(fileLabel, file, summary);

  const stepLabel = document.createElement('label');
  stepLabel.className = 'check';
  stepLabel.style.marginTop = '8px';
  const stepBox = document.createElement('input');
  stepBox.type = 'checkbox';
  stepLabel.append(stepBox, t('replay_stepByStepHint'));
  panel.append(startLabel, stepLabel);

  const row = document.createElement('div');
  row.className = 'row';
  row.style.marginTop = '12px';
  row.appendChild(
    button(
      t('replay_start'),
      () => {
        if (!chosen) {
          message.textContent = t('replay_chooseFirst');
          return;
        }
        const steps = chosen;
        const startOn = !startLabel.hidden && startBox.checked ? location.href : null;
        void startReplay(steps, stepBox.checked, startOn).then((response) => {
          if (!response.ok) {
            message.textContent = response.error ?? t('common_replayStartFailed');
            return;
          }
          close();
          void runReplay();
        });
      },
      'primary',
    ),
  );
  row.appendChild(button(t('common_cancel'), close));
  panel.append(row, message);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.appendChild(panel);
  root.append(style, backdrop);
}

// ---------------------------------------------------------------------------

async function entry(): Promise<void> {
  if (loopActive) return;
  const texts = initI18n();
  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) =>
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }),
    );
  }
  const [state] = await Promise.all([ensureSessionAccess().then(() => getReplayState()), texts]);
  if (state && (state.status === 'running' || state.status === 'paused') && state.origin === location.origin) {
    await runReplay();
    return;
  }
  openChooser(await lastRecordedReport());
}

const globals = globalThis as ReplayGlobals;
if (globals.__piwiReplayEntry) {
  void globals.__piwiReplayEntry();
} else {
  globals.__piwiReplayEntry = entry;
  void entry();
}
