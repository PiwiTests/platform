import { BUG_REPORT_FILES, bugReportFromFiles } from '@piwitests/core/bug-report';
import { parseSteps, type PiwiSteps } from '@piwitests/core/steps';
import { t } from '../shared/i18n.js';
import type { ReplayStepView } from '../shared/step-views.js';
import { readZipEntry } from '../shared/zip.js';

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The screenshot of each step a bug report archive holds, as its evidence
 * names them; none when its evidence cannot be read.
 */
async function stepViewsOf(bytes: Uint8Array, steps: string, stepCount: number): Promise<ReplayStepView[]> {
  const evidence = await readZipEntry(bytes, BUG_REPORT_FILES.evidence);
  if (!evidence) return [];
  const report = bugReportFromFiles({ steps, evidence: new TextDecoder().decode(evidence) });
  if (!report.ok) return [];
  const views: ReplayStepView[] = [];
  for (const shot of report.report.evidence.stepShots ?? []) {
    if (shot.step >= stepCount) continue;
    const image = await readZipEntry(bytes, shot.file);
    if (!image) continue;
    views.push({
      step: shot.step,
      dataUrl: `data:image/jpeg;base64,${base64(image)}`,
      box: shot.box,
      viewport: shot.viewport,
    });
  }
  return views;
}

/**
 * The steps inside a file someone chose, a steps document or the bug report
 * archive that holds one as `steps.json`, and the screenshot of each step the
 * archive holds.
 */
export async function readReportFile(
  name: string,
  bytes: Uint8Array,
): Promise<{ steps: PiwiSteps; views: ReplayStepView[] }> {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let text: string;
  if (isZip) {
    const entry = await readZipEntry(bytes, BUG_REPORT_FILES.steps);
    if (!entry) throw new Error(t('replay_zipNoSteps', { file: name }));
    text = new TextDecoder().decode(entry);
  } else {
    text = new TextDecoder().decode(bytes);
  }
  const parsed = parseSteps(text);
  if (!parsed.ok) throw new Error(t('replay_fileNotSteps', { file: name, error: parsed.errors[0] ?? '' }));
  const views = isZip ? await stepViewsOf(bytes, text, parsed.steps.steps.length) : [];
  return { steps: parsed.steps, views };
}

/** The steps inside a file someone chose; see {@link readReportFile}. */
export async function readStepsFile(name: string, bytes: Uint8Array): Promise<PiwiSteps> {
  return (await readReportFile(name, bytes)).steps;
}
