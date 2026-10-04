import { BUG_REPORT_VERSION, emptyBugEvidence, type BugReport } from '@piwitests/core/bug-report';
import { buildSession, normalizeSteps, type RawCaptureEvent, type RecordedTarget } from '@piwitests/core/recording';
import { toStepsDocument } from '@piwitests/core/steps';

const ORIGIN = 'https://staging.shop.test';

function target(overrides: Partial<RecordedTarget>): RecordedTarget {
  return {
    tagName: 'button',
    role: null,
    accessibleName: null,
    testId: null,
    text: null,
    alternatives: [],
    ...overrides,
  } as RecordedTarget;
}

function ev(overrides: Partial<RawCaptureEvent>): RawCaptureEvent {
  return {
    kind: 'click',
    pageUrl: `${ORIGIN}/cart`,
    target: null,
    value: null,
    checked: null,
    inputType: null,
    isPasswordField: false,
    timestamp: 0,
    ...overrides,
  };
}

/** A report of the fixture shop's coupon bug, as Piwi Picker sends it. */
export function couponBugReport(title = 'Coupon not applied to the total'): BugReport {
  const coupon = target({
    tagName: 'input',
    role: 'textbox',
    accessibleName: 'Coupon',
    alternatives: [{ locator: `getByLabel('Coupon')`, method: 'getByLabel', score: 90 }],
  });
  const apply = target({
    role: 'button',
    accessibleName: 'Apply',
    alternatives: [{ locator: `getByRole('button', { name: 'Apply' })`, method: 'getByRole', score: 90 }],
  });
  const total = target({
    tagName: 'p',
    testId: 'cart-total',
    text: 'Total: 40',
    alternatives: [{ locator: `getByTestId('cart-total')`, method: 'getByTestId', score: 95 }],
  });
  const events = [
    ev({ kind: 'navigate', value: `${ORIGIN}/cart`, timestamp: 1 }),
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
  ];
  return {
    v: BUG_REPORT_VERSION,
    steps: toStepsDocument(buildSession(normalizeSteps(events), 1), { title }),
    evidence: {
      ...emptyBugEvidence(),
      console: [{ level: 'error', source: 'console', message: 'Coupon failed: 500', page: '/cart', time: 4 }],
      requests: [{ method: 'POST', url: '/api/cart/coupon', status: 500, page: '/cart', time: 4 }],
      screenshots: [{ file: 'screenshots/1-marked.png', step: 3, moment: 'marked', takenAt: 4 }],
      outline: '- main:\n  - paragraph: "Total: 40"',
    },
    context: {
      origin: ORIGIN,
      pageKey: '/cart',
      path: '/cart',
      browser: 'Chrome 141',
      userAgent: 'Mozilla/5.0 Chrome/141.0',
      viewport: { width: 1280, height: 800 },
      time: Date.UTC(2026, 8, 27),
      extensionVersion: '0.41.0',
    },
  };
}

/** A 1×1 PNG. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** The start of a JPEG: enough for the server, which checks the signature, to take it as one. */
export const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);
