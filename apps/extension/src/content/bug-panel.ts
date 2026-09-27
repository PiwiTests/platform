import { installPickerOverlay, removePickerOverlay, highlightLocator, LOCATOR_SYNTAX_CSS } from '@piwitests/picker-dom';
import {
  normalizeSteps,
  VALUE_MATCHERS,
  type AssertionMatcher,
  type RecordedStep,
  type RecordedTarget,
  type StepAssertion,
} from '@piwitests/core/recording';
import {
  bugContextFrom,
  describeStepInWords,
  emptyBugEvidence,
  expectedSteps,
  renderBugMarkdown,
  renderBugSpec,
  summarizeEvidence,
  type BugConsoleEntry,
  type BugContext,
  type BugFailedRequest,
} from '@piwitests/core/bug-report';
import { parseLocatorChain, renderLocatorChain } from '@piwitests/core/locator-chain';
import { suggestAssertions } from './assertion-suggest.js';
import { DomModel } from './engine-aria.js';
import { createLocatorEngine } from './locator-engine.js';
import { buildOutline, outlineRoot } from './bug-outline.js';
import { assembleBugReport, bugReportZip } from './bug-report-files.js';
import {
  BUG_DIALOG_HOST_ID,
  FRAME_HOST_ID,
  HUD_HOST_ID,
  PANEL_HOST_ID,
  SHARED_STYLE,
  copyToClipboard,
  downloadBlob,
  fileStamp,
  isOwnHost,
} from './record-ui.js';
import {
  addBugScreenshot,
  appendBugEntries,
  getBugEvidence,
  getBugScreenshots,
  setBugEvidenceFields,
  type StoredBugEvidence,
} from '../shared/bug-storage.js';
import { BUG_RELAY, ownOrigin, readRelayedEntry } from '../shared/bug-relay.js';
import { t, tn, tNodes, uiLanguage, type MessageKey } from '../shared/i18n.js';
import type { RecordingState } from '../shared/recording-storage.js';

/**
 * The bug recording's page UI: its HUD, the three ways to say what is wrong
 * (a picked element's expected value or state, an element that is missing,
 * the page the flow should have reached), its screenshots and page outline,
 * the relay that receives the main-world evidence script's entries, and the
 * finish panel that exports the report. `record-panel.ts` does the recording
 * itself and calls into this module when the recording is a bug report.
 */

/** What `record-panel.ts` lends this module to record an assertion. */
export interface BugRecorderHooks {
  targetFor(element: Element): RecordedTarget;
  /** Records an `assert` event and answers the index of the step it became, or null when it was not recorded. */
  addAssert(target: RecordedTarget | null, assertion: StepAssertion): Promise<number | null>;
  /** While paused, the recorder captures nothing: a pick's click is not a step. */
  setPaused(paused: boolean): void;
}

/**
 * Why a report has no screenshot, as the report stores it. The panels show
 * {@link screenshotNoteText} instead, in the interface language.
 */
export const NO_SCREENSHOT_NOTE =
  'Chrome lets Piwi Picker take a screenshot only after you open it on this tab. Open Piwi Picker and choose Take a screenshot.';

/** A stored screenshot note in the interface language; a note this module does not know stays as it is. */
function screenshotNoteText(note: string): string {
  return note === NO_SCREENSHOT_NOTE ? t('bug_screenshotBlocked', { action: t('popup_takeScreenshot') }) : note;
}

const PANEL_CSS = `
  ${SHARED_STYLE}
  ${LOCATOR_SYNTAX_CSS}
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: flex-start; justify-content: center; padding-top: 6vh; }
  .panel { background: #111827; color: #f9fafb; border-radius: 12px; padding: 16px; width: min(640px, 92vw); max-height: 86vh;
    overflow: auto; box-shadow: 0 8px 40px rgba(0,0,0,.5); font-size: 13px; line-height: 1.5; }
  @media (prefers-color-scheme: light) { .panel { background: #ffffff; color: #111827; box-shadow: 0 8px 40px rgba(0,0,0,.2); } }
  .panel { color-scheme: dark; }
  option { background: #1f2937; color: #f9fafb; }
  @media (prefers-color-scheme: light) { .panel { color-scheme: light; } option { background: #ffffff; color: #111827; } }
  .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
  .title { font-weight: 600; font-size: 14px; min-width: 0; overflow-wrap: anywhere; hyphens: auto; }
  .sub { color: #9ca3af; font-size: 12px; overflow-wrap: anywhere; }
  .close { background: none; border: none; color: inherit; opacity: .7; cursor: pointer; font-size: 18px; line-height: 1; padding: 4px 8px; border-radius: 6px; }
  .close:hover, .close:focus-visible { opacity: 1; background: rgba(128,128,128,.15); }
  label { display: block; font-size: 11.5px; color: #9ca3af; margin: 10px 0 4px; overflow-wrap: anywhere; }
  input, select { width: 100%; font: inherit; font-size: 12.5px; padding: 6px 8px; border-radius: 6px;
    border: 1px solid rgba(128,128,128,.4); background: rgba(128,128,128,.1); color: inherit; }
  .actual { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; padding: 6px 8px; border-radius: 6px;
    background: rgba(239,68,68,.12); word-break: break-word; }
  .message { color: #fca5a5; font-size: 12px; margin-top: 8px; min-height: 1em; }
  .message:empty { display: none; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
  button.action { background: rgba(128,128,128,.12); color: inherit; border: 1px solid rgba(128,128,128,.3);
    border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
  button.action:hover, button.action:focus-visible { background: rgba(128,128,128,.25); }
  button.action.primary { background: #7c3aed; border-color: #7c3aed; color: #fff; }
  button.action.danger:hover, button.action.danger:focus-visible { background: rgba(248,113,113,.2); border-color: #f87171; }
  .steps { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; max-height: 240px; overflow: auto; margin: 10px 0; }
  .step { padding: 6px 10px; font-size: 12px; border-bottom: 1px solid rgba(128,128,128,.15); display: flex; gap: 8px; }
  .step:last-child { border-bottom: none; }
  .step-idx { color: #9ca3af; flex-shrink: 0; width: 20px; }
  .step.marked { background: rgba(239,68,68,.1); }
  .step-actual { color: #fca5a5; }
  .evidence { font-size: 12px; color: #9ca3af; }
  .warn { color: #fca5a5; font-size: 12px; margin-top: 6px; overflow-wrap: anywhere; }
  .local { color: #9ca3af; font-size: 11px; margin-top: 10px; }
  @media (prefers-color-scheme: light) {
    .sub, label, .step-idx, .evidence, .local { color: #6b7280; }
    .message, .warn, .step-actual { color: #b91c1c; }
  }
`;

interface BugPanelGlobals {
  __piwiBugFlow?: boolean;
  __piwiPickState?: string;
  __piwiPickedElement?: Element;
}

function panelGlobals(): BugPanelGlobals {
  return globalThis as BugPanelGlobals;
}

/** Pick-flow globals, cleared around a pick so a stale answer is never read. */
function clearPickGlobals(): void {
  const g = panelGlobals();
  delete g.__piwiPickState;
  delete g.__piwiPickedElement;
}

function waitForPick(): Promise<string> {
  return new Promise((resolve) => {
    const check = () => {
      const state = panelGlobals().__piwiPickState;
      if (state !== undefined) resolve(state);
      else setTimeout(check, 100);
    };
    check();
  });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Hides a host until the returned function is called. */
function hide(host: HTMLElement | null): () => void {
  if (!host) return () => undefined;
  const previous = host.style.visibility;
  host.style.visibility = 'hidden';
  return () => {
    host.style.visibility = previous;
  };
}

/** Hides the recorder's own surfaces for the duration of `run`, so a screenshot or a pick shows only the page. */
async function withSurfacesHidden<T>(run: () => Promise<T>): Promise<T> {
  const restore = [HUD_HOST_ID, FRAME_HOST_ID, BUG_DIALOG_HOST_ID].map((id) => hide(document.getElementById(id)));
  try {
    return await run();
  } finally {
    for (const show of restore) show();
  }
}

/**
 * Asks the background worker for a screenshot of this tab and keeps it. Chrome
 * allows one only under the `activeTab` grant; without it the report notes why
 * there is none instead of asking for a wider permission.
 */
export async function takeBugScreenshot(moment: 'marked' | 'finish' | 'manual', step: number | null): Promise<boolean> {
  const response = await withSurfacesHidden(async () => {
    await nextFrame();
    await nextFrame();
    try {
      return (await chrome.runtime.sendMessage({ type: 'piwi-bug-screenshot' })) as
        | { ok: true; dataUrl: string }
        | { ok: false; error?: string }
        | undefined;
    } catch {
      return undefined;
    }
  });
  if (response?.ok && typeof response.dataUrl === 'string' && response.dataUrl.startsWith('data:image/')) {
    await addBugScreenshot({ moment, step, takenAt: Date.now(), dataUrl: response.dataUrl });
    return true;
  }
  await setBugEvidenceFields({ screenshotNote: NO_SCREENSHOT_NOTE });
  return false;
}

/** The context of this page for the report. */
export function currentBugContext(): BugContext {
  let extensionVersion: string | null = null;
  try {
    extensionVersion = chrome.runtime.getManifest().version;
  } catch {
    extensionVersion = null;
  }
  return bugContextFrom({
    url: location.href,
    userAgent: navigator.userAgent,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    time: Date.now(),
    extensionVersion,
  });
}

/** An outline around `element`, or of the page's main landmark (else its body) with no element. */
export function outlineAround(element: Element | null): string {
  const model = new DomModel();
  const start = element ?? document.querySelector('main, [role="main"]') ?? document.body;
  return buildOutline(outlineRoot(start, model), { model, skip: isOwnHost });
}

// ---------------------------------------------------------------------------
// Evidence relay

/**
 * Receives the main-world script's entries for this recording and stores them
 * in batches. Listens until `signal` aborts, which is when capture stops.
 */
export function startEvidenceRelay(token: string, signal: AbortSignal, onStored: () => void): () => Promise<void> {
  const pendingConsole: BugConsoleEntry[] = [];
  const pendingRequests: BugFailedRequest[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async (): Promise<void> => {
    if (timer != null) clearTimeout(timer);
    timer = null;
    if (pendingConsole.length === 0 && pendingRequests.length === 0) return;
    const entries = { console: pendingConsole.splice(0), requests: pendingRequests.splice(0) };
    try {
      await appendBugEntries(entries);
      onStored();
    } catch {
      // Storage full: the recording itself matters more than its evidence.
    }
  };

  const hello = () => window.postMessage({ source: BUG_RELAY.HELLO, token }, ownOrigin());
  window.addEventListener(
    'message',
    (e: MessageEvent) => {
      if (e.source !== window) return;
      const data = e.data as { source?: unknown } | null;
      if (data?.source === BUG_RELAY.READY) {
        hello();
        return;
      }
      const item = readRelayedEntry(data, token);
      if (!item) return;
      if (item.kind === 'console') pendingConsole.push(item.entry);
      else pendingRequests.push(item.entry);
      timer ??= setTimeout(() => void flush(), 250);
    },
    { signal },
  );
  hello();
  return flush;
}

// ---------------------------------------------------------------------------
// Dialogs

interface DialogParts {
  form: HTMLFormElement;
  /** Shows why the dialog cannot be submitted yet. */
  say(message: string): void;
  field(label: string, control: HTMLElement): void;
}

/**
 * A modal dialog over the page, in its own closed shadow root. `build` fills
 * the form and answers the element to focus and a submit function: its value
 * closes the dialog, and null keeps it open (after `say` explained why).
 */
function openBugDialog<T>(
  title: string,
  build: (parts: DialogParts) => { focus: HTMLElement; submit: () => T | null | Promise<T | null> },
): Promise<T | null> {
  document.getElementById(BUG_DIALOG_HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = BUG_DIALOG_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', title);
  panel.lang = uiLanguage();
  const heading = document.createElement('div');
  heading.className = 'title';
  heading.textContent = title;
  const form = document.createElement('form');
  const message = document.createElement('div');
  message.className = 'message';
  message.setAttribute('role', 'alert');
  const parts: DialogParts = {
    form,
    say: (text) => {
      message.textContent = text;
    },
    field: (label, control) => {
      const id = `f${form.querySelectorAll('label').length}`;
      const el = document.createElement('label');
      el.textContent = label;
      el.htmlFor = id;
      control.id = id;
      form.append(el, control);
    },
  };
  const { focus, submit } = build(parts);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.className = 'action primary';
  addBtn.textContent = t('bug_addToReport');
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'action';
  cancelBtn.textContent = t('common_cancel');
  actions.append(addBtn, cancelBtn);
  form.append(message, actions);
  panel.append(heading, form);
  backdrop.appendChild(panel);
  root.append(style, backdrop);

  return new Promise<T | null>((resolve) => {
    const controller = new AbortController();
    const close = (value: T | null) => {
      controller.abort();
      host.remove();
      resolve(value);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void Promise.resolve(submit()).then((value) => {
        if (value != null) close(value);
      });
    });
    cancelBtn.addEventListener('click', () => close(null));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        close(null);
      },
      { capture: true, signal: controller.signal },
    );
    focus.focus();
    if (focus instanceof HTMLInputElement) focus.select();
  });
}

function input(value = '', placeholder = ''): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text';
  el.value = value;
  el.placeholder = placeholder;
  el.autocomplete = 'off';
  return el;
}

interface ExpectedChoice {
  matcher: AssertionMatcher;
  label: string;
  /** What the page shows now. */
  actual: string;
}

const STATE_LABELS: Partial<Record<AssertionMatcher, MessageKey>> = {
  toBeVisible: 'bug_shouldBeVisible',
  toBeHidden: 'bug_shouldBeHidden',
  toBeEnabled: 'bug_shouldBeEnabled',
  toBeDisabled: 'bug_shouldBeDisabled',
};

/** The state words a recorded assertion keeps in `actual`, which the report stores in English. */
const STATE_WORDS: Record<string, MessageKey> = {
  visible: 'bug_stateVisible',
  hidden: 'bug_stateHidden',
  enabled: 'bug_stateEnabled',
  disabled: 'bug_stateDisabled',
};

const STATE_MATCHERS = new Set<AssertionMatcher>(['toBeVisible', 'toBeHidden', 'toBeEnabled', 'toBeDisabled']);

/** What `actual` holds for an element named in Something is missing. */
const MISSING_ACTUAL = 'not on the page';

/** What can be said to be wrong about an element: its value, text or name, or the opposite of each state it is in. */
function expectedChoices(element: Element): { locator: string | null; choices: ExpectedChoice[] } {
  const suggestion = suggestAssertions(element);
  const choices: ExpectedChoice[] = [];
  for (const c of suggestion.candidates) {
    if (c.detail == null) continue;
    if (c.method === 'toHaveValue') choices.push({ matcher: c.method, label: t('bug_itsValue'), actual: c.detail });
    if (c.method === 'toHaveText') choices.push({ matcher: c.method, label: t('bug_itsText'), actual: c.detail });
    if (c.method === 'toHaveAccessibleName')
      choices.push({ matcher: c.method, label: t('bug_itsName'), actual: c.detail });
  }
  const model = new DomModel();
  const visible = model.isVisible(element);
  const disabled = model.disabled(element);
  const states: Array<[AssertionMatcher, string]> = [
    [visible ? 'toBeHidden' : 'toBeVisible', visible ? 'visible' : 'hidden'],
    [disabled ? 'toBeEnabled' : 'toBeDisabled', disabled ? 'disabled' : 'enabled'],
  ];
  for (const [matcher, actual] of states) choices.push({ matcher, label: t(STATE_LABELS[matcher]!), actual });
  return { locator: suggestion.locator, choices };
}

/** The expected-value dialog for a picked element. */
function expectedDialog(element: Element): Promise<StepAssertion | null> {
  const { locator, choices } = expectedChoices(element);
  return openBugDialog<StepAssertion>(t('bug_mark'), ({ form, field, say }) => {
    if (locator) {
      const sub = document.createElement('div');
      sub.className = 'sub';
      const code = document.createElement('span');
      code.className = 'piwi-loc';
      code.innerHTML = highlightLocator(locator);
      sub.append(...tNodes('bug_onElement', { locator: code }));
      form.appendChild(sub);
    }
    const select = document.createElement('select');
    choices.forEach((c, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = c.label;
      select.appendChild(option);
    });
    field(t('bug_whatsWrong'), select);
    const actual = document.createElement('div');
    actual.className = 'actual';
    field(t('bug_pageShows'), actual);
    const expected = input();
    field(t('bug_shouldShow'), expected);
    const note = input('', t('bug_notePlaceholder'));
    field(t('bug_note'), note);

    const expectedLabel = expected.previousElementSibling as HTMLElement;
    const show = () => {
      const choice = choices[Number(select.value)]!;
      const takesValue = VALUE_MATCHERS.has(choice.matcher);
      expected.hidden = !takesValue;
      expectedLabel.hidden = !takesValue;
      actual.textContent = takesValue ? choice.actual : stateWord(choice.actual);
      if (takesValue) expected.value = choice.actual;
      say('');
    };
    select.addEventListener('change', show);
    show();

    return {
      focus: VALUE_MATCHERS.has(choices[0]!.matcher) ? expected : select,
      submit: () => {
        const choice = choices[Number(select.value)]!;
        const takesValue = VALUE_MATCHERS.has(choice.matcher);
        if (takesValue && expected.value === choice.actual) {
          say(t('bug_sameAsPage'));
          return null;
        }
        return {
          matcher: choice.matcher,
          expected: takesValue ? expected.value : null,
          actual: choice.actual,
          negated: false,
          note: note.value.trim() || null,
        };
      },
    };
  });
}

/** The kinds of element a person can say are missing, in their words, most common first. */
const MISSING_KINDS: ReadonlyArray<{ role: string; label: MessageKey }> = [
  { role: 'button', label: 'bug_kindButton' },
  { role: 'link', label: 'bug_kindLink' },
  { role: 'heading', label: 'bug_kindHeading' },
  { role: 'textbox', label: 'bug_kindTextbox' },
  { role: 'combobox', label: 'bug_kindCombobox' },
  { role: 'checkbox', label: 'bug_kindCheckbox' },
  { role: 'radio', label: 'bug_kindRadio' },
  { role: 'option', label: 'bug_kindOption' },
  { role: 'tab', label: 'bug_kindTab' },
  { role: 'menuitem', label: 'bug_kindMenuitem' },
  { role: 'listitem', label: 'bug_kindListitem' },
  { role: 'row', label: 'bug_kindRow' },
  { role: 'cell', label: 'bug_kindCell' },
  { role: 'img', label: 'bug_kindImg' },
  { role: 'dialog', label: 'bug_kindDialog' },
  { role: 'alert', label: 'bug_kindAlert' },
  { role: 'status', label: 'bug_kindStatus' },
  { role: 'region', label: 'bug_kindRegion' },
];

/** `getByRole(role, { name })`, rendered by the chain grammar so the name is quoted the one safe way. */
function roleLocator(role: string, name: string): string {
  return renderLocatorChain({
    calls: [
      {
        method: 'getByRole',
        args: [
          { type: 'string', value: role },
          { type: 'object', entries: [['name', { type: 'string', value: name }]] },
        ],
      },
    ],
  });
}

function missingDialog(): Promise<{ target: RecordedTarget; note: string | null } | null> {
  return openBugDialog(t('bug_missing'), ({ field, say }) => {
    const role = document.createElement('select');
    for (const kind of MISSING_KINDS) {
      const option = document.createElement('option');
      option.value = kind.role;
      option.textContent = t(kind.label);
      role.appendChild(option);
    }
    field(t('bug_whatShouldBeThere'), role);
    const name = input('', t('bug_namePlaceholder'));
    field(t('bug_itsNameLabel'), name);
    const note = input('', t('bug_notePlaceholder'));
    field(t('bug_note'), note);
    return {
      focus: name,
      submit: () => {
        const text = name.value.trim();
        if (!text) {
          say(t('bug_nameRequired'));
          return null;
        }
        const locator = roleLocator(role.value, text);
        const engine = createLocatorEngine(document, { ignore: isOwnHost });
        let found = 0;
        try {
          found = engine.queryAll(parseLocatorChain(locator)).length;
        } catch {
          found = 0;
        }
        if (found > 0) {
          say(tn('bug_alreadyThere', found, { mark: t('bug_mark') }));
          return null;
        }
        return {
          target: {
            tagName: '',
            role: role.value,
            accessibleName: text,
            testId: null,
            text: null,
            alternatives: [{ locator, method: 'getByRole', score: 100 }],
          },
          note: note.value.trim() || null,
        };
      },
    };
  });
}

function wrongPageDialog(): Promise<StepAssertion | null> {
  const here = `${location.pathname}${location.search}`;
  return openBugDialog<StepAssertion>(t('bug_wrongPage'), ({ form, field, say }) => {
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = t('bug_youAreOn', { path: here });
    form.appendChild(sub);
    const expected = input(location.pathname, '/checkout/thanks');
    field(t('bug_pageShouldBe'), expected);
    const note = input('', t('bug_notePlaceholder'));
    field(t('bug_note'), note);
    return {
      focus: expected,
      submit: () => {
        const value = expected.value.trim();
        if (!value || value === here || value === location.pathname || value === location.href) {
          say(t('bug_samePage'));
          return null;
        }
        return { matcher: 'toHaveURL', expected: value, actual: here, negated: false, note: note.value.trim() || null };
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Flows started from the HUD

async function exclusive(run: () => Promise<void>): Promise<void> {
  const g = panelGlobals();
  if (g.__piwiBugFlow) return;
  g.__piwiBugFlow = true;
  try {
    await run();
  } finally {
    g.__piwiBugFlow = false;
  }
}

/** Pick an element, say what it should show, and record that as an expected assertion. */
export function runMarkFlow(hooks: BugRecorderHooks): Promise<void> {
  return exclusive(async () => {
    hooks.setPaused(true);
    // Out of the way while picking, so the HUD itself cannot be picked.
    let showHud = hide(document.getElementById(HUD_HOST_ID));
    try {
      clearPickGlobals();
      installPickerOverlay({ transport: 'global', failing: null });
      const state = await waitForPick();
      removePickerOverlay();
      const element = panelGlobals().__piwiPickedElement;
      clearPickGlobals();
      showHud();
      showHud = () => undefined;
      if (state !== 'picked' || !element) return;
      const assertion = await expectedDialog(element);
      if (!assertion) return;
      const step = await hooks.addAssert(hooks.targetFor(element), assertion);
      await setBugEvidenceFields({ outline: outlineAround(element) });
      await takeBugScreenshot('marked', step);
    } finally {
      removePickerOverlay();
      showHud();
      hooks.setPaused(false);
    }
  });
}

/** Name an element that should be on the page and is not. */
export function runMissingFlow(hooks: BugRecorderHooks): Promise<void> {
  return exclusive(async () => {
    hooks.setPaused(true);
    try {
      const missing = await missingDialog();
      if (!missing) return;
      const step = await hooks.addAssert(missing.target, {
        matcher: 'toBeVisible',
        expected: null,
        actual: MISSING_ACTUAL,
        negated: false,
        note: missing.note,
      });
      await setBugEvidenceFields({ outline: outlineAround(null) });
      await takeBugScreenshot('marked', step);
    } finally {
      hooks.setPaused(false);
    }
  });
}

/** Say which page the flow should have reached. */
export function runWrongPageFlow(hooks: BugRecorderHooks): Promise<void> {
  return exclusive(async () => {
    hooks.setPaused(true);
    try {
      const assertion = await wrongPageDialog();
      if (!assertion) return;
      const step = await hooks.addAssert(null, assertion);
      await setBugEvidenceFields({ outline: outlineAround(null) });
      await takeBugScreenshot('marked', step);
    } finally {
      hooks.setPaused(false);
    }
  });
}

// ---------------------------------------------------------------------------
// HUD

export interface BugHudHandlers {
  mark(): void;
  missing(): void;
  wrongPage(): void;
  finish(): void;
}

function evidenceSummary(evidence: StoredBugEvidence): string {
  return summarizeEvidence({
    ...emptyBugEvidence(),
    console: evidence.console,
    requests: evidence.requests,
    outline: evidence.outline,
    screenshots: Array.from({ length: evidence.screenshots }, () => ({
      file: '',
      step: null,
      moment: 'manual',
      takenAt: 0,
    })),
  });
}

function stepRow(step: RecordedStep, index: number): HTMLElement {
  const row = document.createElement('div');
  row.className = step.action === 'assert' ? 'step marked' : 'step';
  const idx = document.createElement('span');
  idx.className = 'step-idx';
  idx.textContent = String(index + 1);
  const text = document.createElement('span');
  text.textContent = describeStepInWords(step);
  row.append(idx, text);
  const assertion = step.assertion;
  if (step.action === 'assert' && assertion?.actual != null) {
    const shown = document.createElement('span');
    shown.className = 'step-actual';
    shown.textContent = ` · ${actualInWords(assertion.matcher, assertion.actual)}`;
    text.appendChild(shown);
  }
  return row;
}

/** A recorded state word (`hidden`) in the interface language. */
function stateWord(actual: string): string {
  const key = STATE_WORDS[actual];
  return key ? t(key) : actual;
}

/** What the page showed at a marked step: a text in quotes, a state, or the missing element's absence. */
function actualInWords(matcher: AssertionMatcher, actual: string): string {
  if (matcher === 'toBeVisible' && actual === MISSING_ACTUAL) return t('bug_stepAbsent');
  if (STATE_MATCHERS.has(matcher) && STATE_WORDS[actual]) return t('bug_stepIs', { state: stateWord(actual) });
  return t('bug_stepShows', { text: actual });
}

/**
 * The HUD of a bug recording: the last steps, the three ways to mark what is
 * wrong, Finish, and what evidence has been collected. Its shadow root
 * delegates focus, so focusing the host reaches its first button.
 */
export function renderBugHud(
  state: RecordingState,
  evidence: StoredBugEvidence,
  captureError: string | null,
  handlers: BugHudHandlers,
): void {
  document.getElementById(HUD_HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = HUD_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:auto 16px 16px auto;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed', delegatesFocus: true });
  const style = document.createElement('style');
  style.textContent = `
    ${SHARED_STYLE}
    .bar { display: flex; flex-direction: column; gap: 8px; background: #111827; color: #f9fafb; border-radius: 12px;
      padding: 10px 12px; box-shadow: 0 8px 30px rgba(0,0,0,.4); font-size: 12.5px; width: 360px; max-width: calc(100vw - 32px); }
    @media (prefers-color-scheme: light) {
      .bar { background: #ffffff; color: #111827; box-shadow: 0 8px 30px rgba(0,0,0,.2); border: 1px solid #e5e7eb; }
    }
    .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #ef4444; flex-shrink: 0; animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
    @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
    .title { font-weight: 600; flex: 1; min-width: 0; overflow-wrap: anywhere; }
    .steps { display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; max-height: 150px; overflow: auto; }
    .step { display: flex; gap: 6px; overflow-wrap: anywhere; }
    .step-idx { color: #9ca3af; width: 16px; flex-shrink: 0; text-align: right; }
    .step.marked { color: #fca5a5; }
    .step-actual { opacity: .85; }
    button { border-radius: 6px; padding: 4px 9px; font: inherit; font-size: 11.5px; cursor: pointer;
      border: 1px solid rgba(128,128,128,.3); background: rgba(128,128,128,.12); color: inherit; }
    button:hover, button:focus-visible { background: rgba(128,128,128,.25); }
    button.finish { background: #dc2626; border-color: #dc2626; color: #fff; margin-left: auto; }
    .evidence { color: #9ca3af; font-size: 11px; overflow-wrap: anywhere; }
    .warn { color: #fca5a5; font-size: 11px; line-height: 1.35; overflow-wrap: anywhere; }
    @media (prefers-color-scheme: light) { .warn, .step.marked { color: #b91c1c; } .evidence, .step-idx { color: #6b7280; } }
  `;
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', t('bug_reportLabel'));
  bar.lang = uiLanguage();

  const steps = normalizeSteps(state.events);
  const top = document.createElement('div');
  top.className = 'row';
  const dot = document.createElement('div');
  dot.className = 'dot';
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = tn('bug_hudTitle', steps.length);
  top.append(dot, title);
  bar.appendChild(top);

  if (steps.length > 0) {
    const list = document.createElement('div');
    list.className = 'steps';
    const first = Math.max(0, steps.length - 6);
    steps.slice(first).forEach((step, i) => list.appendChild(stepRow(step, first + i)));
    bar.appendChild(list);
    // Keep the latest step in view.
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  }

  const buttons = document.createElement('div');
  buttons.className = 'row';
  const button = (label: string, onClick: () => void, className = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (className) b.className = className;
    b.addEventListener('click', onClick);
    buttons.appendChild(b);
    return b;
  };
  button(t('bug_mark'), handlers.mark).title = t('bug_markHint');
  button(t('bug_missing'), handlers.missing).title = t('bug_missingHint');
  button(t('bug_wrongPage'), handlers.wrongPage).title = t('bug_wrongPageHint');
  button(t('bug_finish'), handlers.finish, 'finish');
  bar.appendChild(buttons);

  const summary = document.createElement('div');
  summary.className = 'evidence';
  summary.textContent = evidenceSummary(evidence);
  bar.appendChild(summary);

  for (const text of [captureError, evidence.screenshotNote && screenshotNoteText(evidence.screenshotNote)]) {
    if (!text) continue;
    const warn = document.createElement('div');
    warn.className = 'warn';
    warn.textContent = text;
    bar.appendChild(warn);
  }

  root.append(style, bar);
}

// ---------------------------------------------------------------------------
// Finish panel

/**
 * The finished report: a title, the steps with what was marked, the evidence,
 * and the three exports. Everything is built here, in the tab; nothing is sent.
 */
export async function renderBugFinishPanel(state: RecordingState, onDiscard: () => Promise<void>): Promise<void> {
  document.getElementById(HUD_HOST_ID)?.remove();
  document.getElementById(PANEL_HOST_ID)?.remove();
  document.getElementById(FRAME_HOST_ID)?.remove();

  const [evidence, screenshots] = await Promise.all([getBugEvidence(), getBugScreenshots()]);
  const context = evidence.context ?? currentBugContext();
  let title = evidence.title ?? '';
  const report = () =>
    assembleBugReport({
      events: state.events,
      startedAt: state.startedAt ?? state.events[0]?.timestamp ?? Date.now(),
      evidence: { ...evidence, title },
      screenshots,
      context,
    });
  const initial = report();

  const host = document.createElement('div');
  host.id = PANEL_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('bug_reportLabel'));
  panel.lang = uiLanguage();
  panel.tabIndex = -1;

  const header = document.createElement('div');
  header.className = 'header';
  const heading = document.createElement('div');
  heading.className = 'title';
  heading.textContent = tn('bug_finishTitle', initial.steps.steps.length);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.setAttribute('aria-label', t('common_close'));
  closeBtn.textContent = '×';
  header.append(heading, closeBtn);
  panel.appendChild(header);

  const titleLabel = document.createElement('label');
  titleLabel.textContent = t('bug_title');
  titleLabel.htmlFor = 'bug-title';
  const titleInput = input(title, t('bug_titlePlaceholder'));
  titleInput.id = 'bug-title';
  titleInput.addEventListener('input', () => {
    title = titleInput.value;
    void setBugEvidenceFields({ title }).catch(() => undefined);
  });
  panel.append(titleLabel, titleInput);

  const stepsWrap = document.createElement('div');
  stepsWrap.className = 'steps';
  initial.steps.steps.forEach((step, i) => stepsWrap.appendChild(stepRow(step, i)));
  panel.appendChild(stepsWrap);

  const summary = document.createElement('div');
  summary.className = 'evidence';
  summary.textContent = t('bug_attached', { summary: summarizeEvidence(initial.evidence) });
  panel.appendChild(summary);

  const notes: string[] = [];
  if (expectedSteps(initial).length === 0) {
    notes.push(t('bug_nothingMarked', { mark: t('bug_mark') }));
  }
  for (const w of renderBugSpec(initial).warnings)
    notes.push(t('bug_stepWarning', { step: w.step + 1, message: w.message }));
  if (initial.evidence.screenshots.length === 0) {
    notes.push(
      evidence.screenshotNote
        ? t('bug_noScreenshot', { reason: screenshotNoteText(evidence.screenshotNote) })
        : t('bug_noScreenshotTaken'),
    );
  }
  for (const text of notes) {
    const warn = document.createElement('div');
    warn.className = 'warn';
    warn.textContent = text;
    panel.appendChild(warn);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  const action = (label: string, className: string, onClick: (btn: HTMLButtonElement) => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `action ${className}`.trim();
    b.textContent = label;
    b.addEventListener('click', () => onClick(b));
    actions.appendChild(b);
    return b;
  };
  action(t('bug_copyTest'), 'primary', (b) => void copyToClipboard(renderBugSpec(report()).code, b)).title =
    t('bug_copyTestHint');
  action(t('bug_copyReport'), '', (b) => void copyToClipboard(renderBugMarkdown(report()), b)).title =
    t('bug_copyReportHint');
  action(t('bug_downloadZip'), '', () => {
    const current = report();
    downloadBlob(
      new Blob([bugReportZip(current, screenshots) as BlobPart], { type: 'application/zip' }),
      `piwi-bug-${fileStamp(current.context.time)}.zip`,
    );
  }).title = t('bug_downloadZipHint');

  const controller = new AbortController();
  const closePanel = () => {
    controller.abort();
    host.remove();
  };
  const replayMessage = document.createElement('div');
  replayMessage.className = 'warn';
  action(t('bug_replay'), '', (b) => {
    b.disabled = true;
    void (async () => {
      let response: { ok: boolean; error?: string } | undefined;
      try {
        response = await chrome.runtime.sendMessage({
          type: 'piwi-start-replay',
          steps: report().steps,
          origin: location.origin,
          stepMode: false,
          inject: true,
        });
      } catch (e) {
        response = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      if (response?.ok) closePanel();
      else {
        b.disabled = false;
        replayMessage.textContent = response?.error ?? t('common_replayStartFailed');
      }
    })();
  }).title = t('bug_replayHint');
  action(t('common_discard'), 'danger', () => void onDiscard().then(closePanel, closePanel));
  panel.append(actions, replayMessage);

  const local = document.createElement('div');
  local.className = 'local';
  local.textContent = t('bug_staysLocal');
  panel.appendChild(local);

  closeBtn.addEventListener('click', closePanel);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closePanel();
  });
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') closePanel();
    },
    { capture: true, signal: controller.signal },
  );

  backdrop.appendChild(panel);
  root.append(style, backdrop);
  panel.focus();
}
