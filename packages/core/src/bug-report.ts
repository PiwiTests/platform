/**
 * A bug report: the steps that lead to a bug, the assertion that states the
 * correct behavior, and the evidence collected from the page while it was
 * recorded.
 *
 * The steps are an ordinary steps document (`steps.ts`) whose `assert` steps
 * carry the expected value and the value the page showed. Everything else is
 * evidence for a person to read: console errors and warnings, failed requests
 * (method, path with query values removed, status; never a body), screenshots
 * by file name, and an outline of the page. `renderBugMarkdown` writes the
 * report for an issue or a chat message; `renderBugSpec` writes the failing
 * test with the converter.
 */
import { fileNames, renderSpec, type CodegenOptions, type CodegenResult } from './codegen';
import { normalizeRoute, pageKey } from './page-key';
import type { RecordedStep, RecordedTarget, StepAssertion } from './recording';
import { parseSteps, sessionFromSteps, type PiwiSteps } from './steps';
import {
  bugPhrases,
  markdownCode as code,
  type BugExpectation,
  type BugPhrases,
  type BugStepValue,
  type BugSubject,
} from './bug-phrases';

const ENGLISH = bugPhrases('en');

export const BUG_REPORT_VERSION = 1;

/** What a report keeps of each kind of evidence. */
export const BUG_EVIDENCE_LIMITS = {
  console: 100,
  requests: 100,
  screenshots: 3,
  outlineLines: 400,
  /** Characters kept of one console message. */
  messageLength: 500,
} as const;

export interface BugConsoleEntry {
  level: 'error' | 'warn';
  /** `console` for a call to `console.error`/`console.warn`, `error` for an uncaught error, `rejection` for an unhandled rejection. */
  source: 'console' | 'error' | 'rejection';
  message: string;
  /** The page it happened on, as a path. */
  page: string;
  time: number;
}

export interface BugFailedRequest {
  method: string;
  /** The request's path with query values removed; prefixed with its origin when that is not the page's. */
  url: string;
  /** The status the server answered with, or 0 when there was no answer. */
  status: number;
  page: string;
  time: number;
}

export interface BugScreenshot {
  /** File name inside the report's archive, such as `screenshots/1-marked.png`. */
  file: string;
  /** The step it was taken after (0-based), or null when taken at another moment. */
  step: number | null;
  /** What it shows: `marked` (a step marked as wrong), `finish` or `manual`. */
  moment: 'marked' | 'finish' | 'manual';
  takenAt: number;
}

export interface BugEvidence {
  console: BugConsoleEntry[];
  /** Entries past the limit, counted but not kept. */
  consoleDropped: number;
  requests: BugFailedRequest[];
  requestsDropped: number;
  screenshots: BugScreenshot[];
  /** Why a screenshot is missing, when one is. */
  screenshotNote: string | null;
  /** An outline of the page in the YAML form of an ARIA snapshot, built by the extension; not Playwright's snapshot. */
  outline: string | null;
}

export interface BugContext {
  origin: string | null;
  /** The page key of the page the report was finished on. */
  pageKey: string | null;
  path: string | null;
  browser: string | null;
  userAgent: string | null;
  viewport: { width: number; height: number } | null;
  time: number;
  extensionVersion: string | null;
}

export interface BugReport {
  v: typeof BUG_REPORT_VERSION;
  steps: PiwiSteps;
  evidence: BugEvidence;
  context: BugContext;
}

export function emptyBugEvidence(): BugEvidence {
  return {
    console: [],
    consoleDropped: 0,
    requests: [],
    requestsDropped: 0,
    screenshots: [],
    screenshotNote: null,
    outline: null,
  };
}

/**
 * A request URL as a report keeps it: `normalizeRoute`'s path, with ids and
 * tokens collapsed and query values removed, and no fragment. A request to
 * another origin keeps that origin in front.
 */
export function reportedRequestUrl(url: string, pageUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url, pageUrl);
  } catch {
    return url.split(/[?#]/)[0]!.slice(0, BUG_EVIDENCE_LIMITS.messageLength);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return `${parsed.protocol}…`;
  let pageOrigin: string | null = null;
  try {
    pageOrigin = new URL(pageUrl).origin;
  } catch {
    pageOrigin = null;
  }
  const route = normalizeRoute(parsed.href);
  return parsed.origin === pageOrigin ? route : `${parsed.origin}${route}`;
}

/** The browser and major version a user agent names, such as `Chrome 141`. */
export function describeBrowser(userAgent: string): string | null {
  const patterns: Array<[string, RegExp]> = [
    ['Edge', /\bEdg\/(\d+)/],
    ['Opera', /\bOPR\/(\d+)/],
    ['Firefox', /\bFirefox\/(\d+)/],
    ['Chrome', /\b(?:Headless)?Chrome\/(\d+)/],
    ['Safari', /\bVersion\/(\d+)[^ ]* Safari\//],
  ];
  for (const [name, re] of patterns) {
    const m = re.exec(userAgent);
    if (m) return `${name} ${m[1]}`;
  }
  return null;
}

/** The report's title, or one made from the page it is about, in the phrasebook's language. */
export function bugTitle(report: BugReport, phrases: BugPhrases = ENGLISH): string {
  const title = report.steps.title?.trim();
  if (title) return title;
  return report.context.pageKey ? phrases.report.titleOnPage(report.context.pageKey) : phrases.report.untitled;
}

/** The steps that state what should happen instead. */
export function expectedSteps(report: BugReport): Array<{ index: number; step: RecordedStep }> {
  return report.steps.steps.flatMap((step, index) =>
    step.action === 'assert' && step.assertion ? [{ index, step }] : [],
  );
}

/**
 * The failing test for a report, written to be committed: `test.fail()` so the
 * suite stays green while the bug exists, the `@bug` tag, relative URLs (the
 * project's `baseURL` applies), stable locators and a URL check after each
 * navigation. `options` adds to or overrides these, such as a `testImport`.
 */
export function renderBugSpec(report: BugReport, options: CodegenOptions = {}): CodegenResult {
  const title = bugTitle(report);
  return renderSpec(sessionFromSteps(report.steps), {
    title: `bug: ${title.charAt(0).toLowerCase()}${title.slice(1)}`,
    urls: 'relative',
    locators: 'stable',
    urlChecks: true,
    expectFail: { reason: 'passes while the bug exists; remove this line with the fix' },
    tags: ['@bug'],
    ...options,
  });
}

/** What a Playwright run of a report's spec left behind: the test's status and where it failed. */
export interface SpecRunResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  /** The spec's line the error points at, when the error names one. */
  line: number | null;
  /** The error's message, when the test failed. */
  message: string | null;
}

export type SpecRunVerdict =
  | { kind: 'reproduced'; step: number; found: string | null }
  | { kind: 'not-reproduced' }
  | { kind: 'diverged'; step: number; reason: string }
  | { kind: 'completed' }
  | { kind: 'stopped' };

/** Terminal color codes, such as the ones Playwright puts in its error messages. */
const ANSI_CODES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** The step a spec line belongs to: the last one starting on or before it. */
function stepAtLine(stepLines: number[], line: number): number {
  let step = 0;
  for (let i = 0; i < stepLines.length; i++) if (stepLines[i]! <= line) step = i;
  return step;
}

/**
 * The verdict of a Playwright run of a report's spec (rendered without
 * `test.fail()`), read as Replay reads its own: failing on an expected result
 * is the bug showing, failing on any other step means the page differs there,
 * and passing means it did not show. `stepLines` is the rendering's
 * `CodegenResult.stepLines`.
 */
export function specRunVerdict(steps: RecordedStep[], stepLines: number[], result: SpecRunResult): SpecRunVerdict {
  if (result.status === 'skipped' || result.status === 'interrupted') return { kind: 'stopped' };
  if (result.status === 'passed') {
    return steps.some((s) => s.action === 'assert' || s.action === 'assertVisible')
      ? { kind: 'not-reproduced' }
      : { kind: 'completed' };
  }
  // Playwright colors parts of a message whatever the environment asks.
  const message = (result.message ?? '').replace(ANSI_CODES, '');
  const step = result.line == null ? Math.max(0, steps.length - 1) : stepAtLine(stepLines, result.line);
  const action = steps[step]?.action;
  if (result.line != null && (action === 'assert' || action === 'assertVisible')) {
    const found = /Received(?: string| value)?:\s*(.+)/.exec(message)?.[1]?.trim() ?? null;
    return { kind: 'reproduced', step, found };
  }
  const reason =
    message
      .split('\n')
      .find((l) => l.trim())
      ?.trim() ?? result.status;
  return { kind: 'diverged', step, reason };
}

/** Free text on one line, with the characters that would open HTML escaped. */
function line(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/</g, '&lt;').trim();
}

/**
 * How a report names an element: its role and name, its test id, its text, or
 * its tag. `byText: false` leaves out the names that come from its text, for an
 * assertion about that text: "Total: 50" should read "Total: 45" names the
 * element by the very value that is wrong.
 */
function subjectOf(target: RecordedTarget | null, byText = true): BugSubject {
  if (!target) return { kind: 'page' };
  const locator = target.alternatives[0]?.locator;
  if (!byText) {
    if (target.testId) return { kind: 'testId', testId: target.testId };
    if (locator) return { kind: 'locator', locator };
    return { kind: 'element', role: target.role, tagName: target.tagName, definite: true };
  }
  if (target.role && target.accessibleName)
    return { kind: 'named', role: target.role, name: line(target.accessibleName) };
  if (target.accessibleName) return { kind: 'name', name: line(target.accessibleName) };
  if (target.testId) return { kind: 'testId', testId: target.testId };
  if (target.text)
    return { kind: 'text', role: target.role, tagName: target.tagName, text: line(target.text.slice(0, 80)) };
  if (locator) return { kind: 'locator', locator };
  return { kind: 'element', role: target.role, tagName: target.tagName, definite: false };
}

function expectationOf(a: StepAssertion): BugExpectation {
  const expected = a.expected ?? '';
  switch (a.matcher) {
    case 'toHaveText':
      return { matcher: 'text', expected: line(expected) };
    case 'toHaveValue':
      return { matcher: 'value', expected: line(expected) };
    case 'toHaveAccessibleName':
      return { matcher: 'name', expected: line(expected) };
    case 'toHaveURL':
      return { matcher: 'url', expected };
    case 'toBeHidden':
      return { matcher: 'state', state: 'hidden' };
    case 'toBeEnabled':
      return { matcher: 'state', state: 'enabled' };
    case 'toBeDisabled':
      return { matcher: 'state', state: 'disabled' };
    default:
      return { matcher: 'state', state: 'visible' };
  }
}

/** An expectation in plain words, such as `button "Apply" should read "Total: 42"`, in the phrasebook's language. */
export function describeExpectation(step: RecordedStep, phrases: BugPhrases = ENGLISH): string {
  const a = step.assertion;
  if (!a) return phrases.expectation(subjectOf(step.target), { matcher: 'state', state: 'visible' }, false);
  const byText = a.matcher !== 'toHaveText' && a.matcher !== 'toHaveAccessibleName';
  return phrases.expectation(subjectOf(step.target, byText), expectationOf(a), !!a.negated);
}

/** A step in plain words, for a person reproducing it by hand, in the phrasebook's language. */
export function describeStepInWords(step: RecordedStep, phrases: BugPhrases = ENGLISH): string {
  const target = subjectOf(step.target);
  const value: BugStepValue = step.redacted ? { kind: 'password' } : { kind: 'text', text: line(step.value ?? '') };
  switch (step.action) {
    case 'goto':
      return phrases.steps.goto(step.value ?? step.pageUrl);
    case 'click':
      return phrases.steps.click(target);
    case 'hover':
      return phrases.steps.hover(target);
    case 'fill':
      return phrases.steps.fill(target, value);
    case 'check':
      return phrases.steps.check(target);
    case 'uncheck':
      return phrases.steps.uncheck(target);
    case 'selectOption':
      return phrases.steps.selectOption(target, value);
    case 'press':
      return phrases.steps.press(step.value ?? 'Enter', step.target ? target : null);
    case 'dblclick':
      return phrases.steps.dblclick(target);
    case 'setInputFiles':
      return phrases.steps.setInputFiles(target, fileNames(step.value));
    case 'dragTo':
      return phrases.steps.dragTo(target, subjectOf(step.dropTarget ?? null));
    case 'assertVisible':
    case 'assert':
      return phrases.capitalize(describeExpectation(step, phrases));
  }
}

function formatTime(time: number): string {
  if (!Number.isFinite(time) || time <= 0) return '';
  return `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function clockTime(time: number): string {
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString().slice(11, 19) : '';
}

/** One line summing up the evidence, such as `1 screenshot · 1 console error · 1 failed request · page outline`. */
export function summarizeEvidence(evidence: BugEvidence, phrases: BugPhrases = ENGLISH): string {
  const errors = evidence.console.filter((e) => e.level === 'error').length;
  return phrases.evidence({
    screenshots: evidence.screenshots.length,
    consoleErrors: errors,
    consoleWarnings: evidence.console.length - errors,
    failedRequests: evidence.requests.length,
    outline: !!evidence.outline,
  });
}

/**
 * The report as Markdown, in the phrasebook's language: the steps in plain
 * words, what should happen and what happened, the notes, and the evidence.
 * Screenshots are named by their file in the report's archive; the outline is
 * included in full. The reporter's own words (title, notes, typed values) and
 * the page's texts stay as they are.
 */
export function renderBugMarkdown(report: BugReport, phrases: BugPhrases = ENGLISH): string {
  const { steps: doc, evidence, context } = report;
  const words = phrases.report;
  const out: string[] = [`# ${line(bugTitle(report, phrases))}`, ''];
  if (doc.note?.trim()) out.push(line(doc.note), '');

  const facts = [
    context.path
      ? context.origin
        ? words.pathOn(code(context.path), context.origin)
        : code(context.path)
      : context.origin,
    context.browser,
    context.viewport ? `${context.viewport.width}×${context.viewport.height}` : null,
    formatTime(context.time),
    context.extensionVersion ? `Piwi Picker ${context.extensionVersion}` : null,
  ].filter((f): f is string => !!f);
  if (facts.length > 0) out.push(`${words.pageLabel} ${facts.join(' · ')}`, '');

  out.push(`## ${words.stepsHeading}`, '');
  if (doc.steps.length === 0) out.push(words.noSteps);
  doc.steps.forEach((step, i) => {
    out.push(`${i + 1}. ${describeStepInWords(step, phrases)}`);
    const a = step.action === 'assert' ? step.assertion : undefined;
    if (a?.actual != null && a.actual !== a.expected) out.push(`   - ${words.actual(phrases.quote(line(a.actual)))}`);
    if (a?.note?.trim()) out.push(`   - ${words.note(line(a.note))}`);
  });
  out.push('');

  const expectations = expectedSteps(report);
  out.push(`## ${words.expectedHeading}`, '');
  if (expectations.length === 0) {
    out.push(words.nothingMarked);
  } else {
    for (const { index, step } of expectations) {
      const a = step.assertion!;
      const actual = a.actual != null ? phrases.quote(line(a.actual)) : null;
      out.push(`- ${words.expectedLine(index + 1, describeExpectation(step, phrases), actual)}`);
    }
  }
  out.push('');

  out.push(`## ${words.evidenceHeading}`, '', summarizeEvidence(evidence, phrases), '');
  if (evidence.screenshots.length > 0) {
    out.push(`### ${words.screenshotsHeading}`, '');
    for (const shot of evidence.screenshots) {
      const when =
        shot.moment === 'marked' && shot.step != null
          ? words.screenshotAfterStep(shot.step + 1)
          : shot.moment === 'finish'
            ? words.screenshotAtFinish
            : words.screenshotByHand;
      out.push(`- ${code(shot.file)}, ${when}`);
    }
    out.push('');
  } else if (evidence.screenshotNote) {
    out.push(words.noScreenshot(line(evidence.screenshotNote)), '');
  }
  if (evidence.console.length > 0) {
    const total = evidence.consoleDropped ? evidence.console.length + evidence.consoleDropped : null;
    out.push(`### ${words.consoleHeading(evidence.console.length, total)}`, '');
    for (const e of evidence.console) {
      const entry = { level: e.level, source: e.source, page: code(e.page), time: clockTime(e.time) };
      out.push(`- ${words.consoleLine({ ...entry, message: code(line(e.message)) })}`);
    }
    out.push('');
  }
  if (evidence.requests.length > 0) {
    const total = evidence.requestsDropped ? evidence.requests.length + evidence.requestsDropped : null;
    out.push(`### ${words.requestsHeading(evidence.requests.length, total)}`, '');
    for (const r of evidence.requests) {
      const request = code(`${r.method} ${r.url}`);
      out.push(`- ${words.requestLine({ request, status: r.status, page: code(r.page), time: clockTime(r.time) })}`);
    }
    out.push('');
  }
  if (evidence.outline) {
    const fence = evidence.outline.includes('```') ? '~~~~' : '```';
    out.push(`### ${words.outlineHeading}`, '', words.outlineNote, '', `${fence}yaml`, evidence.outline, fence, '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/** The context of a page, from what a content script can read. */
export function bugContextFrom(input: {
  url: string;
  userAgent: string | null;
  viewport: { width: number; height: number } | null;
  time: number;
  extensionVersion: string | null;
}): BugContext {
  let origin: string | null = null;
  let path: string | null = null;
  try {
    const parsed = new URL(input.url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      origin = parsed.origin;
      path = parsed.pathname;
    }
  } catch {
    // Not a URL: no origin and no path.
  }
  return {
    origin,
    pageKey: pageKey(input.url),
    path,
    browser: input.userAgent ? describeBrowser(input.userAgent) : null,
    userAgent: input.userAgent,
    viewport: input.viewport,
    time: input.time,
    extensionVersion: input.extensionVersion,
  };
}

export type ParseBugReportResult = { ok: true; report: BugReport } | { ok: false; errors: string[] };

const SCREENSHOT_FILE = /^screenshots\/[1-9]-(marked|finish|manual)\.png$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function textOf(v: unknown, max: number): string | null {
  return typeof v === 'string' ? v.slice(0, max) : null;
}

function numberOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function pathOf(v: unknown): string {
  return textOf(v, BUG_EVIDENCE_LIMITS.messageLength) ?? '';
}

function checkConsole(v: unknown): BugConsoleEntry | null {
  if (!isRecord(v)) return null;
  const level = v.level === 'warn' ? 'warn' : v.level === 'error' ? 'error' : null;
  const source = v.source === 'error' || v.source === 'rejection' || v.source === 'console' ? v.source : null;
  if (!level || !source) return null;
  return {
    level,
    source,
    message: textOf(v.message, BUG_EVIDENCE_LIMITS.messageLength) ?? '',
    page: pathOf(v.page),
    time: numberOf(v.time),
  };
}

function checkRequest(v: unknown): BugFailedRequest | null {
  if (!isRecord(v) || typeof v.method !== 'string' || typeof v.url !== 'string') return null;
  const method = v.method.toUpperCase();
  if (!/^[A-Z]{1,16}$/.test(method)) return null;
  const status = numberOf(v.status);
  return {
    method,
    url: pathOf(v.url),
    status: Number.isInteger(status) && status >= 0 && status < 1000 ? status : 0,
    page: pathOf(v.page),
    time: numberOf(v.time),
  };
}

function checkScreenshot(v: unknown): BugScreenshot | null {
  if (!isRecord(v) || typeof v.file !== 'string' || !SCREENSHOT_FILE.test(v.file)) return null;
  const moment = v.moment === 'finish' || v.moment === 'manual' ? v.moment : 'marked';
  const step = typeof v.step === 'number' && Number.isInteger(v.step) && v.step >= 0 ? v.step : null;
  return { file: v.file, step, moment, takenAt: numberOf(v.takenAt) };
}

function listOf<T>(v: unknown, limit: number, check: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, limit).flatMap((entry) => {
    const checked = check(entry);
    return checked ? [checked] : [];
  });
}

function checkEvidence(v: unknown): BugEvidence {
  if (!isRecord(v)) return emptyBugEvidence();
  const outline = textOf(v.outline, 200_000);
  return {
    console: listOf(v.console, BUG_EVIDENCE_LIMITS.console, checkConsole),
    consoleDropped: Math.max(0, Math.floor(numberOf(v.consoleDropped))),
    requests: listOf(v.requests, BUG_EVIDENCE_LIMITS.requests, checkRequest),
    requestsDropped: Math.max(0, Math.floor(numberOf(v.requestsDropped))),
    screenshots: listOf(v.screenshots, BUG_EVIDENCE_LIMITS.screenshots, checkScreenshot),
    screenshotNote: textOf(v.screenshotNote, BUG_EVIDENCE_LIMITS.messageLength),
    outline: outline ? outline.split('\n').slice(0, BUG_EVIDENCE_LIMITS.outlineLines).join('\n') : null,
  };
}

function checkContext(v: unknown): BugContext {
  const c = isRecord(v) ? v : {};
  const viewport = isRecord(c.viewport)
    ? {
        width: Math.max(0, Math.floor(numberOf(c.viewport.width))),
        height: Math.max(0, Math.floor(numberOf(c.viewport.height))),
      }
    : null;
  let origin: string | null = null;
  if (typeof c.origin === 'string') {
    try {
      const parsed = new URL(c.origin);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.origin === c.origin)
        origin = c.origin;
    } catch {
      origin = null;
    }
  }
  const path = textOf(c.path, BUG_EVIDENCE_LIMITS.messageLength);
  return {
    origin,
    pageKey: textOf(c.pageKey, BUG_EVIDENCE_LIMITS.messageLength),
    path: path && path.startsWith('/') ? path : null,
    browser: textOf(c.browser, 60),
    userAgent: textOf(c.userAgent, BUG_EVIDENCE_LIMITS.messageLength),
    viewport,
    time: numberOf(c.time),
    extensionVersion: textOf(c.extensionVersion, 40),
  };
}

/**
 * Reads a bug report from outside (a request, a file): the steps through
 * `parseSteps`, and the evidence and context field by field, with every list
 * and text capped. Evidence that does not fit its shape is dropped rather
 * than refused; steps that do not are refused.
 */
export function parseBugReport(input: unknown): ParseBugReportResult {
  let value = input;
  if (typeof input === 'string') {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, errors: ['not valid JSON'] };
    }
  }
  if (!isRecord(value)) return { ok: false, errors: ['a bug report must be a JSON object'] };
  if (value.v !== BUG_REPORT_VERSION) {
    return { ok: false, errors: [`v: this reads version ${BUG_REPORT_VERSION}, not ${JSON.stringify(value.v)}`] };
  }
  const steps = parseSteps(value.steps);
  if (!steps.ok) return { ok: false, errors: steps.errors.map((e) => `steps.${e}`) };
  return {
    ok: true,
    report: {
      v: BUG_REPORT_VERSION,
      steps: steps.steps,
      evidence: checkEvidence(value.evidence),
      context: checkContext(value.context),
    },
  };
}
