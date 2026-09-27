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
import { renderSpec, type CodegenOptions, type CodegenResult } from './codegen';
import { normalizeRoute, pageKey } from './page-key';
import type { RecordedStep, RecordedTarget, StepAssertion } from './recording';
import { sessionFromSteps, type PiwiSteps } from './steps';
import { roleWord } from './role-words';

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

/** The report's title, or one made from the page it is about. */
export function bugTitle(report: BugReport): string {
  const title = report.steps.title?.trim();
  if (title) return title;
  return report.context.pageKey ? `Bug on ${report.context.pageKey}` : 'Reported bug';
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

/** Text as an inline code span, with a fence longer than any run of backticks inside. */
function code(s: string): string {
  const longest = Math.max(0, ...[...s.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = s.startsWith('`') || s.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${s}${pad}${fence}`;
}

/** Free text on one line, with the characters that would open HTML escaped. */
function line(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/</g, '&lt;').trim();
}

function quoted(s: string): string {
  return `"${line(s)}"`;
}

/**
 * How a report names an element: its role and name, its test id, its text, or
 * its tag. `byText: false` leaves out the names that come from its text, for an
 * assertion about that text: "Total: 50" should read "Total: 45" names the
 * element by the very value that is wrong.
 */
function describeTarget(target: RecordedTarget | null, byText = true): string {
  if (!target) return 'the page';
  if (!byText) {
    if (target.testId) return `the element with test id ${code(target.testId)}`;
    const locator = target.alternatives[0]?.locator;
    return locator ? code(locator) : `the ${target.role ? roleWord(target.role) : target.tagName || 'element'}`;
  }
  if (target.role && target.accessibleName) return `${roleWord(target.role)} ${quoted(target.accessibleName)}`;
  if (target.accessibleName) return quoted(target.accessibleName);
  if (target.testId) return `the element with test id ${code(target.testId)}`;
  if (target.text) return `${target.role ? roleWord(target.role) : target.tagName} ${quoted(target.text.slice(0, 80))}`;
  const locator = target.alternatives[0]?.locator;
  if (locator) return code(locator);
  return target.role ? roleWord(target.role) : target.tagName || 'an element';
}

function stateWord(matcher: StepAssertion['matcher']): string {
  switch (matcher) {
    case 'toBeVisible':
      return 'visible';
    case 'toBeHidden':
      return 'hidden';
    case 'toBeEnabled':
      return 'enabled';
    case 'toBeDisabled':
      return 'disabled';
    default:
      return '';
  }
}

/** An expectation in plain words, such as `button "Apply" should read "Total: 42"`. */
export function describeExpectation(step: RecordedStep): string {
  const a = step.assertion;
  if (!a) return `${describeTarget(step.target)} should be visible`;
  const should = a.negated ? 'should not' : 'should';
  const subject = describeTarget(step.target, a.matcher !== 'toHaveText' && a.matcher !== 'toHaveAccessibleName');
  const expected = a.expected ?? '';
  switch (a.matcher) {
    case 'toHaveText':
      return `${subject} ${should} read ${quoted(expected)}`;
    case 'toHaveValue':
      return `${subject} ${should} have the value ${quoted(expected)}`;
    case 'toHaveAccessibleName':
      return `${subject} ${should} be named ${quoted(expected)}`;
    case 'toHaveURL':
      return `the page ${should} be ${code(expected)}`;
    default:
      return `${subject} ${should} be ${stateWord(a.matcher)}`;
  }
}

/** A step in plain words, for a person reproducing it by hand. */
export function describeStepInWords(step: RecordedStep): string {
  const target = describeTarget(step.target);
  const value = step.redacted ? 'a password (not recorded)' : quoted(step.value ?? '');
  switch (step.action) {
    case 'goto':
      return `Go to ${code(step.value ?? step.pageUrl)}`;
    case 'click':
      return `Click ${target}`;
    case 'fill':
      return `Fill ${target} with ${value}`;
    case 'check':
      return `Check ${target}`;
    case 'uncheck':
      return `Uncheck ${target}`;
    case 'selectOption':
      return `Select ${value} in ${target}`;
    case 'press':
      return step.target ? `Press ${step.value ?? 'Enter'} in ${target}` : `Press ${step.value ?? 'Enter'}`;
    case 'assertVisible':
    case 'assert': {
      const text = describeExpectation(step);
      return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
    }
  }
}

function formatTime(time: number): string {
  if (!Number.isFinite(time) || time <= 0) return '';
  return `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function clockTime(time: number): string {
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString().slice(11, 19) : '';
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One line summing up the evidence, such as `1 screenshot · 1 console error · 1 failed request · page outline`. */
export function summarizeEvidence(evidence: BugEvidence): string {
  const errors = evidence.console.filter((e) => e.level === 'error').length;
  const warnings = evidence.console.length - errors;
  const parts = [
    evidence.screenshots.length > 0 ? plural(evidence.screenshots.length, 'screenshot') : 'no screenshot',
    ...(errors > 0 ? [plural(errors, 'console error')] : []),
    ...(warnings > 0 ? [plural(warnings, 'console warning')] : []),
    ...(evidence.requests.length > 0 ? [plural(evidence.requests.length, 'failed request')] : []),
    ...(evidence.outline ? ['page outline'] : []),
  ];
  return parts.join(' · ');
}

/**
 * The report as Markdown: the steps in plain words, what should happen and
 * what happened, the notes, and the evidence. Screenshots are named by their
 * file in the report's archive; the outline is included in full.
 */
export function renderBugMarkdown(report: BugReport): string {
  const { steps: doc, evidence, context } = report;
  const out: string[] = [`# ${line(bugTitle(report))}`, ''];
  if (doc.note?.trim()) out.push(line(doc.note), '');

  const facts = [
    context.path ? `${code(context.path)}${context.origin ? ` on ${context.origin}` : ''}` : context.origin,
    context.browser,
    context.viewport ? `${context.viewport.width}×${context.viewport.height}` : null,
    formatTime(context.time),
    context.extensionVersion ? `Piwi Picker ${context.extensionVersion}` : null,
  ].filter((f): f is string => !!f);
  if (facts.length > 0) out.push(`**Page** ${facts.join(' · ')}`, '');

  out.push('## Steps to reproduce', '');
  if (doc.steps.length === 0) out.push('No steps were recorded.');
  doc.steps.forEach((step, i) => {
    out.push(`${i + 1}. ${describeStepInWords(step)}`);
    const a = step.action === 'assert' ? step.assertion : undefined;
    if (a?.actual != null && a.actual !== a.expected) out.push(`   - Actual: ${quoted(a.actual)}`);
    if (a?.note?.trim()) out.push(`   - Note: ${line(a.note)}`);
  });
  out.push('');

  const expectations = expectedSteps(report);
  out.push('## Expected and actual', '');
  if (expectations.length === 0) {
    out.push('Nothing was marked as wrong.');
  } else {
    for (const { index, step } of expectations) {
      const a = step.assertion!;
      const actual = a.actual != null ? ` It shows ${quoted(a.actual)}.` : '';
      out.push(`- Step ${index + 1}: ${describeExpectation(step)}.${actual}`);
    }
  }
  out.push('');

  out.push('## Evidence', '', summarizeEvidence(evidence), '');
  if (evidence.screenshots.length > 0) {
    out.push('### Screenshots', '');
    for (const shot of evidence.screenshots) {
      const when =
        shot.moment === 'marked' && shot.step != null
          ? `after step ${shot.step + 1}`
          : shot.moment === 'finish'
            ? 'when the report was finished'
            : 'taken by hand';
      out.push(`- ${code(shot.file)}, ${when}`);
    }
    out.push('');
  } else if (evidence.screenshotNote) {
    out.push(`No screenshot: ${line(evidence.screenshotNote)}`, '');
  }
  if (evidence.console.length > 0) {
    out.push(
      `### Console (${evidence.console.length}${evidence.consoleDropped ? ` of ${evidence.console.length + evidence.consoleDropped}` : ''})`,
      '',
    );
    for (const e of evidence.console) {
      const origin = e.source === 'console' ? '' : e.source === 'error' ? ' uncaught' : ' unhandled rejection';
      out.push(`- ${e.level}${origin} on ${code(e.page)} at ${clockTime(e.time)}: ${code(line(e.message))}`);
    }
    out.push('');
  }
  if (evidence.requests.length > 0) {
    out.push(
      `### Failed requests (${evidence.requests.length}${evidence.requestsDropped ? ` of ${evidence.requests.length + evidence.requestsDropped}` : ''})`,
      '',
    );
    for (const r of evidence.requests) {
      const status = r.status > 0 ? String(r.status) : 'no answer';
      out.push(`- ${code(`${r.method} ${r.url}`)} → ${status}, on ${code(r.page)} at ${clockTime(r.time)}`);
    }
    out.push('');
  }
  if (evidence.outline) {
    const fence = evidence.outline.includes('```') ? '~~~~' : '```';
    out.push(
      '### Page outline',
      '',
      'Built by Piwi Picker from the page; the YAML form of an ARIA snapshot, not Playwright’s own.',
      '',
      `${fence}yaml`,
      evidence.outline,
      fence,
      '',
    );
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
