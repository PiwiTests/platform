import { parseSteps, type PiwiSteps } from '@piwitests/core/steps';
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
    if (!entry) throw new Error(`${name} has no steps.json: choose the .zip Piwi Picker saved, or its steps.json.`);
    text = new TextDecoder().decode(entry);
  } else {
    text = new TextDecoder().decode(bytes);
  }
  const parsed = parseSteps(text);
  if (!parsed.ok) throw new Error(`${name} is not a steps file: ${parsed.errors[0]}`);
  return parsed.steps;
}
