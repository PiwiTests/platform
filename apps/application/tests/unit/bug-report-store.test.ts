import { describe, test, expect } from 'vitest';
import { BUG_REPORT_MEDIA_TYPE, emptyBugEvidence } from '@piwitests/core/bug-report';
import { readBugReportArchive } from '../../server/utils/bug-report-store';
import { buildZip } from '../../server/utils/trace-zip';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const steps = {
  v: 1,
  title: 'Coupon not applied',
  origin: 'https://shop.test',
  recordedAt: 1,
  note: null,
  steps: [{ action: 'goto', target: null, value: '/cart', redacted: false, pageUrl: '/cart', timestamp: 1 }],
};

const evidence = {
  v: 1,
  context: { origin: 'https://shop.test', pageKey: '/cart', path: '/cart', time: 2 },
  evidence: {
    ...emptyBugEvidence(),
    screenshots: [
      { file: 'screenshots/1-marked.png', step: 0, moment: 'marked', takenAt: 2 },
      { file: 'screenshots/2-finish.png', step: null, moment: 'finish', takenAt: 3 },
    ],
    stepShots: [{ step: 0, file: 'steps/001.jpg', box: null, viewport: { width: 800, height: 600 }, takenAt: 2 }],
  },
};

function entry(name: string, data: string | Buffer) {
  return { name, data: typeof data === 'string' ? Buffer.from(data, 'utf8') : data };
}

describe('readBugReportArchive', () => {
  test('reads a .piwibug: the report, and the screenshots that are PNG images', async () => {
    const read = await readBugReportArchive(
      buildZip([
        entry('mimetype', BUG_REPORT_MEDIA_TYPE),
        entry('steps.json', JSON.stringify(steps)),
        entry('coupon-not-applied.spec.ts', 'test()'),
        entry('evidence.json', JSON.stringify(evidence)),
        entry('screenshots/1-marked.png', PNG),
        entry('screenshots/2-finish.png', 'not a png'),
        entry('steps/001.jpg', JPEG),
      ]),
    );
    expect(read?.report.steps.title).toBe('Coupon not applied');
    expect(read?.report.context.pageKey).toBe('/cart');
    expect([...read!.screenshots.keys()]).toEqual(['screenshots/1-marked.png']);
    expect([...read!.stepShots.keys()]).toEqual(['steps/001.jpg']);
  });

  test('reads a zip saved before the media type entry, by its files', async () => {
    const read = await readBugReportArchive(
      buildZip([entry('steps.json', JSON.stringify(steps)), entry('evidence.json', JSON.stringify(evidence))]),
    );
    expect(read?.report.steps.steps).toHaveLength(1);
  });

  test('answers null for any other archive, and refuses a marked one it cannot read', async () => {
    expect(await readBugReportArchive(buildZip([entry('report.jsonl', '{}')]))).toBeNull();
    expect(await readBugReportArchive(buildZip([entry('steps.json', JSON.stringify(steps))]))).toBeNull();
    expect(await readBugReportArchive(Buffer.from('not a zip'))).toBeNull();
    await expect(
      readBugReportArchive(buildZip([entry('mimetype', BUG_REPORT_MEDIA_TYPE), entry('evidence.json', '{}')])),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      readBugReportArchive(
        buildZip([entry('mimetype', BUG_REPORT_MEDIA_TYPE), entry('steps.json', JSON.stringify({ v: 9 }))]),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
