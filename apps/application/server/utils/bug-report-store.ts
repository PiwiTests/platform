/**
 * Storing a bug report with its screenshots, whichever way it arrives: sent
 * by Piwi Picker (**Send to Piwi…**), or opened in the desktop app as the
 * `.piwibug` file Piwi Picker saved.
 */
import { BUG_REPORT_FILES, bugReportFromFiles, isBugReportArchive, type BugReport } from '@piwitests/core/bug-report';
import type { DrizzleDB } from '#shared/handlers/db';
import { BUG_REPORT_LIMITS, bugReportStorageDir, deleteBugReport, insertBugReport } from '#shared/handlers/bug-reports';
import { getStorage } from '../storage';
import { apiError } from './api-error';
import { openArchive } from './archive-reader';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(bytes: Buffer): boolean {
  return bytes.subarray(0, 8).equals(PNG_SIGNATURE);
}

/**
 * Stores `report` and the screenshots that came with it, keyed by the file
 * names its evidence gives them (`screenshots/1-marked.png`). A screenshot the
 * evidence names but that did not come is left out of the stored evidence.
 */
export async function storeBugReport(
  db: DrizzleDB,
  input: {
    projectId: number;
    report: BugReport;
    language: string | null;
    createdBy: number | null;
    screenshots: Map<string, Buffer>;
  },
): Promise<{ id: number }> {
  const files = input.report.evidence.screenshots.flatMap((shot) => {
    const bytes = input.screenshots.get(shot.file);
    return bytes ? [{ shot, bytes }] : [];
  });
  const report: BugReport = {
    ...input.report,
    evidence: { ...input.report.evidence, screenshots: files.map((f) => f.shot) },
  };
  const { id } = await insertBugReport(db, {
    projectId: input.projectId,
    report,
    language: input.language,
    createdBy: input.createdBy,
  });
  if (files.length > 0) {
    const storage = getStorage();
    const dir = bugReportStorageDir(id);
    try {
      await storage.mkdir(dir);
      for (const { shot, bytes } of files)
        await storage.writeFile(`${dir}/${shot.file.replace(/^screenshots\//, '')}`, bytes);
    } catch (err) {
      await deleteBugReport(db, id);
      await storage.deleteDirectory(dir).catch(() => undefined);
      throw err;
    }
  }
  return { id };
}

/**
 * The report in a bug report archive, with its PNG screenshots: a `.piwibug`
 * file, told by its first entry, or a zip holding `steps.json` and
 * `evidence.json`. Null when the archive is something else; a 400 when it is
 * a bug report that cannot be read.
 */
export async function readBugReportArchive(
  data: Buffer,
): Promise<{ report: BugReport; screenshots: Map<string, Buffer> } | null> {
  let archive;
  try {
    archive = openArchive(data);
  } catch {
    return null;
  }
  const marked = isBugReportArchive(data);
  if (!marked && !archive.entryNames.includes(BUG_REPORT_FILES.evidence)) return null;
  const steps = await archive.readEntry(BUG_REPORT_FILES.steps);
  if (!steps) {
    if (!marked) return null;
    throw apiError({ statusCode: 400, message: `The bug report has no ${BUG_REPORT_FILES.steps}` });
  }
  const evidence = await archive.readEntry(BUG_REPORT_FILES.evidence);
  if ((evidence?.length ?? 0) > BUG_REPORT_LIMITS.jsonBytes || steps.length > BUG_REPORT_LIMITS.jsonBytes)
    throw apiError({ statusCode: 413, message: 'The report is larger than 1 MB' });
  const parsed = bugReportFromFiles({ steps: steps.toString('utf8'), evidence: evidence?.toString('utf8') ?? null });
  if (!parsed.ok)
    throw apiError({ statusCode: 400, message: `Not a bug report: ${parsed.errors.slice(0, 3).join('; ')}` });
  const screenshots = new Map<string, Buffer>();
  for (const shot of parsed.report.evidence.screenshots) {
    const bytes = await archive.readEntry(shot.file);
    if (bytes && bytes.length <= BUG_REPORT_LIMITS.screenshotBytes && isPng(bytes)) screenshots.set(shot.file, bytes);
  }
  return { report: parsed.report, screenshots };
}
