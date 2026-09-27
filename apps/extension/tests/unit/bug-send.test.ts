import { describe, expect, test } from 'vitest';
import { BUG_REPORT_VERSION, emptyBugEvidence, parseBugReport, type BugReport } from '@piwitests/core/bug-report';
import {
  defaultSendChoices,
  LEFT_OUT_VALUE,
  reportToSend,
  SCREENSHOTS_LEFT_OUT,
  screenshotsToSend,
} from '../../src/content/bug-send';

function report(): BugReport {
  return {
    v: BUG_REPORT_VERSION,
    steps: {
      v: 1,
      title: 'Coupon',
      origin: 'https://shop.test',
      recordedAt: 1,
      note: null,
      steps: [
        { action: 'goto', target: null, value: '/cart', redacted: false, pageUrl: '/cart', timestamp: 1 },
        { action: 'fill', target: null, value: 'SPRING10', redacted: false, pageUrl: '/cart', timestamp: 2 },
      ],
    },
    evidence: {
      ...emptyBugEvidence(),
      console: [{ level: 'error', source: 'console', message: 'boom', page: '/cart', time: 1 }],
      consoleDropped: 2,
      requests: [{ method: 'POST', url: '/api/coupon', status: 500, page: '/cart', time: 1 }],
      screenshots: [{ file: 'screenshots/1-marked.png', step: 1, moment: 'marked', takenAt: 1 }],
      outline: '- main',
    },
    context: {
      origin: 'https://shop.test',
      pageKey: '/cart',
      path: '/cart',
      browser: null,
      userAgent: null,
      viewport: null,
      time: 1,
      extensionVersion: null,
    },
  };
}

describe('reportToSend', () => {
  test('sends everything by default', () => {
    expect(reportToSend(report(), defaultSendChoices())).toEqual(report());
  });

  test('leaves out each kind the reporter unticked', () => {
    const sent = reportToSend(report(), {
      screenshots: false,
      console: false,
      requests: false,
      outline: false,
      leaveOutValues: false,
    });
    expect(sent.evidence).toEqual({
      console: [],
      consoleDropped: 0,
      requests: [],
      requestsDropped: 0,
      screenshots: [],
      screenshotNote: SCREENSHOTS_LEFT_OUT,
      outline: null,
    });
    expect(parseBugReport(sent).ok).toBe(true);
  });

  test('takes the typed values out of the steps, and out of the evidence that repeats them', () => {
    const typed = report();
    typed.evidence.outline = '- main:\n  - textbox "Coupon": SPRING10';
    typed.evidence.console[0]!.message = 'Coupon SPRING10 failed';
    const sent = reportToSend(typed, { ...defaultSendChoices(), leaveOutValues: true });
    expect(sent.steps.steps[1]).toMatchObject({ action: 'fill', value: null, redacted: true });
    expect(sent.steps.steps[0]!.value).toBe('/cart');
    expect(JSON.stringify(sent)).not.toContain('SPRING10');
    expect(sent.evidence.outline).toBe(`- main:\n  - textbox "Coupon": ${LEFT_OUT_VALUE}`);
  });
});

describe('screenshotsToSend', () => {
  const stored = [{ moment: 'marked' as const, step: 1, takenAt: 1, dataUrl: 'data:image/png;base64,AA==' }];

  test('names each file as the report names it', () => {
    expect(screenshotsToSend(stored, defaultSendChoices())).toEqual([
      { name: '1-marked.png', dataUrl: 'data:image/png;base64,AA==' },
    ]);
    expect(screenshotsToSend(stored, { ...defaultSendChoices(), screenshots: false })).toEqual([]);
  });
});
