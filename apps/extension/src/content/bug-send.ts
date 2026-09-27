import type { BugReport } from '@piwitests/core/bug-report';
import type { StoredBugScreenshot } from '../shared/bug-storage.js';
import { screenshotFile } from './bug-report-files.js';

/** What the reporter ticked in the Send to Piwi preview: one box per kind of evidence, and the typed values. */
export interface SendChoices {
  screenshots: boolean;
  console: boolean;
  requests: boolean;
  outline: boolean;
  /** Leave the typed values out of the steps; the rendered test then reads them from environment variables. */
  leaveOutValues: boolean;
}

export function defaultSendChoices(): SendChoices {
  return { screenshots: true, console: true, requests: true, outline: true, leaveOutValues: false };
}

/** The screenshot note a report carries when the reporter left its screenshots out. */
export const SCREENSHOTS_LEFT_OUT = 'left out by the reporter';

/** What replaces a typed value the reporter left out, wherever the evidence repeats it. */
export const LEFT_OUT_VALUE = '…';

/**
 * The report exactly as it is sent: the evidence the reporter left out
 * removed, and with `leaveOutValues`, every typed value taken out of the steps
 * and marked redacted, as a password field is, and out of the evidence that
 * repeats it (a text box's value in the outline, a console message).
 */
export function reportToSend(report: BugReport, choices: SendChoices): BugReport {
  const typed = choices.leaveOutValues
    ? report.steps.steps.flatMap((step) => (step.action === 'fill' && step.value ? [step.value] : []))
    : [];
  const scrub = (text: string) => typed.reduce((out, value) => out.split(value).join(LEFT_OUT_VALUE), text);
  const evidence = typed.length
    ? {
        ...report.evidence,
        console: report.evidence.console.map((entry) => ({ ...entry, message: scrub(entry.message) })),
        outline: report.evidence.outline ? scrub(report.evidence.outline) : null,
      }
    : report.evidence;
  const steps = choices.leaveOutValues
    ? report.steps.steps.map((step) =>
        step.action === 'fill' && step.value != null ? { ...step, value: null, redacted: true } : step,
      )
    : report.steps.steps;
  return {
    ...report,
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
    },
  };
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
