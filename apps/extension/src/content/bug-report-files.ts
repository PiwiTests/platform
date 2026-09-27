import { buildSession, normalizeSteps, type RawCaptureEvent } from '@piwitests/core/recording';
import { toStepsDocument } from '@piwitests/core/steps';
import { bugPhrases, type BugPhrases } from '@piwitests/core/bug-phrases';
import {
  BUG_REPORT_VERSION,
  bugTitle,
  renderBugMarkdown,
  renderBugSpec,
  type BugContext,
  type BugReport,
  type BugScreenshot,
} from '@piwitests/core/bug-report';
import type { StoredBugEvidence, StoredBugScreenshot } from '../shared/bug-storage.js';
import { createZip, dataUrlBytes, type ZipEntry } from '../shared/zip.js';

/** The note a report carries when no screenshot was taken and nothing said why. */
export const NO_SCREENSHOT_TAKEN = 'none was taken';

export function screenshotFile(shot: Pick<StoredBugScreenshot, 'moment'>, index: number): string {
  return `screenshots/${index + 1}-${shot.moment}.png`;
}

/** The report a bug recording makes: its steps as a steps document, its evidence and its context. */
export function assembleBugReport(input: {
  events: RawCaptureEvent[];
  startedAt: number;
  evidence: StoredBugEvidence;
  screenshots: StoredBugScreenshot[];
  context: BugContext;
}): BugReport {
  const { evidence } = input;
  const session = buildSession(normalizeSteps(input.events), input.startedAt);
  const screenshots: BugScreenshot[] = input.screenshots.map((shot, i) => ({
    file: screenshotFile(shot, i),
    step: shot.step,
    moment: shot.moment,
    takenAt: shot.takenAt,
  }));
  return {
    v: BUG_REPORT_VERSION,
    steps: toStepsDocument(session, { title: evidence.title?.trim() || null }),
    evidence: {
      console: evidence.console,
      consoleDropped: evidence.consoleDropped,
      requests: evidence.requests,
      requestsDropped: evidence.requestsDropped,
      screenshots,
      screenshotNote: screenshots.length > 0 ? null : (evidence.screenshotNote ?? NO_SCREENSHOT_TAKEN),
      outline: evidence.outline,
    },
    context: input.context,
  };
}

/** A file name made from the report's title: `coupon-not-applied.spec.ts`. */
export function specFileName(report: BugReport): string {
  const slug = bugTitle(report)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${slug || 'bug'}.spec.ts`;
}

/**
 * The language a report's Markdown is written in: core's phrasebook, and the
 * screenshot note (stored in English) in that language.
 */
export interface ReportLanguage {
  phrases: BugPhrases;
  screenshotNote(note: string): string;
}

export const ENGLISH_REPORT: ReportLanguage = { phrases: bugPhrases('en'), screenshotNote: (note) => note };

/** The report as Markdown, in `language`. The steps document, the spec and the evidence stay as they are stored. */
export function bugReportMarkdown(report: BugReport, language: ReportLanguage = ENGLISH_REPORT): string {
  const note = report.evidence.screenshotNote;
  const evidence = { ...report.evidence, screenshotNote: note ? language.screenshotNote(note) : null };
  return renderBugMarkdown({ ...report, evidence }, language.phrases);
}

/**
 * Every file of the report's archive: the steps document, the failing test,
 * the Markdown in `language`, the evidence with the context, and the screenshots.
 */
export function bugReportEntries(
  report: BugReport,
  screenshots: StoredBugScreenshot[],
  language: ReportLanguage = ENGLISH_REPORT,
): ZipEntry[] {
  return [
    { name: 'steps.json', data: `${JSON.stringify(report.steps, null, 2)}\n` },
    { name: specFileName(report), data: renderBugSpec(report).code },
    { name: 'bug-report.md', data: bugReportMarkdown(report, language) },
    {
      name: 'evidence.json',
      data: `${JSON.stringify({ v: report.v, context: report.context, evidence: report.evidence }, null, 2)}\n`,
    },
    ...screenshots.map((shot, i) => ({ name: screenshotFile(shot, i), data: dataUrlBytes(shot.dataUrl) })),
  ];
}

export function bugReportZip(
  report: BugReport,
  screenshots: StoredBugScreenshot[],
  language: ReportLanguage = ENGLISH_REPORT,
): Uint8Array {
  return createZip(bugReportEntries(report, screenshots, language), new Date(report.context.time || Date.now()));
}
