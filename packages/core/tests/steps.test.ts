import { describe, test, expect } from 'vitest';
import { renderSpec } from '../src/codegen';
import { buildSession, type RecordedStep, type RecordedTarget } from '../src/recording';
import { STEPS_LIMITS, parseSteps, sessionFromSteps, toStepsDocument, type PiwiSteps } from '../src/steps';

const ORIGIN = 'https://staging.acme.test';

function target(overrides: Partial<RecordedTarget> = {}): RecordedTarget {
  return {
    tagName: 'button',
    role: 'button',
    accessibleName: 'Apply',
    testId: null,
    text: 'Apply',
    alternatives: [{ locator: `getByRole('button', { name: 'Apply' })`, method: 'getByRole', score: 90 }],
    ...overrides,
  };
}

function step(overrides: Partial<RecordedStep> = {}): RecordedStep {
  return {
    action: 'click',
    target: target(),
    value: null,
    redacted: false,
    pageUrl: `${ORIGIN}/cart`,
    timestamp: 1,
    ...overrides,
  };
}

function recording(): RecordedStep[] {
  return [
    step({ action: 'goto', target: null, value: `${ORIGIN}/cart?from=mail`, pageUrl: `${ORIGIN}/cart?from=mail` }),
    step({
      action: 'fill',
      value: 'SPRING10',
      target: target({
        role: 'textbox',
        accessibleName: 'Coupon',
        elementKey: 'e7',
        alternatives: [{ locator: `getByRole('textbox', { name: 'Coupon' })`, method: 'getByRole', score: 90 }],
      }),
    }),
    step(),
    step({
      action: 'assert',
      target: target({
        testId: 'cart-total',
        alternatives: [{ locator: `getByTestId('cart-total')`, method: 'getByTestId', score: 100 }],
      }),
      assertion: {
        matcher: 'toHaveText',
        expected: 'Total: 42',
        actual: 'Total: 40',
        negated: false,
        note: 'coupon ignored',
      },
    }),
  ];
}

describe('toStepsDocument / sessionFromSteps', () => {
  test('keeps the origin once and stores paths, without the recorder element keys', () => {
    const doc = toStepsDocument(buildSession(recording(), 100), { title: 'Coupon not applied', note: 'since Monday' });
    expect(doc).toMatchObject({
      v: 1,
      title: 'Coupon not applied',
      origin: ORIGIN,
      recordedAt: 100,
      note: 'since Monday',
    });
    expect(doc.steps[0]).toMatchObject({ value: '/cart?from=mail', pageUrl: '/cart?from=mail' });
    expect(doc.steps.every((s) => s.pageUrl.startsWith('/'))).toBe(true);
    expect(doc.steps[1]!.target).not.toHaveProperty('elementKey');
  });

  test('a document becomes a recording on its origin, or on another one', () => {
    const doc = toStepsDocument(buildSession(recording(), 100));
    const back = sessionFromSteps(doc);
    expect(back.startUrl).toBe(`${ORIGIN}/cart?from=mail`);
    expect(back.steps[2]!.pageUrl).toBe(`${ORIGIN}/cart`);
    const local = sessionFromSteps(doc, 'http://localhost:3000');
    expect(local.startUrl).toBe('http://localhost:3000/cart?from=mail');
    expect(local.steps.every((s) => s.pageUrl.startsWith('http://localhost:3000/'))).toBe(true);
  });

  test('a spec rendered from a document runs against baseURL', () => {
    const doc = toStepsDocument(buildSession(recording(), 100), { title: 'Coupon not applied' });
    const { code } = renderSpec(sessionFromSteps(doc), { title: doc.title!, urls: 'relative' });
    expect(code).toContain(`await page.goto('/cart?from=mail');`);
    expect(code).toContain(`await page.getByRole('textbox', { name: 'Coupon' }).fill('SPRING10');`);
    expect(code).toContain(
      `await expect(page.getByTestId('cart-total')).toHaveText('Total: 42'); // recorded: 'Total: 40'`,
    );
  });
});

describe('parseSteps', () => {
  const valid = (): PiwiSteps => toStepsDocument(buildSession(recording(), 100), { title: 'Coupon' });

  test('reads a document back as it was written, from text or a value', () => {
    const doc = valid();
    expect(parseSteps(JSON.stringify(doc))).toEqual({ ok: true, steps: doc });
    expect(parseSteps(JSON.parse(JSON.stringify(doc)))).toEqual({ ok: true, steps: doc });
  });

  test('reads a recording saved before the format existed', () => {
    const legacy = JSON.parse(JSON.stringify(buildSession(recording(), 5)));
    const result = parseSteps(legacy);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.steps.origin).toBe(ORIGIN);
      expect(result.steps.steps[0]!.value).toBe('/cart?from=mail');
    }
  });

  test('turns the legacy assertVisible into an assert step', () => {
    const doc = valid();
    doc.steps.push({ ...doc.steps[2]!, action: 'assertVisible' });
    const result = parseSteps(JSON.stringify(doc));
    expect(result.ok && result.steps.steps[4]).toMatchObject({
      action: 'assert',
      assertion: { matcher: 'toBeVisible', expected: null },
    });
  });

  test('reads a hover step, which needs a target and keeps no value', () => {
    const doc = valid();
    doc.steps.push({ ...doc.steps[2]!, action: 'hover', value: 'x' });
    const result = parseSteps(JSON.stringify(doc));
    expect(result.ok && result.steps.steps[4]).toMatchObject({ action: 'hover', value: null });
    const bare = valid();
    bare.steps.push({ ...bare.steps[2]!, action: 'hover', target: null });
    expect(parseSteps(bare)).toEqual({ ok: false, errors: ['steps[4].target: is required on a hover step'] });
  });

  test('reads a drag, which needs where it drops, and a file choice, which keeps the names', () => {
    const doc = valid();
    const drop = target({ role: 'region', accessibleName: 'Done', elementKey: 'e9' });
    doc.steps.push({ ...doc.steps[2]!, action: 'dragTo', value: 'x', dropTarget: drop });
    doc.steps.push({ ...doc.steps[2]!, action: 'setInputFiles', value: 'invoice.pdf' });
    const result = parseSteps(JSON.stringify(doc));
    expect(result.ok && result.steps.steps[4]).toMatchObject({
      action: 'dragTo',
      value: null,
      dropTarget: { role: 'region', accessibleName: 'Done' },
    });
    expect(result.ok && result.steps.steps[5]).toMatchObject({ action: 'setInputFiles', value: 'invoice.pdf' });
    const bare = valid();
    bare.steps.push({ ...bare.steps[2]!, action: 'dragTo' });
    expect(parseSteps(bare)).toEqual({ ok: false, errors: ['steps[4].dropTarget: is required on a dragTo step'] });
  });

  test('never keeps a redacted value', () => {
    const doc = valid();
    doc.steps[1] = { ...doc.steps[1]!, redacted: true, value: 'hunter2' };
    const result = parseSteps(doc);
    expect(result.ok && result.steps.steps[1]!.value).toBeNull();
  });

  test('re-renders every locator in canonical form', () => {
    const doc = valid();
    doc.steps[2]!.target!.alternatives = [{ locator: `getByRole("button", {name: "Apply"})`, method: 'x', score: 90 }];
    const result = parseSteps(doc);
    expect(result.ok && result.steps.steps[2]!.target!.alternatives[0]).toEqual({
      locator: `getByRole('button', { name: 'Apply' })`,
      method: 'getByRole',
      score: 90,
    });
  });

  test('refuses what is not a steps document', () => {
    expect(parseSteps('{')).toEqual({ ok: false, errors: ['not valid JSON'] });
    expect(parseSteps([])).toEqual({ ok: false, errors: ['a steps document must be a JSON object'] });
    expect(parseSteps({ v: 2, steps: [] })).toEqual({ ok: false, errors: ['v: this reads version 1, not 2'] });
    expect(parseSteps({ v: 1, steps: 'x' })).toEqual({ ok: false, errors: ['steps: must be a list'] });
  });

  test('refuses a locator that is code, not a chain', () => {
    const doc = valid();
    doc.steps[2]!.target!.alternatives = [
      { locator: `getByRole('x')); require('fs').rmSync('/'); ((0`, method: 'x', score: 1 },
    ];
    expect(parseSteps(doc)).toEqual({
      ok: false,
      errors: ['steps[2].target.alternatives[0].locator: is not a Playwright locator chain'],
    });
  });

  test('refuses unknown actions, missing assertions and a value matcher without a value', () => {
    const doc = valid();
    (doc.steps[0] as { action: string }).action = 'eval';
    doc.steps[2] = { ...doc.steps[2]!, action: 'assert' };
    doc.steps[3]!.assertion = { ...doc.steps[3]!.assertion!, expected: null };
    const result = parseSteps(doc);
    expect(result).toEqual({
      ok: false,
      errors: [
        'steps[0].action: is not a known action',
        'steps[2].assertion: is required on an assert step',
        'steps[3].assertion.expected: is required',
      ],
    });
  });

  test('refuses an origin that is not a web origin', () => {
    const doc = { ...valid(), origin: 'javascript:alert(1)' };
    expect(parseSteps(doc)).toEqual({ ok: false, errors: ['origin: must be an http(s) origin'] });
  });

  test('enforces its limits', () => {
    const doc = valid();
    const tooMany = { ...doc, steps: Array.from({ length: STEPS_LIMITS.steps + 1 }, () => doc.steps[2]) };
    expect(parseSteps(tooMany)).toEqual({ ok: false, errors: [`steps: holds more than ${STEPS_LIMITS.steps}`] });
    const longValue = valid();
    longValue.steps[1]!.value = 'x'.repeat(STEPS_LIMITS.valueLength + 1);
    expect(parseSteps(longValue)).toEqual({
      ok: false,
      errors: [`steps[1].value: is longer than ${STEPS_LIMITS.valueLength} characters`],
    });
    const manyAlternatives = valid();
    manyAlternatives.steps[2]!.target!.alternatives = Array.from(
      { length: STEPS_LIMITS.alternatives + 1 },
      () => manyAlternatives.steps[2]!.target!.alternatives[0]!,
    );
    expect(parseSteps(manyAlternatives)).toEqual({
      ok: false,
      errors: [`steps[2].target.alternatives: holds more than ${STEPS_LIMITS.alternatives}`],
    });
  });
});
