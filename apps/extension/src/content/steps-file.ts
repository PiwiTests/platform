import { parseSteps, type PiwiSteps } from '@piwitests/core/steps';
import { t } from '../shared/i18n.js';
import { readZipEntry } from '../shared/zip.js';

/**
 * The steps inside a file someone chose: a steps document, or the bug report
 * archive that holds one as `steps.json`.
 */
export async function readStepsFile(name: string, bytes: Uint8Array): Promise<PiwiSteps> {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let text: string;
  if (isZip) {
    const entry = await readZipEntry(bytes, 'steps.json');
    if (!entry) throw new Error(t('replay_zipNoSteps', { file: name }));
    text = new TextDecoder().decode(entry);
  } else {
    text = new TextDecoder().decode(bytes);
  }
  const parsed = parseSteps(text);
  if (!parsed.ok) throw new Error(t('replay_fileNotSteps', { file: name, error: parsed.errors[0] ?? '' }));
  return parsed.steps;
}
