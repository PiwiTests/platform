import { describe, test, expect } from 'vitest';
import { isScreenshotFileRow } from '~~/server/utils/case-screenshots';
import { isScreenshotFileRow as sharedPredicate } from '#shared/file-classify';

/**
 * `selectCaseScreenshots` filters rows with the shared predicate, and server
 * code reaches it through this re-export. The predicate's own behavior is
 * covered in `file-classify.test.ts`.
 */
describe('case-screenshots', () => {
  test('re-exports the shared screenshot predicate', () => {
    expect(isScreenshotFileRow).toBe(sharedPredicate);
    expect(
      isScreenshotFileRow({ type: 'attachment', subtype: 'screenshot', label: 'image/png', path: 'x/a.png' }),
    ).toBe(true);
  });
});
