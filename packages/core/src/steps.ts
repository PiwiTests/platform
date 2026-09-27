/**
 * The steps document: the portable form of a recording.
 *
 * A recording leaves the recorder as data, not code: Piwi Picker saves it, and
 * `renderSpec` turns it into a spec for whichever project renders it. URLs on
 * the recorded origin are stored as paths, which is what lets a flow recorded
 * on staging run against another server's `baseURL`.
 *
 * Anything that reads a document from outside (a file) goes through
 * `parseSteps`, which checks every field and every limit and re-renders every
 * locator from its parsed chain, so a document can only ever describe steps.
 */
import { safeLocator } from './codegen';
import {
  ASSERTION_MATCHERS,
  VALUE_MATCHERS,
  type AssertionMatcher,
  type RecordedLocatorAlternative,
  type RecordedSession,
  type RecordedStep,
  type RecordedTarget,
  type StepAction,
  type StepAssertion,
} from './recording';

export const STEPS_VERSION = 1;

/** What a steps document may hold. */
export const STEPS_LIMITS = {
  steps: 200,
  alternatives: 10,
  /** Typed values, expected values, URLs, notes. */
  valueLength: 2000,
  /** Titles, names, texts, locators. */
  textLength: 500,
} as const;

export interface PiwiSteps {
  v: typeof STEPS_VERSION;
  title: string | null;
  /** The origin the steps were recorded on, such as `https://staging.acme.test`; null when there was none. */
  origin: string | null;
  recordedAt: number;
  note: string | null;
  /** The steps, with `pageUrl` and a `goto`'s value as paths whenever they are on `origin`. */
  steps: RecordedStep[];
}

const ACTIONS: ReadonlySet<StepAction> = new Set([
  'goto',
  'click',
  'fill',
  'check',
  'uncheck',
  'selectOption',
  'press',
  'assertVisible',
  'assert',
]);

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

function toPath(url: string, origin: string | null): string {
  if (!origin) return url;
  try {
    const parsed = new URL(url);
    return parsed.origin === origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : url;
  } catch {
    return url;
  }
}

function toAbsolute(url: string, origin: string | null): string {
  return origin && url.startsWith('/') ? `${origin}${url}` : url;
}

/** A recording as a steps document. The recorder's per-page element keys stay behind; they mean nothing outside it. */
export function toStepsDocument(
  session: RecordedSession,
  meta: { title?: string | null; note?: string | null } = {},
): PiwiSteps {
  const origin = originOf(session.startUrl) ?? originOf(session.steps[0]?.pageUrl ?? '');
  return {
    v: STEPS_VERSION,
    title: meta.title ?? null,
    origin,
    recordedAt: session.startedAt,
    note: meta.note ?? null,
    steps: session.steps.map((step) => ({
      ...step,
      target: step.target ? withoutElementKey(step.target) : null,
      pageUrl: toPath(step.pageUrl, origin),
      value: step.action === 'goto' && step.value ? toPath(step.value, origin) : step.value,
    })),
  };
}

function withoutElementKey(target: RecordedTarget): RecordedTarget {
  const { elementKey: _elementKey, ...rest } = target;
  return rest;
}

/** A steps document as a recording on `origin` (the recorded one by default), for `renderSpec` and the function matcher. */
export function sessionFromSteps(doc: PiwiSteps, origin: string | null = doc.origin): RecordedSession {
  const steps = doc.steps.map((step) => ({
    ...step,
    pageUrl: toAbsolute(step.pageUrl, origin),
    value: step.action === 'goto' && step.value ? toAbsolute(step.value, origin) : step.value,
  }));
  const firstGoto = steps.find((s) => s.action === 'goto');
  return { steps, startedAt: doc.recordedAt, startUrl: firstGoto?.value ?? steps[0]?.pageUrl ?? origin ?? '' };
}

export type ParseStepsResult = { ok: true; steps: PiwiSteps } | { ok: false; errors: string[] };

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class Checker {
  readonly errors: string[] = [];

  fail(path: string, message: string): void {
    if (this.errors.length < 20) this.errors.push(`${path}: ${message}`);
  }

  text(v: unknown, path: string, max: number, nullable: boolean): string | null {
    if (v == null) {
      if (!nullable) this.fail(path, 'is required');
      return null;
    }
    if (typeof v !== 'string') {
      this.fail(path, 'must be a string');
      return null;
    }
    if (v.length > max) this.fail(path, `is longer than ${max} characters`);
    return v;
  }

  number(v: unknown, path: string): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.fail(path, 'must be a number');
      return 0;
    }
    return v;
  }
}

function checkTarget(c: Checker, v: unknown, path: string): RecordedTarget | null {
  if (v == null) return null;
  if (!isObject(v)) {
    c.fail(path, 'must be an object');
    return null;
  }
  const alternativesIn = v.alternatives ?? [];
  const alternatives: RecordedLocatorAlternative[] = [];
  if (!Array.isArray(alternativesIn)) c.fail(`${path}.alternatives`, 'must be a list');
  else if (alternativesIn.length > STEPS_LIMITS.alternatives)
    c.fail(`${path}.alternatives`, `holds more than ${STEPS_LIMITS.alternatives}`);
  else {
    alternativesIn.forEach((alt, i) => {
      const at = `${path}.alternatives[${i}]`;
      if (!isObject(alt)) return c.fail(at, 'must be an object');
      const locator = c.text(alt.locator, `${at}.locator`, STEPS_LIMITS.textLength, false);
      const safe = locator ? safeLocator(locator) : null;
      if (locator && !safe) return c.fail(`${at}.locator`, 'is not a Playwright locator chain');
      if (!safe) return;
      alternatives.push({
        locator: safe.text,
        method: safe.chain.calls[safe.chain.calls.length - 1]!.method,
        score: typeof alt.score === 'number' && Number.isFinite(alt.score) ? alt.score : 0,
      });
    });
  }
  return {
    tagName: c.text(v.tagName, `${path}.tagName`, 64, false) ?? '',
    role: c.text(v.role, `${path}.role`, 64, true),
    accessibleName: c.text(v.accessibleName, `${path}.accessibleName`, STEPS_LIMITS.textLength, true),
    testId: c.text(v.testId, `${path}.testId`, STEPS_LIMITS.textLength, true),
    text: c.text(v.text, `${path}.text`, STEPS_LIMITS.textLength, true),
    alternatives,
  };
}

function checkAssertion(c: Checker, v: unknown, path: string): StepAssertion | undefined {
  if (!isObject(v)) {
    c.fail(path, 'is required on an assert step');
    return undefined;
  }
  const matcher = v.matcher as AssertionMatcher;
  if (!ASSERTION_MATCHERS.includes(matcher)) {
    c.fail(`${path}.matcher`, `must be one of ${ASSERTION_MATCHERS.join(', ')}`);
    return undefined;
  }
  const expected = c.text(v.expected, `${path}.expected`, STEPS_LIMITS.valueLength, !VALUE_MATCHERS.has(matcher));
  return {
    matcher,
    expected: VALUE_MATCHERS.has(matcher) ? expected : null,
    actual: c.text(v.actual, `${path}.actual`, STEPS_LIMITS.valueLength, true),
    negated: v.negated === true,
    note: c.text(v.note, `${path}.note`, STEPS_LIMITS.valueLength, true),
  };
}

function checkStep(c: Checker, v: unknown, path: string): RecordedStep | null {
  if (!isObject(v)) {
    c.fail(path, 'must be an object');
    return null;
  }
  const action = v.action as StepAction;
  if (!ACTIONS.has(action)) {
    c.fail(`${path}.action`, 'is not a known action');
    return null;
  }
  // `assertVisible` is the legacy spelling of `assert` with `toBeVisible`.
  const step: RecordedStep = {
    action: action === 'assertVisible' ? 'assert' : action,
    target: checkTarget(c, v.target, `${path}.target`),
    value: c.text(v.value, `${path}.value`, STEPS_LIMITS.valueLength, true),
    redacted: v.redacted === true,
    pageUrl: c.text(v.pageUrl, `${path}.pageUrl`, STEPS_LIMITS.valueLength, false) ?? '',
    timestamp: v.timestamp == null ? 0 : c.number(v.timestamp, `${path}.timestamp`),
  };
  if (step.redacted) step.value = null;
  if (action === 'assertVisible') {
    step.assertion = { matcher: 'toBeVisible', expected: null, actual: null, negated: false, note: null };
  } else if (action === 'assert') {
    step.assertion = checkAssertion(c, v.assertion, `${path}.assertion`);
  }
  return step;
}

/**
 * Read a steps document from JSON text or a parsed value. A recording saved
 * before the format existed (`{ steps, startedAt, startUrl }`) is read too.
 * Returns the document, or every problem found (at most 20).
 */
export function parseSteps(input: unknown): ParseStepsResult {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, errors: ['not valid JSON'] };
    }
  }
  if (!isObject(value)) return { ok: false, errors: ['a steps document must be a JSON object'] };

  const c = new Checker();
  const legacy = value.v == null && typeof value.startUrl === 'string';
  if (!legacy && value.v !== STEPS_VERSION) {
    return { ok: false, errors: [`v: this reads version ${STEPS_VERSION}, not ${JSON.stringify(value.v)}`] };
  }
  if (!Array.isArray(value.steps)) return { ok: false, errors: ['steps: must be a list'] };
  if (value.steps.length > STEPS_LIMITS.steps) {
    return { ok: false, errors: [`steps: holds more than ${STEPS_LIMITS.steps}`] };
  }
  const steps = value.steps.flatMap((s, i) => {
    const step = checkStep(c, s, `steps[${i}]`);
    return step ? [step] : [];
  });

  let doc: PiwiSteps;
  if (legacy) {
    doc = toStepsDocument({
      steps,
      startedAt: typeof value.startedAt === 'number' ? value.startedAt : 0,
      startUrl: value.startUrl as string,
    });
  } else {
    const originText = c.text(value.origin, 'origin', STEPS_LIMITS.textLength, true);
    const origin = originText ? originOf(originText) : null;
    if (originText && !origin) c.fail('origin', 'must be an http(s) origin');
    doc = {
      v: STEPS_VERSION,
      title: c.text(value.title, 'title', STEPS_LIMITS.textLength, true),
      origin,
      recordedAt: value.recordedAt == null ? 0 : c.number(value.recordedAt, 'recordedAt'),
      note: c.text(value.note, 'note', STEPS_LIMITS.valueLength, true),
      steps,
    };
  }
  return c.errors.length > 0 ? { ok: false, errors: c.errors } : { ok: true, steps: doc };
}
