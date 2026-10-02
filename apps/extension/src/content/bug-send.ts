import type { BugReport } from '@piwitests/core/bug-report';
import type { RecordedStep, RecordedTarget } from '@piwitests/core/recording';
import type { StoredBugScreenshot } from '../shared/bug-storage.js';
import { screenshotFile } from './bug-report-files.js';

/** What the reporter ticked in the Send to Piwi preview: one box per kind of evidence, and the typed values. */
export interface SendChoices {
  screenshots: boolean;
  /** The screenshot of each step. */
  stepShots: boolean;
  console: boolean;
  requests: boolean;
  outline: boolean;
  /** Leave the typed values out of the steps; the rendered test then reads them from environment variables. */
  leaveOutValues: boolean;
}

export function defaultSendChoices(): SendChoices {
  return { screenshots: true, stepShots: true, console: true, requests: true, outline: true, leaveOutValues: false };
}

/** The screenshot note a report carries when the reporter left its screenshots out. */
export const SCREENSHOTS_LEFT_OUT = 'left out by the reporter';

/** What replaces a typed value the reporter left out, wherever the evidence repeats it. */
export const LEFT_OUT_VALUE = '…';

/**
 * A typed value shorter than this is taken out only where it is a whole part
 * (a field's text, a URL's segment or query value, an outline's value), never
 * from inside other text: "0" would make "Error 500" read "Error 5…".
 */
const MIN_SCRUBBED_LENGTH = 3;

/** A value as a locator quotes it, inside its single quotes: the chain's grammar or the probe's escapes. */
function locatorForms(value: string): string[] {
  const json = JSON.stringify(value).slice(1, -1);
  return [json.replace(/\\"/g, '"').replace(/'/g, "\\'"), value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")];
}

/** Each form a typed value takes in a report's text: as typed, quoted in JSON or in a locator, and in a URL. */
function writtenForms(value: string): string[] {
  const component = encodeURIComponent(value);
  return [
    value,
    JSON.stringify(value).slice(1, -1),
    ...locatorForms(value),
    component,
    component.replace(/%20/g, '+'),
    new URLSearchParams([['', value]]).toString().slice(1),
    encodeURI(value),
  ];
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function decodeUrlPart(part: string): string {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '));
  } catch {
    return part;
  }
}

interface Scrubber {
  /** Free text: every form of each value, the longest first, so a value inside another goes with it. */
  text(text: string): string;
  /** A field's whole text, such as an element's name. */
  whole(text: string): string;
  /** A locator, whose quoted strings are whole texts. */
  locator(text: string): string;
  /** A URL or a path. */
  url(text: string): string;
  /** An outline, whose fields end their line with their value. */
  outline(text: string): string;
}

function scrubber(values: string[]): Scrubber {
  const forms = [...new Set(values.filter((v) => v.length >= MIN_SCRUBBED_LENGTH).flatMap(writtenForms))].sort(
    (a, b) => b.length - a.length,
  );
  const pattern = forms.length > 0 ? new RegExp(forms.map(escapeRegExp).join('|'), 'g') : null;
  const short = [...new Set(values.filter((v) => v.length < MIN_SCRUBBED_LENGTH))];
  const shortSet = new Set(short);
  const shortLine =
    short.length > 0
      ? new RegExp(
          `^(.*): (?:${short
            .flatMap((v) => [v, JSON.stringify(v)])
            .map(escapeRegExp)
            .join('|')})$`,
          'gm',
        )
      : null;
  const shortQuoted =
    short.length > 0 ? new RegExp(`'(?:${short.flatMap(locatorForms).map(escapeRegExp).join('|')})'`, 'g') : null;
  const text = (input: string) => (pattern ? input.replace(pattern, LEFT_OUT_VALUE) : input);
  return {
    text,
    whole: (input) => (shortSet.has(input) ? LEFT_OUT_VALUE : text(input)),
    locator: (input) => (shortQuoted ? text(input).replace(shortQuoted, `'${LEFT_OUT_VALUE}'`) : text(input)),
    url: (input) =>
      shortSet.size > 0
        ? text(input).replace(/[^/?&=#]+/g, (part) => (shortSet.has(decodeUrlPart(part)) ? LEFT_OUT_VALUE : part))
        : text(input),
    outline: (input) => (shortLine ? text(input).replace(shortLine, `$1: ${LEFT_OUT_VALUE}`) : text(input)),
  };
}

/** A target with the typed values taken out of what names it. */
function scrubTarget(target: RecordedTarget | null | undefined, scrub: Scrubber): RecordedTarget | null {
  if (!target) return null;
  return {
    ...target,
    accessibleName: target.accessibleName == null ? null : scrub.whole(target.accessibleName),
    text: target.text == null ? null : scrub.whole(target.text),
    alternatives: target.alternatives.map((alt) => ({ ...alt, locator: scrub.locator(alt.locator) })),
  };
}

/** A step with the typed values taken out: its own value when it is a fill, and wherever else they show. */
function scrubStep(step: RecordedStep, scrub: Scrubber): RecordedStep {
  const scrubbed: RecordedStep = {
    ...step,
    target: scrubTarget(step.target, scrub),
    pageUrl: scrub.url(step.pageUrl),
    ...(step.action === 'fill' && step.value != null ? { value: null, redacted: true } : {}),
    ...(step.action === 'goto' && step.value != null ? { value: scrub.url(step.value) } : {}),
  };
  if (step.assertion) {
    const { matcher, expected, actual } = step.assertion;
    const field = matcher === 'toHaveURL' ? scrub.url : scrub.whole;
    scrubbed.assertion = {
      ...step.assertion,
      expected: expected == null ? null : field(expected),
      actual: actual == null ? null : field(actual),
    };
  }
  if (step.dropTarget !== undefined) scrubbed.dropTarget = scrubTarget(step.dropTarget, scrub);
  return scrubbed;
}

/**
 * The report exactly as it is sent: the evidence the reporter left out
 * removed, and with `leaveOutValues`, every typed value taken out of the steps
 * and marked redacted, as a password field is, and out of everything else that
 * repeats it: the steps' pages and targets, what an assertion expected or
 * found, the requests, the console, the outline and the context, as typed and
 * in the forms a URL, a locator or JSON writes it in.
 */
export function reportToSend(report: BugReport, choices: SendChoices): BugReport {
  const typed = choices.leaveOutValues
    ? report.steps.steps.flatMap((step) => (step.action === 'fill' && step.value ? [step.value] : []))
    : [];
  const scrub = scrubber(typed);
  const source = report.evidence;
  const evidence = choices.leaveOutValues
    ? {
        ...source,
        console: source.console.map((entry) => ({
          ...entry,
          message: scrub.text(entry.message),
          page: scrub.url(entry.page),
        })),
        requests: source.requests.map((request) => ({
          ...request,
          url: scrub.url(request.url),
          page: scrub.url(request.page),
        })),
        outline: source.outline ? scrub.outline(source.outline) : null,
      }
    : source;
  const steps = choices.leaveOutValues ? report.steps.steps.map((step) => scrubStep(step, scrub)) : report.steps.steps;
  const context = choices.leaveOutValues
    ? {
        ...report.context,
        pageKey: report.context.pageKey == null ? null : scrub.url(report.context.pageKey),
        path: report.context.path == null ? null : scrub.url(report.context.path),
      }
    : report.context;
  return {
    ...report,
    context,
    steps: { ...report.steps, steps },
    evidence: {
      console: choices.console ? evidence.console : [],
      consoleDropped: choices.console ? evidence.consoleDropped : 0,
      requests: choices.requests ? evidence.requests : [],
      requestsDropped: choices.requests ? evidence.requestsDropped : 0,
      screenshots: choices.screenshots ? evidence.screenshots : [],
      screenshotNote:
        choices.screenshots || evidence.screenshots.length === 0 ? evidence.screenshotNote : SCREENSHOTS_LEFT_OUT,
      outline: choices.outline ? evidence.outline : null,
      ...(choices.stepShots && evidence.stepShots?.length ? { stepShots: evidence.stepShots } : {}),
    },
  };
}

/** The step screenshots that go with the report, named as its `evidence.stepShots` names them, without their folder. */
export function stepShotsToSend(
  report: BugReport,
  images: ReadonlyMap<string, string>,
  choices: SendChoices,
): Array<{ name: string; dataUrl: string }> {
  if (!choices.stepShots) return [];
  return (report.evidence.stepShots ?? []).flatMap((shot) => {
    const dataUrl = images.get(shot.file);
    return dataUrl ? [{ name: shot.file.replace(/^steps\//, ''), dataUrl }] : [];
  });
}

/** The screenshots that go with the report, named as its `evidence.screenshots` names them. */
export function screenshotsToSend(
  stored: StoredBugScreenshot[],
  choices: SendChoices,
): Array<{ name: string; dataUrl: string }> {
  if (!choices.screenshots) return [];
  return stored.map((shot, i) => ({
    name: screenshotFile(shot, i).replace(/^screenshots\//, ''),
    dataUrl: shot.dataUrl,
  }));
}
