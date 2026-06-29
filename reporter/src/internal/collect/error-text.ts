import * as path from 'node:path';
import type { TestResult } from '@playwright/test/reporter';

/**
 * Build the stored error text for a test result.
 *
 * Playwright's `error.message` carries the failure message and call log but no
 * stack frames — those live on `error.stack`/`error.location`. The server's
 * locator-healing lookup needs the failing call site to find the pre-captured
 * snapshot for that locator, so when the message has no `at …` frame we append
 * a synthetic one from `error.location`, relativized to the cwd so it matches
 * the format the fixture records at capture time. The frame is appended after
 * the message, where `extractMessageHead` already trims it off before
 * fingerprinting — so failure clustering is unaffected.
 */
export function buildErrorText(result: TestResult): string | null {
  const err = result.error;
  if (!err) return null;
  let text = err.message ?? '';
  const loc = err.location;
  if (loc?.file && !/\n\s+at\s/.test(text)) {
    const rel = path.relative(process.cwd(), loc.file).split(path.sep).join('/');
    text += `\n    at ${rel}:${loc.line}:${loc.column}`;
  }
  return text;
}
