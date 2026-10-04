import { describe, expect, test } from 'vitest';
import { BUG_REPORT_VERSION, emptyBugEvidence, parseBugReport, type BugReport } from '@piwitests/core/bug-report';
import {
  defaultSendChoices,
  LEFT_OUT_VALUE,
  reportToSend,
  SCREENSHOTS_LEFT_OUT,
  screenshotsToSend,
  stepShotsToSend,
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
      stepShots: false,
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

describe('reportToSend, leaving the typed values out', () => {
  const leaveOut = { ...defaultSendChoices(), leaveOutValues: true };
  const option = (name: string, locator: string) => ({
    tagName: 'li',
    role: 'option',
    accessibleName: name,
    testId: null,
    text: name,
    alternatives: [{ locator, method: 'getByRole', score: 90 }],
  });
  /** A report whose steps typed each of `values` in turn, on a search form that sends them in its URL. */
  function typedReport(values: string[]): BugReport {
    const base = report();
    const fills = values.map((value, i) => ({
      action: 'fill' as const,
      target: null,
      value,
      redacted: false,
      pageUrl: '/search',
      timestamp: 10 + i,
    }));
    return { ...base, steps: { ...base.steps, steps: [base.steps.steps[0]!, ...fills] } };
  }

  test('takes them out of the pages, the targets and the assertions that repeat them, encoded or quoted', () => {
    const typed = typedReport(['Jane Doe', "O'Brien"]);
    typed.steps.steps.push(
      {
        action: 'click',
        target: option('Jane Doe', "getByRole('option', { name: 'Jane Doe' })"),
        value: null,
        redacted: false,
        pageUrl: '/search?q=Jane+Doe',
        timestamp: 20,
      },
      {
        action: 'click',
        target: option("O'Brien", "getByRole('option', { name: 'O\\'Brien' })"),
        value: null,
        redacted: false,
        pageUrl: "/people/O'Brien",
        timestamp: 21,
      },
      {
        action: 'assert',
        target: option('Jane Doe', "getByText('Jane Doe')"),
        value: null,
        redacted: false,
        pageUrl: '/search?q=Jane%20Doe',
        timestamp: 22,
        assertion: { matcher: 'toHaveText', expected: 'Hello Jane Doe', actual: 'Hello', negated: false, note: null },
      },
    );
    typed.steps.steps[0] = { ...typed.steps.steps[0]!, value: '/search?q=Jane+Doe' };
    typed.evidence.requests = [
      { method: 'GET', url: '/api/people/Jane%20Doe', status: 404, page: '/search', time: 1 },
      { method: 'GET', url: "/api/people/O'Brien", status: 404, page: "/people/O'Brien", time: 2 },
    ];
    typed.evidence.outline = '- main:\n  - textbox "Name": Jane Doe\n  - textbox "Last": "O\'Brien "';
    typed.context = { ...typed.context, path: "/people/O'Brien", pageKey: "/people/O'Brien" };
    const sent = reportToSend(typed, leaveOut);
    const text = JSON.stringify(sent);
    expect(text).not.toMatch(/Jane|Doe|Brien/);
    expect(sent.steps.steps[0]!.value).toBe(`/search?q=${LEFT_OUT_VALUE}`);
    expect(sent.steps.steps[3]!.target!.alternatives[0]!.locator).toBe(
      `getByRole('option', { name: '${LEFT_OUT_VALUE}' })`,
    );
    expect(sent.steps.steps[5]!.assertion).toMatchObject({ expected: `Hello ${LEFT_OUT_VALUE}`, actual: 'Hello' });
    expect(sent.evidence.requests[0]!.url).toBe(`/api/people/${LEFT_OUT_VALUE}`);
  });

  test('takes a value out of the outline where it is quoted as JSON', () => {
    const typed = typedReport(['say "hi" ']);
    typed.evidence.outline = '- main:\n  - textbox "Greeting": "say \\"hi\\" "';
    expect(reportToSend(typed, leaveOut).evidence.outline).toBe(`- main:\n  - textbox "Greeting": "${LEFT_OUT_VALUE}"`);
  });

  test('takes a longer value out whole when a shorter one starts it', () => {
    const typed = typedReport(['SPRING', 'SPRING10']);
    typed.evidence.console[0]!.message = 'Coupon SPRING10 failed, SPRING is gone';
    expect(reportToSend(typed, leaveOut).evidence.console[0]!.message).toBe(
      `Coupon ${LEFT_OUT_VALUE} failed, ${LEFT_OUT_VALUE} is gone`,
    );
  });

  test('takes a value shorter than three characters out only where it stands whole', () => {
    const typed = typedReport(['0']);
    typed.steps.steps.push({
      action: 'click',
      target: option('0', "getByRole('option', { name: '0' })"),
      value: null,
      redacted: false,
      pageUrl: '/search?qty=0&page=10',
      timestamp: 20,
    });
    typed.evidence.console[0]!.message = 'Error 500';
    typed.evidence.outline = '- main:\n  - spinbutton "Quantity": 0\n  - text: Page 10';
    const sent = reportToSend(typed, leaveOut);
    expect(sent.steps.steps[1]).toMatchObject({ action: 'fill', value: null, redacted: true });
    expect(sent.steps.steps[2]!.pageUrl).toBe(`/search?qty=${LEFT_OUT_VALUE}&page=10`);
    expect(sent.steps.steps[2]!.target).toMatchObject({ accessibleName: LEFT_OUT_VALUE, text: LEFT_OUT_VALUE });
    expect(sent.steps.steps[2]!.target!.alternatives[0]!.locator).toBe(
      `getByRole('option', { name: '${LEFT_OUT_VALUE}' })`,
    );
    expect(sent.evidence.console[0]!.message).toBe('Error 500');
    expect(sent.evidence.outline).toBe(`- main:\n  - spinbutton "Quantity": ${LEFT_OUT_VALUE}\n  - text: Page 10`);
  });

  test('takes a short value out of a console message where it stands as a word of its own', () => {
    const typed = typedReport(['42', 'é']);
    typed.evidence.console[0]!.message = 'Order 42 failed (error 5420, "42"), é not allowed in café';
    expect(reportToSend(typed, leaveOut).evidence.console[0]!.message).toBe(
      `Order ${LEFT_OUT_VALUE} failed (error 5420, "${LEFT_OUT_VALUE}"), ${LEFT_OUT_VALUE} not allowed in café`,
    );
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

describe('stepShotsToSend', () => {
  const shot = { step: 1, file: 'steps/002.jpg', box: null, viewport: null, takenAt: 1 };
  const withShots = (): BugReport => ({ ...report(), evidence: { ...report().evidence, stepShots: [shot] } });
  const images = new Map([['steps/002.jpg', 'data:image/jpeg;base64,/9j/']]);

  test('sends the screenshot of each step the report names, without its folder, unless left out', () => {
    expect(stepShotsToSend(withShots(), images, defaultSendChoices())).toEqual([
      { name: '002.jpg', dataUrl: 'data:image/jpeg;base64,/9j/' },
    ]);
    const leftOut = { ...defaultSendChoices(), stepShots: false };
    expect(stepShotsToSend(withShots(), images, leftOut)).toEqual([]);
    expect(reportToSend(withShots(), leftOut).evidence).not.toHaveProperty('stepShots');
    expect(reportToSend(withShots(), defaultSendChoices()).evidence.stepShots).toEqual([shot]);
  });
});
