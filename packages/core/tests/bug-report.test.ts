import { describe, test, expect } from 'vitest';
import ts from 'typescript';
import {
  BUG_REPORT_VERSION,
  bugContextFrom,
  bugTitle,
  describeBrowser,
  describeStepInWords,
  emptyBugEvidence,
  expectedSteps,
  renderBugMarkdown,
  renderBugSpec,
  reportedRequestUrl,
  summarizeEvidence,
  type BugReport,
} from '../src/bug-report';
import { normalizeSteps, buildSession, type RawCaptureEvent, type RecordedTarget } from '../src/recording';
import { parseSteps, toStepsDocument } from '../src/steps';

const ORIGIN = 'https://staging.acme.test';

function target(overrides: Partial<RecordedTarget>): RecordedTarget {
  return {
    tagName: 'button',
    role: null,
    accessibleName: null,
    testId: null,
    text: null,
    alternatives: [],
    ...overrides,
  };
}

function ev(overrides: Partial<RawCaptureEvent>): RawCaptureEvent {
  return {
    kind: 'click',
    target: null,
    value: null,
    checked: null,
    inputType: null,
    isPasswordField: false,
    pageUrl: `${ORIGIN}/cart`,
    timestamp: 1,
    ...overrides,
  };
}

const coupon = target({
  tagName: 'input',
  role: 'textbox',
  accessibleName: 'Coupon',
  alternatives: [{ locator: `getByLabel('Coupon')`, method: 'getByLabel', score: 90 }],
});
const apply = target({
  role: 'button',
  accessibleName: 'Apply',
  text: 'Apply',
  alternatives: [{ locator: `getByRole('button', { name: 'Apply' })`, method: 'getByRole', score: 95 }],
});
const total = target({
  tagName: 'p',
  testId: 'cart-total',
  text: 'Total: 40',
  alternatives: [
    { locator: `locator('div > p:nth-child(3)')`, method: 'locator', score: 60 },
    { locator: `getByTestId('cart-total')`, method: 'getByTestId', score: 100 },
  ],
});

function couponReport(): BugReport {
  const events = [
    ev({ kind: 'navigate', value: `${ORIGIN}/cart?session=abc`, timestamp: 1 }),
    ev({ kind: 'input', target: coupon, value: 'SPRING10', timestamp: 2 }),
    ev({ kind: 'click', target: apply, timestamp: 3 }),
    ev({
      kind: 'assert',
      target: total,
      assertion: {
        matcher: 'toHaveText',
        expected: 'Total: 42',
        actual: 'Total: 40',
        negated: false,
        note: 'the coupon is ignored',
      },
      timestamp: 4,
    }),
    ev({
      kind: 'assert',
      target: target({
        role: 'button',
        accessibleName: 'Download invoice',
        alternatives: [
          { locator: `getByRole('button', { name: 'Download invoice' })`, method: 'getByRole', score: 90 },
        ],
      }),
      assertion: { matcher: 'toBeVisible', expected: null, actual: null, negated: false, note: null },
      timestamp: 5,
    }),
  ];
  const steps = normalizeSteps(events);
  return {
    v: BUG_REPORT_VERSION,
    steps: toStepsDocument(buildSession(steps, 1), { title: 'Coupon not applied to the total' }),
    evidence: {
      ...emptyBugEvidence(),
      console: [
        {
          level: 'error',
          source: 'console',
          message: 'Coupon failed: 500',
          page: '/cart',
          time: Date.UTC(2026, 8, 27, 14, 3, 12),
        },
      ],
      requests: [
        { method: 'POST', url: '/api/cart/coupon', status: 500, page: '/cart', time: Date.UTC(2026, 8, 27, 14, 3, 12) },
      ],
      screenshots: [{ file: 'screenshots/1-marked.png', step: 3, moment: 'marked', takenAt: 4 }],
      outline: '- main:\n  - paragraph: "Total: 40"',
    },
    context: bugContextFrom({
      url: `${ORIGIN}/cart?session=abc#top`,
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      time: Date.UTC(2026, 8, 27, 14, 3),
      extensionVersion: '0.39.0',
    }),
  };
}

describe('bug report', () => {
  test('the steps are a steps document that parseSteps reads back, assertions included', () => {
    const report = couponReport();
    const parsed = parseSteps(JSON.stringify(report.steps));
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    expect(parsed.steps.steps.map((s) => s.action)).toEqual(['goto', 'fill', 'click', 'assert', 'assert']);
    expect(parsed.steps.steps[3]!.assertion).toMatchObject({ expected: 'Total: 42', actual: 'Total: 40' });
    expect(expectedSteps(report).map((e) => e.index)).toEqual([3, 4]);
  });

  test('the failing test is marked to fail, tagged, relative, and uses the stable locator', () => {
    const { code, warnings } = renderBugSpec(couponReport());
    expect(warnings).toEqual([]);
    expect(code).toContain(`test('bug: coupon not applied to the total', {`);
    expect(code).toContain(`tag: ['@bug'],`);
    expect(code).toContain('  test.fail(); // passes while the bug exists; remove this line with the fix');
    expect(code).toContain(`await page.goto('/cart?session=abc');`);
    expect(code).toContain(`await page.getByLabel('Coupon').fill('SPRING10');`);
    expect(code).toContain(
      `await expect(page.getByTestId('cart-total')).toHaveText('Total: 42'); // recorded: 'Total: 40'`,
    );
    expect(code).toContain(`await expect(page.getByRole('button', { name: 'Download invoice' })).toBeVisible();`);
    const out = ts.transpileModule(code, {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    });
    expect(out.diagnostics ?? []).toEqual([]);
  });

  test('options add to the defaults, such as the project’s test import, or no test.fail() for a run', () => {
    const { code } = renderBugSpec(couponReport(), { testImport: '../fixtures', expectFail: false });
    expect(code).toContain(`from '../fixtures';`);
    expect(code).not.toContain('test.fail()');
  });

  test('the Markdown has the steps in words, expected and actual, the note and the evidence', () => {
    const md = renderBugMarkdown(couponReport());
    expect(md).toContain('# Coupon not applied to the total');
    expect(md).toContain(
      `**Page** \`/cart\` on ${ORIGIN} · Chrome 141 · 1280×720 · 2026-09-27 14:03 UTC · Piwi Picker 0.39.0`,
    );
    expect(md).toContain('1. Go to `/cart?session=abc`');
    expect(md).toContain('2. Fill text field "Coupon" with "SPRING10"');
    expect(md).toContain('3. Click button "Apply"');
    expect(md).toContain('4. The element with test id `cart-total` should read "Total: 42"');
    expect(md).toContain('   - Actual: "Total: 40"');
    expect(md).toContain('   - Note: the coupon is ignored');
    expect(md).toContain('5. Button "Download invoice" should be visible');
    expect(md).toContain(
      '- Step 4: the element with test id `cart-total` should read "Total: 42". It shows "Total: 40".',
    );
    expect(md).toContain('1 screenshot · 1 console error · 1 failed request · page outline');
    expect(md).toContain('- `screenshots/1-marked.png`, after step 4');
    expect(md).toContain('- error on `/cart` at 14:03:12: `Coupon failed: 500`');
    expect(md).toContain('- `POST /api/cart/coupon` → 500, on `/cart` at 14:03:12');
    expect(md).toContain('```yaml\n- main:\n  - paragraph: "Total: 40"\n```');
    expect(md).toContain('not Playwright’s own');
    expect(md).not.toMatch(/ARIA snapshot\b(?! ?,? not)/);
  });

  test('the Markdown keeps text on its line and in its code span', () => {
    const report = couponReport();
    report.steps.title = 'Broken <b>\n total';
    report.evidence.console[0]!.message = 'a `tick` inside';
    const md = renderBugMarkdown(report);
    expect(md).toContain('# Broken &lt;b> total');
    expect(md).toContain('``a `tick` inside``');
  });

  test('a report without a screenshot says why, and one without a title is named by its page', () => {
    const report = couponReport();
    report.steps.title = null;
    report.evidence.screenshots = [];
    report.evidence.screenshotNote = 'open Piwi Picker on the page to allow one';
    expect(bugTitle(report)).toBe('Bug on /cart');
    const md = renderBugMarkdown(report);
    expect(md).toContain('No screenshot: open Piwi Picker on the page to allow one');
    expect(summarizeEvidence(report.evidence)).toMatch(/^no screenshot · /);
  });

  test('request URLs lose their query values and fragment, and keep a foreign origin', () => {
    expect(reportedRequestUrl('/api/cart/coupon?code=SPRING10&x=1#a', `${ORIGIN}/cart`)).toBe(
      '/api/cart/coupon?code=%3Credacted%3E&x=%3Credacted%3E',
    );
    expect(reportedRequestUrl('https://api.acme.test/v1/orders/123', `${ORIGIN}/cart`)).toBe(
      'https://api.acme.test/v1/orders/:id',
    );
    expect(reportedRequestUrl('data:text/plain,hi', `${ORIGIN}/cart`)).toBe('data:…');
  });

  test('the context has the page, the browser and no query', () => {
    const { context } = couponReport();
    expect(context).toMatchObject({ origin: ORIGIN, pageKey: '/cart', path: '/cart', browser: 'Chrome 141' });
    expect(describeBrowser('Mozilla/5.0 … Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0')).toBe('Edge 141');
    expect(describeBrowser('Mozilla/5.0 … HeadlessChrome/141.0.0.0 Safari/537.36')).toBe('Chrome 141');
    expect(describeBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe(
      'Firefox 130',
    );
  });

  test('an element whose text is asserted is not named by that text', () => {
    const report = couponReport();
    const step = report.steps.steps[3]!;
    step.target = { ...step.target!, testId: null, accessibleName: 'Total: 40', text: 'Total: 40' };
    expect(describeStepInWords(step)).toBe(`\`locator('div > p:nth-child(3)')\` should read "Total: 42"`);
    step.target.alternatives = [];
    expect(describeStepInWords(step)).toBe('The p should read "Total: 42"');
  });

  test('steps in words cover every action, and a password is never shown', () => {
    const words = (step: Parameters<typeof describeStepInWords>[0]) => describeStepInWords(step);
    const base = { target: coupon, value: null, redacted: false, pageUrl: '/cart', timestamp: 1 };
    expect(words({ ...base, action: 'fill', value: null, redacted: true })).toBe(
      'Fill text field "Coupon" with a password (not recorded)',
    );
    expect(words({ ...base, action: 'press', value: 'Enter' })).toBe('Press Enter in text field "Coupon"');
    expect(words({ ...base, action: 'selectOption', value: 'FR' })).toBe('Select "FR" in text field "Coupon"');
    expect(
      words({
        ...base,
        action: 'assert',
        target: null,
        assertion: { matcher: 'toHaveURL', expected: '/thanks', actual: '/cart', negated: false, note: null },
      }),
    ).toBe('The page should be `/thanks`');
  });
});
