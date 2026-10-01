/**
 * Cross-page action recording — the wire shapes and pure normalization for
 * turning a stream of captured DOM interactions into a `RecordedSession`
 * that `codegen.ts` (raw) and `function-match.ts` (catalog-aware) both
 * consume.
 *
 * The single source of truth for the extension's recorder (which builds
 * `RawCaptureEvent`s from real DOM events, one page/content-script instance
 * at a time) and, later, any server-side consumer of a recorded session.
 * Everything here is plain data plus pure functions — no DOM, no `node:*` —
 * so it stays inlineable everywhere `@piwitests/core` already is.
 */

/** The Playwright action a recorded step maps to. */
export type StepAction =
  | 'goto'
  | 'click'
  | 'dblclick'
  | 'hover'
  | 'fill'
  | 'check'
  | 'uncheck'
  | 'selectOption'
  | 'press'
  | 'setInputFiles'
  | 'dragTo'
  | 'assertVisible'
  | 'assert';

/** The web-first assertions an `assert` step can state. */
export type AssertionMatcher =
  | 'toHaveText'
  | 'toHaveValue'
  | 'toHaveAccessibleName'
  | 'toBeVisible'
  | 'toBeHidden'
  | 'toBeEnabled'
  | 'toBeDisabled'
  | 'toHaveURL';

export const ASSERTION_MATCHERS: readonly AssertionMatcher[] = [
  'toHaveText',
  'toHaveValue',
  'toHaveAccessibleName',
  'toBeVisible',
  'toBeHidden',
  'toBeEnabled',
  'toBeDisabled',
  'toHaveURL',
];

/** Matchers that compare with an expected value; the others check a state. */
export const VALUE_MATCHERS: ReadonlySet<AssertionMatcher> = new Set([
  'toHaveText',
  'toHaveValue',
  'toHaveAccessibleName',
  'toHaveURL',
]);

/** What an `assert` step expects. `toHaveURL` checks the page and needs no target. */
export interface StepAssertion {
  matcher: AssertionMatcher;
  /** The value the page should show: set for `VALUE_MATCHERS`, null for a state matcher. */
  expected: string | null;
  /** What the page showed when the step was recorded, when that is worth keeping (a bug report's wrong value). */
  actual: string | null;
  negated: boolean;
  /** Free text from the person who recorded it. */
  note: string | null;
}

/** One ranked locator alternative, trimmed to what codegen/matching need (mirrors `RankedLocator` minus scoring metadata not used here). */
export interface RecordedLocatorAlternative {
  locator: string;
  method: string;
  score: number;
}

/** The element a step acted on — enough to re-derive/re-rank a locator and to match it against a catalog's DOM pattern. */
export interface RecordedTarget {
  tagName: string;
  role: string | null;
  accessibleName: string | null;
  testId: string | null;
  /** Normalized, whitespace-collapsed visible text, truncated to 120 chars. */
  text: string | null;
  /** Ranked locator alternatives for this element, best first — computed once at capture time. */
  alternatives: RecordedLocatorAlternative[];
  /**
   * An opaque per-document identity for the element itself, assigned by the
   * recorder at capture time. Only ever compared for equality (see
   * `sameTarget`) and never emitted into generated code.
   *
   * Exists because nothing else here identifies an element reliably: two
   * unlabelled `<input>`s on one form share tag, role, accessible name *and*
   * text, and neither gets any locator alternative at all (a bare role anchor
   * needs the role to be document-unique). Without it, typing into the second
   * field would read as a continuation of the first and overwrite its value.
   * Optional, so a recording without it still deserializes.
   */
  elementKey?: string | null;
}

/** A box on the page, in CSS pixels from the viewport's top left corner. */
export interface ViewportBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The screenshot a bug recording took of the page as a step began, by the id
 * the recorder gave it, and where the step's element was on it. Kept by the
 * recorder only: a steps document never holds it.
 */
export interface StepView {
  id: string;
  box: ViewportBox | null;
}

/** One recorded, already-normalized user action. */
export interface RecordedStep {
  action: StepAction;
  target: RecordedTarget | null;
  /**
   * `fill`/`selectOption` value, the key name for `press`, or the names of the
   * files chosen for `setInputFiles`, one per line (never their content). Never
   * set for a password-type field — see `redacted`.
   */
  value: string | null;
  /** True when `value` was stripped because the source field was `type="password"` — codegen emits a placeholder instead. */
  redacted: boolean;
  pageUrl: string;
  timestamp: number;
  /** Set on `assert` steps only. */
  assertion?: StepAssertion;
  /** Where a `dragTo` step drops what it drags; set on `dragTo` steps only. */
  dropTarget?: RecordedTarget | null;
  /** The page as the step began, in a bug recording; see {@link StepView}. */
  view?: StepView;
}

/**
 * The size of the page's viewport from the step at `step` on, in CSS pixels,
 * as `page.setViewportSize` sets it. A recording's first one, at step 0, is
 * the size it was recorded at; the others follow a resize.
 */
export interface StepViewport {
  step: number;
  width: number;
  height: number;
}

export interface RecordedSession {
  steps: RecordedStep[];
  startedAt: number;
  /** The very first page's URL — the only step that becomes an explicit `page.goto(...)` in codegen. */
  startUrl: string;
  /** The viewport sizes the steps were recorded at, by the step each starts at; absent when none was recorded. */
  viewports?: StepViewport[];
}

/** A raw capture event, as built by the extension's DOM listeners — one per meaningful browser event, before coalescing. */
export interface RawCaptureEvent {
  kind:
    | 'click'
    | 'dblclick'
    | 'hover'
    | 'input'
    | 'change'
    | 'files'
    | 'drop'
    | 'keydown'
    | 'navigate'
    | 'assert'
    | 'viewport';
  /** The element acted on or asserted about; null for a navigation and for a `toHaveURL` assertion. */
  target: RecordedTarget | null;
  /** Current field value (input/change), the key pressed (keydown), the new URL (navigate), or the chosen files' names, one per line (files). */
  value: string | null;
  checked: boolean | null;
  inputType: string | null;
  isPasswordField: boolean;
  pageUrl: string;
  timestamp: number;
  /** What an `assert` event states: an expected value or state, added by hand during a recording. */
  assertion?: StepAssertion;
  /** Where a `drop` event's element was dropped; its `target` is the element dragged. */
  dropTarget?: RecordedTarget | null;
  /** The page's viewport size, on a `viewport` event: when the recording starts, and after a resize. */
  viewport?: { width: number; height: number };
  /** The page as the action began, in a bug recording; see {@link StepView}. */
  view?: StepView;
}

/**
 * The narrowest identity available for a target, best first: the recorder's own
 * per-element token, then a test id, then the best locator alternative, and only
 * as a last resort the element's shape — which two unlabelled fields on the same
 * form share exactly.
 */
function targetKey(t: RecordedTarget): string {
  if (t.elementKey) return `el:${t.elementKey}`;
  if (t.testId) return `testid:${t.testId}`;
  const best = t.alternatives[0]?.locator;
  if (best) return `loc:${best}`;
  return `shape:${t.tagName}|${t.role ?? ''}|${t.accessibleName ?? ''}`;
}

function sameTarget(a: RecordedTarget | null, b: RecordedTarget | null): boolean {
  if (!a || !b) return a === b;
  return targetKey(a) === targetKey(b);
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * How long after an `Enter` press a click on the same element still counts as
 * the browser's own synthetic activation rather than a second, deliberate
 * click. The synthetic one lands in the same task; the allowance is for a busy
 * event loop, not for human timing.
 */
const ENTER_CLICK_WINDOW_MS = 500;

/**
 * The keys a recording keeps: Enter submits or picks, Escape closes a popup or
 * a dialog, and the arrows move through a list or a menu. Any other key only
 * edits a field, which the field's `fill` already carries.
 */
export const RECORDED_KEYS: ReadonlySet<string> = new Set(['Enter', 'Escape', 'ArrowDown', 'ArrowUp']);

/**
 * Whether a recorded key press becomes a step: one of `RECORDED_KEYS`, a
 * shortcut with a modifier as Playwright writes it (`ControlOrMeta+K`), or a
 * single character pressed outside a field (a page's own shortcut, such as `?`).
 * The recorder decides which presses to send; this keeps the rest out.
 */
function isRecordedKey(key: string | null | undefined): key is string {
  if (!key) return false;
  return (
    RECORDED_KEYS.has(key) || /^(?:(?:ControlOrMeta|Control|Meta|Alt|Shift)\+)+.+$/.test(key) || [...key].length === 1
  );
}

/**
 * Coalesce a stream of raw capture events into `RecordedStep`s:
 *  - a burst of `input` events on the same field collapses into one `fill`,
 *    committed once the field changes or the burst ends (the last value
 *    wins);
 *  - `change` on a checkbox/radio becomes `check`/`uncheck` from the
 *    resulting `checked` state, not a raw `click`;
 *  - `change` on a `<select>` becomes `selectOption`;
 *  - `Enter` on a text field becomes `press('Enter')`, and the browser's own
 *    synthetic click on the same element right after it is dropped rather than
 *    recorded a second time; `Escape`, the arrow keys (`RECORDED_KEYS`) and
 *    the page's shortcuts (`isRecordedKey`) become presses too;
 *  - a plain `click` becomes a `click` step, and a `dblclick` replaces the
 *    two clicks on the same element the browser sent before it;
 *  - `files` (a file field's choice, names only) becomes `setInputFiles`, and
 *    `drop` (an HTML drag and drop) becomes `dragTo`;
 *  - a `hover` event becomes a `hover` step: the recorder sends one only for
 *    the element whose hover revealed what the next click lands on; a second
 *    hover on the same element right after the first is dropped;
 *  - `navigate` events become `goto` steps only for the session's very first
 *    page — later navigations are implied by the click/press that caused
 *    them and are dropped (they still update `pageUrl` on later steps via
 *    the caller passing the current page's URL on each event).
 *  - an `assert` event becomes an `assert` step where it was added, after
 *    committing any fill in progress; one without an assertion is dropped;
 *  - password-field values are never carried through — `redacted: true`,
 *    `value: null`.
 */
export function normalizeSteps(events: RawCaptureEvent[]): RecordedStep[] {
  const steps: RecordedStep[] = [];
  let pendingFill: {
    target: RecordedTarget | null;
    value: string;
    pageUrl: string;
    timestamp: number;
    redacted: boolean;
    view?: StepView;
  } | null = null;
  /** The view of the event a step comes from, when the recorder took one. */
  const viewOf = (view: StepView | undefined): { view?: StepView } => (view ? { view } : {});
  let sawFirstGoto = false;

  function flushPendingFill(): void {
    if (!pendingFill) return;
    steps.push({
      action: 'fill',
      target: pendingFill.target,
      value: pendingFill.redacted ? null : pendingFill.value,
      redacted: pendingFill.redacted,
      pageUrl: pendingFill.pageUrl,
      timestamp: pendingFill.timestamp,
      ...viewOf(pendingFill.view),
    });
    pendingFill = null;
  }

  for (const ev of events) {
    // A viewport size is not a step: `viewportsForSteps` places it.
    if (ev.kind === 'viewport') continue;

    if (ev.kind === 'navigate') {
      flushPendingFill();
      if (!sawFirstGoto) {
        sawFirstGoto = true;
        steps.push({
          action: 'goto',
          target: null,
          value: ev.value,
          redacted: false,
          pageUrl: ev.value ?? ev.pageUrl,
          timestamp: ev.timestamp,
        });
      }
      continue;
    }

    if (ev.kind === 'input') {
      if (pendingFill && sameTarget(pendingFill.target, ev.target)) {
        pendingFill.value = ev.value ?? '';
        pendingFill.timestamp = ev.timestamp;
        pendingFill.redacted = pendingFill.redacted || ev.isPasswordField;
        continue;
      }
      flushPendingFill();
      pendingFill = {
        target: ev.target,
        value: ev.value ?? '',
        pageUrl: ev.pageUrl,
        timestamp: ev.timestamp,
        redacted: ev.isPasswordField,
        ...viewOf(ev.view),
      };
      continue;
    }

    if (ev.kind === 'keydown') {
      if (!isRecordedKey(ev.value)) continue;
      // A key commits whatever field was mid-fill; Enter then replaces the click that would otherwise follow it.
      flushPendingFill();
      steps.push({
        action: 'press',
        target: ev.target,
        value: ev.value,
        redacted: false,
        pageUrl: ev.pageUrl,
        timestamp: ev.timestamp,
        ...viewOf(ev.view),
      });
      continue;
    }

    if (ev.kind === 'change') {
      flushPendingFill();
      if (ev.inputType === 'checkbox' || ev.inputType === 'radio') {
        steps.push({
          action: ev.checked ? 'check' : 'uncheck',
          target: ev.target,
          value: null,
          redacted: false,
          pageUrl: ev.pageUrl,
          timestamp: ev.timestamp,
          ...viewOf(ev.view),
        });
        continue;
      }
      if (ev.inputType === 'select') {
        steps.push({
          action: 'selectOption',
          target: ev.target,
          value: ev.value,
          redacted: false,
          pageUrl: ev.pageUrl,
          timestamp: ev.timestamp,
          ...viewOf(ev.view),
        });
        continue;
      }
      continue;
    }

    if (ev.kind === 'assert') {
      flushPendingFill();
      if (!ev.assertion) continue;
      steps.push({
        action: 'assert',
        target: ev.assertion.matcher === 'toHaveURL' ? null : ev.target,
        value: null,
        redacted: false,
        pageUrl: ev.pageUrl,
        timestamp: ev.timestamp,
        ...viewOf(ev.view),
        assertion: { ...ev.assertion },
      });
      continue;
    }

    if (ev.kind === 'hover') {
      flushPendingFill();
      const prev = steps[steps.length - 1];
      if (!ev.target || (prev?.action === 'hover' && sameTarget(prev.target, ev.target))) continue;
      steps.push({
        action: 'hover',
        target: ev.target,
        value: null,
        redacted: false,
        pageUrl: ev.pageUrl,
        timestamp: ev.timestamp,
        ...viewOf(ev.view),
      });
      continue;
    }

    if (ev.kind === 'dblclick') {
      flushPendingFill();
      // The page as the first of the clicks it replaces began.
      let view = ev.view;
      for (let i = 0; i < 2; i++) {
        const prev = steps[steps.length - 1];
        if (prev?.action === 'click' && sameTarget(prev.target, ev.target)) view = steps.pop()!.view ?? view;
      }
      steps.push({
        action: 'dblclick',
        target: ev.target,
        value: null,
        redacted: false,
        pageUrl: ev.pageUrl,
        timestamp: ev.timestamp,
        ...viewOf(view),
      });
      continue;
    }

    if (ev.kind === 'files') {
      flushPendingFill();
      if (!ev.target) continue;
      steps.push({
        action: 'setInputFiles',
        target: ev.target,
        value: ev.value ?? '',
        redacted: false,
        pageUrl: ev.pageUrl,
        timestamp: ev.timestamp,
        ...viewOf(ev.view),
      });
      continue;
    }

    if (ev.kind === 'drop') {
      flushPendingFill();
      if (!ev.target || !ev.dropTarget) continue;
      steps.push({
        action: 'dragTo',
        target: ev.target,
        value: null,
        redacted: false,
        pageUrl: ev.pageUrl,
        timestamp: ev.timestamp,
        ...viewOf(ev.view),
        dropTarget: ev.dropTarget,
      });
      continue;
    }

    if (ev.kind === 'click') {
      flushPendingFill();
      // A checkbox/radio click that will also fire `change` is handled there; a plain click on anything else records here.
      if (ev.inputType === 'checkbox' || ev.inputType === 'radio') continue;
      // Enter on a focused button or link fires `keydown` *and* a synthetic
      // `click`. The press already records the intent, so keeping both made the
      // generated spec activate the same control twice — a duplicate submit on
      // any real form.
      const prev = steps[steps.length - 1];
      if (
        prev?.action === 'press' &&
        prev.value === 'Enter' &&
        sameTarget(prev.target, ev.target) &&
        ev.timestamp - prev.timestamp <= ENTER_CLICK_WINDOW_MS
      ) {
        continue;
      }
      steps.push({
        action: 'click',
        target: ev.target,
        value: null,
        redacted: false,
        pageUrl: ev.pageUrl,
        timestamp: ev.timestamp,
        ...viewOf(ev.view),
      });
      continue;
    }
  }

  flushPendingFill();
  const withText = (t: RecordedTarget): RecordedTarget => ({ ...t, text: t.text ? normalizeText(t.text) : null });
  return steps.map((s) => {
    const step = s.target ? { ...s, target: withText(s.target) } : s;
    return step.dropTarget ? { ...step, dropTarget: withText(step.dropTarget) } : step;
  });
}

/** Builds a `RecordedSession` from a flat step list — `startUrl` is the first step's page, or the first `goto`'s value. */
export function buildSession(steps: RecordedStep[], startedAt: number): RecordedSession {
  const firstGoto = steps.find((s) => s.action === 'goto');
  const startUrl = firstGoto?.value ?? steps[0]?.pageUrl ?? '';
  return { steps, startedAt, startUrl };
}

/**
 * The viewport sizes of `viewport` events, by the step each applies from: the
 * first step recorded at or after the size was. Of several sizes before one
 * step the last counts, a size equal to the one before it is left out, and a
 * size taken after the last step is dropped.
 */
export function viewportsForSteps(steps: RecordedStep[], events: RawCaptureEvent[]): StepViewport[] {
  const sizes = events.filter((e) => e.kind === 'viewport' && e.viewport).sort((a, b) => a.timestamp - b.timestamp);
  const byStep = new Map<number, StepViewport>();
  for (const e of sizes) {
    const step = steps.findIndex((s) => s.timestamp >= e.timestamp);
    if (step < 0) continue;
    byStep.set(step, { step, width: e.viewport!.width, height: e.viewport!.height });
  }
  const out: StepViewport[] = [];
  for (const v of [...byStep.values()].sort((a, b) => a.step - b.step)) {
    const last = out[out.length - 1];
    if (!last || last.width !== v.width || last.height !== v.height) out.push(v);
  }
  return out;
}

/** The view each step began from, by step: the steps a bug recording took a screenshot for. */
export function stepViews(steps: RecordedStep[]): Array<StepView & { step: number }> {
  return steps.flatMap((s, step) => (s.view ? [{ step, id: s.view.id, box: s.view.box }] : []));
}

/** A recording's session from its raw events: its steps, and the viewport sizes it recorded when there are any. */
export function sessionFromEvents(events: RawCaptureEvent[], startedAt: number): RecordedSession {
  const session = buildSession(normalizeSteps(events), startedAt);
  const viewports = viewportsForSteps(session.steps, events);
  return viewports.length > 0 ? { ...session, viewports } : session;
}
