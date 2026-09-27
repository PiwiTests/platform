import { describe, test, expect } from 'vitest';
import { normalizeSteps, buildSession, type RawCaptureEvent, type RecordedTarget } from '../src/recording';

function target(overrides: Partial<RecordedTarget> = {}): RecordedTarget {
  return {
    tagName: 'input',
    role: 'textbox',
    accessibleName: 'Username',
    testId: null,
    text: null,
    alternatives: [{ locator: `getByRole('textbox', { name: 'Username' })`, method: 'getByRole', score: 90 }],
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
    pageUrl: 'https://x.test/',
    timestamp: 0,
    ...overrides,
  };
}

describe('normalizeSteps', () => {
  test('coalesces an input burst on the same field into one fill with the last value', () => {
    const usernameField = target();
    const steps = normalizeSteps([
      ev({ kind: 'input', target: usernameField, value: 'a', timestamp: 1 }),
      ev({ kind: 'input', target: usernameField, value: 'al', timestamp: 2 }),
      ev({ kind: 'input', target: usernameField, value: 'alice', timestamp: 3 }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ action: 'fill', value: 'alice' });
  });

  test('two unlabelled fields stay two fills — neither value is lost to the other', () => {
    // Same tag, same role, no name, no test id, and no locator alternative
    // either: a bare role anchor needs the role to be document-unique, which it
    // is not with two of them. The recorder's own per-element key is the only
    // thing telling these apart.
    const bare = { tagName: 'input', role: 'textbox', accessibleName: null, testId: null, text: null };
    const first = target({ ...bare, alternatives: [], elementKey: 'e1' });
    const second = target({ ...bare, alternatives: [], elementKey: 'e2' });
    const steps = normalizeSteps([
      ev({ kind: 'input', target: first, value: 'alice', timestamp: 1 }),
      ev({ kind: 'input', target: second, value: 'smith', timestamp: 2 }),
    ]);
    expect(steps.map((s) => s.value)).toEqual(['alice', 'smith']);
  });

  test('a burst on one field still coalesces when the element key repeats', () => {
    const field = target({ alternatives: [], elementKey: 'e1' });
    const steps = normalizeSteps([
      ev({ kind: 'input', target: field, value: 'a', timestamp: 1 }),
      ev({ kind: 'input', target: field, value: 'alice', timestamp: 2 }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ value: 'alice' });
  });

  test('two distinct fields are told apart by their best locator when no element key exists', () => {
    const first = target({
      accessibleName: null,
      alternatives: [{ locator: `locator('#a')`, method: 'locator', score: 40 }],
    });
    const second = target({
      accessibleName: null,
      alternatives: [{ locator: `locator('#b')`, method: 'locator', score: 40 }],
    });
    const steps = normalizeSteps([
      ev({ kind: 'input', target: first, value: 'alice', timestamp: 1 }),
      ev({ kind: 'input', target: second, value: 'smith', timestamp: 2 }),
    ]);
    expect(steps.map((s) => s.value)).toEqual(['alice', 'smith']);
  });

  test('Enter on a button drops the browser’s synthetic click that follows it', () => {
    const button = target({ tagName: 'button', role: 'button', accessibleName: 'Log in', elementKey: 'e9' });
    const steps = normalizeSteps([
      ev({ kind: 'keydown', target: button, value: 'Enter', timestamp: 10 }),
      ev({ kind: 'click', target: button, timestamp: 12 }),
    ]);
    expect(steps.map((s) => s.action)).toEqual(['press']);
  });

  test('a click on a different element after Enter is still recorded', () => {
    const field = target({ elementKey: 'e1' });
    const button = target({ tagName: 'button', role: 'button', accessibleName: 'Log in', elementKey: 'e2' });
    const steps = normalizeSteps([
      ev({ kind: 'keydown', target: field, value: 'Enter', timestamp: 10 }),
      ev({ kind: 'click', target: button, timestamp: 12 }),
    ]);
    expect(steps.map((s) => s.action)).toEqual(['press', 'click']);
  });

  test('a deliberate click on the same element well after Enter is still recorded', () => {
    const button = target({ tagName: 'button', role: 'button', accessibleName: 'Log in', elementKey: 'e9' });
    const steps = normalizeSteps([
      ev({ kind: 'keydown', target: button, value: 'Enter', timestamp: 10 }),
      ev({ kind: 'click', target: button, timestamp: 3000 }),
    ]);
    expect(steps.map((s) => s.action)).toEqual(['press', 'click']);
  });

  test('a click on a different target flushes the pending fill first', () => {
    const usernameField = target();
    const button = target({ tagName: 'button', role: 'button', accessibleName: 'Submit' });
    const steps = normalizeSteps([
      ev({ kind: 'input', target: usernameField, value: 'alice', timestamp: 1 }),
      ev({ kind: 'click', target: button, timestamp: 2 }),
    ]);
    expect(steps.map((s) => s.action)).toEqual(['fill', 'click']);
  });

  test('password fields are never captured — redacted with a null value', () => {
    const passwordField = target({ role: 'textbox', accessibleName: 'Password' });
    const steps = normalizeSteps([
      ev({ kind: 'input', target: passwordField, value: 'hunter2', isPasswordField: true, timestamp: 1 }),
    ]);
    expect(steps[0]).toMatchObject({ action: 'fill', value: null, redacted: true });
  });

  test('checkbox change becomes check/uncheck, not a raw click', () => {
    const checkbox = target({ tagName: 'input', role: 'checkbox', accessibleName: 'Agree' });
    const steps = normalizeSteps([
      ev({ kind: 'click', target: checkbox, inputType: 'checkbox', timestamp: 1 }),
      ev({ kind: 'change', target: checkbox, inputType: 'checkbox', checked: true, timestamp: 2 }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.action).toBe('check');
  });

  test('unchecking emits uncheck', () => {
    const checkbox = target({ role: 'checkbox' });
    const steps = normalizeSteps([
      ev({ kind: 'change', target: checkbox, inputType: 'checkbox', checked: false, timestamp: 1 }),
    ]);
    expect(steps[0]!.action).toBe('uncheck');
  });

  test('select change becomes selectOption', () => {
    const select = target({ tagName: 'select', role: 'combobox', accessibleName: 'Country' });
    const steps = normalizeSteps([
      ev({ kind: 'change', target: select, inputType: 'select', value: 'FR', timestamp: 1 }),
    ]);
    expect(steps[0]).toMatchObject({ action: 'selectOption', value: 'FR' });
  });

  test('Enter commits a pending fill and becomes a press step, not a click', () => {
    const field = target();
    const steps = normalizeSteps([
      ev({ kind: 'input', target: field, value: 'alice', timestamp: 1 }),
      ev({ kind: 'keydown', target: field, value: 'Enter', timestamp: 2 }),
    ]);
    expect(steps.map((s) => s.action)).toEqual(['fill', 'press']);
    expect(steps[1]).toMatchObject({ value: 'Enter' });
  });

  test('keys that only move between fields are ignored', () => {
    const field = target();
    const steps = normalizeSteps([
      ev({ kind: 'keydown', target: field, value: 'Tab', timestamp: 1 }),
      ev({ kind: 'keydown', target: field, value: 'PageDown', timestamp: 2 }),
    ]);
    expect(steps).toHaveLength(0);
  });

  test('a page’s shortcuts become presses: a combination, or a single character', () => {
    const steps = normalizeSteps([
      ev({ kind: 'keydown', target: null, value: 'ControlOrMeta+k', timestamp: 1 }),
      ev({ kind: 'keydown', target: null, value: '?', timestamp: 2 }),
      ev({ kind: 'keydown', target: null, value: 'Shift+Tab', timestamp: 3 }),
    ]);
    expect(steps.map((s) => s.value)).toEqual(['ControlOrMeta+k', '?', 'Shift+Tab']);
  });

  test('Escape and the arrow keys become presses, after the fill they end', () => {
    const field = target({ tagName: 'input', role: 'combobox' });
    const steps = normalizeSteps([
      ev({ kind: 'input', target: field, value: 'fr', timestamp: 1 }),
      ev({ kind: 'keydown', target: field, value: 'ArrowDown', timestamp: 2 }),
      ev({ kind: 'keydown', target: field, value: 'Escape', timestamp: 3 }),
    ]);
    expect(steps.map((s) => [s.action, s.value])).toEqual([
      ['fill', 'fr'],
      ['press', 'ArrowDown'],
      ['press', 'Escape'],
    ]);
  });

  test('only the first navigation becomes a goto — later ones are implied by what caused them', () => {
    const steps = normalizeSteps([
      ev({ kind: 'navigate', value: 'https://x.test/', timestamp: 1 }),
      ev({ kind: 'click', target: target({ tagName: 'a', role: 'link' }), timestamp: 2 }),
      ev({ kind: 'navigate', value: 'https://x.test/next', timestamp: 3 }),
      ev({ kind: 'click', target: target({ tagName: 'button', role: 'button' }), timestamp: 4 }),
    ]);
    expect(steps.map((s) => s.action)).toEqual(['goto', 'click', 'click']);
    expect(steps[0]).toMatchObject({ value: 'https://x.test/' });
  });

  test('long text is normalized and truncated on the target', () => {
    const long = 'x'.repeat(200);
    const steps = normalizeSteps([ev({ kind: 'click', target: target({ text: `  ${long}  ` }), timestamp: 1 })]);
    expect(steps[0]!.target!.text).toHaveLength(120);
  });

  test('an assert event becomes an assert step where it was added, after the fill in progress', () => {
    const coupon = target({ accessibleName: 'Coupon' });
    const total = target({
      tagName: 'p',
      role: null,
      accessibleName: null,
      testId: 'cart-total',
      alternatives: [{ locator: `getByTestId('cart-total')`, method: 'getByTestId', score: 100 }],
    });
    const assertion = {
      matcher: 'toHaveText' as const,
      expected: 'Total: 42',
      actual: 'Total: 40',
      negated: false,
      note: 'coupon ignored',
    };
    const steps = normalizeSteps([
      ev({ kind: 'navigate', value: 'https://x.test/cart', timestamp: 1 }),
      ev({ kind: 'input', target: coupon, value: 'SPRING', timestamp: 2 }),
      ev({ kind: 'input', target: coupon, value: 'SPRING10', timestamp: 3 }),
      ev({ kind: 'assert', target: total, assertion, pageUrl: 'https://x.test/cart', timestamp: 4 }),
      ev({ kind: 'click', target: target({ accessibleName: 'Apply' }), timestamp: 5 }),
    ]);
    expect(steps.map((s) => s.action)).toEqual(['goto', 'fill', 'assert', 'click']);
    expect(steps[1]).toMatchObject({ value: 'SPRING10' });
    expect(steps[2]).toMatchObject({ target: { testId: 'cart-total' }, value: null, assertion });
  });

  test('a toHaveURL assert has no target, and an assert event without an assertion is dropped', () => {
    const steps = normalizeSteps([
      ev({
        kind: 'assert',
        target: target(),
        assertion: { matcher: 'toHaveURL', expected: '/thanks', actual: '/cart', negated: false, note: null },
        timestamp: 1,
      }),
      ev({ kind: 'assert', target: target(), timestamp: 2 }),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ action: 'assert', target: null, assertion: { matcher: 'toHaveURL' } });
  });
});

describe('buildSession', () => {
  test('startUrl comes from the first goto step when present', () => {
    const steps = normalizeSteps([
      ev({ kind: 'navigate', value: 'https://x.test/start', timestamp: 1 }),
      ev({ kind: 'click', target: target(), timestamp: 2 }),
    ]);
    const session = buildSession(steps, 1000);
    expect(session.startUrl).toBe('https://x.test/start');
    expect(session.startedAt).toBe(1000);
  });

  test('falls back to the first step pageUrl when there is no goto', () => {
    const steps = normalizeSteps([
      ev({ kind: 'click', target: target(), pageUrl: 'https://x.test/no-goto', timestamp: 1 }),
    ]);
    const session = buildSession(steps, 0);
    expect(session.startUrl).toBe('https://x.test/no-goto');
  });
});
