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
  | 'fill'
  | 'check'
  | 'uncheck'
  | 'selectOption'
  | 'press'
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
   * needs the role to be document-unique). Without this, typing into the second
   * field looked like a continuation of the first and its value overwrote it.
   * Optional so a recording captured before this existed still deserializes.
   */
  elementKey?: string | null;
}

/** One recorded, already-normalized user action. */
export interface RecordedStep {
  action: StepAction;
  target: RecordedTarget | null;
  /** `fill`/`selectOption` value, or the key name for `press`. Never set for a password-type field — see `redacted`. */
  value: string | null;
  /** True when `value` was stripped because the source field was `type="password"` — codegen emits a placeholder instead. */
  redacted: boolean;
  pageUrl: string;
  timestamp: number;
  /** Set on `assert` steps only. */
  assertion?: StepAssertion;
}

export interface RecordedSession {
  steps: RecordedStep[];
  startedAt: number;
  /** The very first page's URL — the only step that becomes an explicit `page.goto(...)` in codegen. */
  startUrl: string;
}

/** A raw capture event, as built by the extension's DOM listeners — one per meaningful browser event, before coalescing. */
export interface RawCaptureEvent {
  kind: 'click' | 'input' | 'change' | 'keydown' | 'navigate';
  target: RecordedTarget | null;
  /** Current field value (input/change), the key pressed (keydown), or the new URL (navigate). */
  value: string | null;
  checked: boolean | null;
  inputType: string | null;
  isPasswordField: boolean;
  pageUrl: string;
  timestamp: number;
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
 * Coalesce a stream of raw capture events into `RecordedStep`s:
 *  - a burst of `input` events on the same field collapses into one `fill`,
 *    committed once the field changes or the burst ends (the last value
 *    wins);
 *  - `change` on a checkbox/radio becomes `check`/`uncheck` from the
 *    resulting `checked` state, not a raw `click`;
 *  - `change` on a `<select>` becomes `selectOption`;
 *  - `Enter` on a text field becomes `press('Enter')`, and the browser's own
 *    synthetic click on the same element right after it is dropped rather than
 *    recorded a second time;
 *  - a plain `click` becomes a `click` step;
 *  - `navigate` events become `goto` steps only for the session's very first
 *    page — later navigations are implied by the click/press that caused
 *    them and are dropped (they still update `pageUrl` on later steps via
 *    the caller passing the current page's URL on each event).
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
  } | null = null;
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
    });
    pendingFill = null;
  }

  for (const ev of events) {
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
      };
      continue;
    }

    if (ev.kind === 'keydown') {
      if (ev.value !== 'Enter') continue;
      // Enter commits whatever field was mid-fill, then replaces the click that would otherwise follow it.
      flushPendingFill();
      steps.push({
        action: 'press',
        target: ev.target,
        value: 'Enter',
        redacted: false,
        pageUrl: ev.pageUrl,
        timestamp: ev.timestamp,
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
        });
        continue;
      }
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
      });
      continue;
    }
  }

  flushPendingFill();
  return steps.map((s) =>
    s.target ? { ...s, target: { ...s.target, text: s.target.text ? normalizeText(s.target.text) : null } } : s,
  );
}

/** Builds a `RecordedSession` from a flat step list — `startUrl` is the first step's page, or the first `goto`'s value. */
export function buildSession(steps: RecordedStep[], startedAt: number): RecordedSession {
  const firstGoto = steps.find((s) => s.action === 'goto');
  const startUrl = firstGoto?.value ?? steps[0]?.pageUrl ?? '';
  return { steps, startedAt, startUrl };
}
