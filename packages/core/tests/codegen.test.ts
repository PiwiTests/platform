import { describe, test, expect } from 'vitest';
import ts from 'typescript';
import { pageUrlPattern, renderSpec, safeLocator } from '../src/codegen';
import { buildSession } from '../src/recording';
import type { RecordedStep, RecordedTarget } from '../src/recording';
import type { TestFunctionEntry } from '../src/function-match';

function target(overrides: Partial<RecordedTarget> = {}): RecordedTarget {
  const merged = {
    tagName: 'button',
    role: 'button',
    accessibleName: 'Log in',
    testId: null as string | null,
    text: null as string | null,
    ...overrides,
  };
  const locator = merged.testId
    ? `getByTestId('${merged.testId}')`
    : `getByRole('${merged.role}', { name: '${merged.accessibleName}' })`;
  return {
    ...merged,
    alternatives: overrides.alternatives ?? [
      { locator, method: merged.testId ? 'getByTestId' : 'getByRole', score: 90 },
    ],
  };
}

function step(overrides: Partial<RecordedStep> = {}): RecordedStep {
  return {
    action: 'click',
    target: target(),
    value: null,
    redacted: false,
    pageUrl: 'https://x.test/login',
    timestamp: 0,
    ...overrides,
  };
}

describe('renderSpec — raw mode (no catalog)', () => {
  test('writes a double click, a drag onto another element and a file choice', () => {
    const row = target({ role: 'row', accessibleName: 'Invoice 42' });
    const bin = target({ role: 'region', accessibleName: 'Archive' });
    const file = target({ tagName: 'input', role: 'button', accessibleName: 'Invoice', testId: 'invoice-file' });
    const session = buildSession(
      [
        step({ action: 'dblclick', target: row }),
        step({ action: 'dragTo', target: row, dropTarget: bin }),
        step({ action: 'setInputFiles', target: file, value: 'invoice.pdf' }),
        step({ action: 'setInputFiles', target: file, value: 'a.png\nb.png' }),
        step({ action: 'setInputFiles', target: file, value: '' }),
      ],
      0,
    );
    const { code, warnings } = renderSpec(session);
    expect(code).toContain(`  await page.getByRole('row', { name: 'Invoice 42' }).dblclick();`);
    expect(code).toContain(
      `  await page.getByRole('row', { name: 'Invoice 42' }).dragTo(page.getByRole('region', { name: 'Archive' }));`,
    );
    expect(code).toContain(`  await page.getByTestId('invoice-file').setInputFiles('invoice.pdf');`);
    expect(code).toContain(`  await page.getByTestId('invoice-file').setInputFiles(['a.png', 'b.png']);`);
    expect(code).toContain(`  await page.getByTestId('invoice-file').setInputFiles([]);`);
    expect(warnings.filter((w) => w.code === 'file-needed').map((w) => w.detail)).toEqual([
      'invoice.pdf',
      'a.png, b.png',
    ]);
  });

  test('writes a hover step as a hover on its locator', () => {
    const row = target({ role: 'row', accessibleName: 'Invoice 42' });
    const session = buildSession([step({ action: 'hover', target: row }), step({ action: 'click' })], 0);
    const { code } = renderSpec(session);
    expect(code).toContain(
      `  await page.getByRole('row', { name: 'Invoice 42' }).hover();\n  await page.getByRole('button', { name: 'Log in' }).click();`,
    );
  });

  test('emits an initial goto from startUrl, then one line per step', () => {
    const session = buildSession([step({ action: 'click' })], 0);
    session.startUrl = 'https://x.test/login';
    const { code } = renderSpec(session);
    expect(code).toContain(`await page.goto('https://x.test/login');`);
    expect(code).toContain(`.click();`);
    expect(code).toContain(`test('recorded flow'`);
  });

  test('a goto step in the recording is used as-is, without a duplicate leading goto', () => {
    const gotoStep = step({ action: 'goto', target: null, value: 'https://x.test/login' });
    const session = buildSession([gotoStep, step()], 0);
    const { code } = renderSpec(session);
    expect(code.match(/page\.goto\(/g)).toHaveLength(1);
  });

  test('fill emits the literal value', () => {
    const session = buildSession(
      [step({ action: 'fill', value: 'alice', target: target({ accessibleName: 'Username' }) })],
      0,
    );
    const { code } = renderSpec(session);
    expect(code).toContain(`.fill('alice');`);
  });

  test('a redacted fill emits a process.env placeholder, never the raw value', () => {
    const session = buildSession([step({ action: 'fill', value: null, redacted: true })], 0);
    const { code } = renderSpec(session);
    expect(code).toMatch(/process\.env\.PIWI_TEST_VALUE_\d+/);
    expect(code).not.toContain('hunter2');
  });

  test('check/uncheck/selectOption/press render their own methods', () => {
    const session = buildSession(
      [
        step({ action: 'check' }),
        step({ action: 'uncheck' }),
        step({ action: 'selectOption', value: 'FR' }),
        step({ action: 'press', value: 'Enter' }),
      ],
      0,
    );
    const { code } = renderSpec(session);
    expect(code).toContain('.check();');
    expect(code).toContain('.uncheck();');
    expect(code).toContain(`.selectOption('FR');`);
    expect(code).toContain(`.press('Enter');`);
  });

  test('no matchedSpans are reported without a catalog', () => {
    const session = buildSession([step()], 0);
    const { matchedSpans } = renderSpec(session);
    expect(matchedSpans).toEqual([]);
  });
});

describe('renderSpec — value escaping', () => {
  test('a multi-line fill value stays on one line as an escaped literal', () => {
    const textarea = target({ role: 'textbox', tagName: 'textarea', accessibleName: 'Notes' });
    const session = buildSession([step({ action: 'fill', value: 'line one\nline two', target: textarea })], 0);
    const { code } = renderSpec(session);
    expect(code).toContain(`.fill('line one\\nline two');`);
    // The emitted line must not be split by the value it carries.
    expect(code.split('\n').filter((l) => l.includes('.fill('))).toHaveLength(1);
  });

  test('carriage returns and line/paragraph separators are escaped too', () => {
    const textarea = target({ role: 'textbox', tagName: 'textarea', accessibleName: 'Notes' });
    const value = 'a\r\nb\u2028c\u2029d';
    const session = buildSession([step({ action: 'fill', value, target: textarea })], 0);
    const { code } = renderSpec(session);
    expect(code).toContain(`.fill('a\\r\\nb\\u2028c\\u2029d');`);
  });

  test('a quote or backslash in a value is still escaped', () => {
    const textarea = target({ role: 'textbox', tagName: 'textarea', accessibleName: 'Notes' });
    const session = buildSession([step({ action: 'fill', value: `it's a\\path`, target: textarea })], 0);
    const { code } = renderSpec(session);
    expect(code).toContain(`.fill('it\\'s a\\\\path');`);
  });

  test('a newline in the test title does not break the test() line', () => {
    const session = buildSession([step()], 0);
    const { code } = renderSpec(session, { title: 'flow\nwith a newline' });
    expect(code).toContain(`test('flow\\nwith a newline'`);
  });
});

describe('renderSpec — with a catalog', () => {
  const loginEntry: TestFunctionEntry = {
    id: 1,
    name: 'login',
    kind: 'page-object-method',
    module: './pages/LoginPage',
    receiver: 'loginPage',
    importName: 'LoginPage',
    params: [
      { name: 'username', type: 'string' },
      { name: 'password', type: 'string' },
    ],
    urlPattern: '**/login',
    steps: [
      { action: 'fill', target: { role: 'textbox', name: 'Username' } },
      { action: 'fill', target: { role: 'textbox', name: 'Password' } },
      { action: 'click', target: { role: 'button', name: 'Log in' } },
    ],
    paramSources: [
      { param: 'username', stepIndex: 0, from: 'value' },
      { param: 'password', stepIndex: 1, from: 'value' },
    ],
  };

  function loginSteps(): RecordedStep[] {
    return [
      step({
        action: 'fill',
        value: 'alice',
        target: target({ role: 'textbox', accessibleName: 'Username', tagName: 'input' }),
      }),
      step({
        action: 'fill',
        value: 'secret',
        target: target({ role: 'textbox', accessibleName: 'Password', tagName: 'input' }),
      }),
      step({ action: 'click', target: target({ role: 'button', accessibleName: 'Log in' }) }),
    ];
  }

  test('a complete matching span collapses into one function call with imports and instantiation', () => {
    const session = buildSession(loginSteps(), 0);
    const { code, matchedSpans } = renderSpec(session, { catalog: [loginEntry] });
    expect(code).toContain(`import { LoginPage } from './pages/LoginPage';`);
    expect(code).toContain(`const loginPage = new LoginPage(page);`);
    expect(code).toContain(`await loginPage.login('alice', 'secret');`);
    expect(code).not.toContain('.fill(');
    expect(matchedSpans).toEqual([{ startStep: 0, endStep: 2, functionName: 'login' }]);
  });

  test('steps after a matched span that do not match anything stay raw', () => {
    const extra = step({ action: 'click', target: target({ accessibleName: 'Continue' }) });
    const session = buildSession([...loginSteps(), extra], 0);
    const { code } = renderSpec(session, { catalog: [loginEntry] });
    expect(code).toContain(`await loginPage.login('alice', 'secret');`);
    expect(code).toContain(`getByRole('button', { name: 'Continue' })`);
  });

  test('an incomplete match (fewer steps than the pattern needs) is left raw, not partially substituted', () => {
    const session = buildSession(loginSteps().slice(0, 2), 0);
    const { code, matchedSpans } = renderSpec(session, { catalog: [loginEntry] });
    expect(code).not.toContain('loginPage.login');
    expect(code).toContain(`.fill('alice');`);
    expect(matchedSpans).toEqual([]);
  });

  test('a step interleaved into an otherwise matching span is never swallowed by the call', () => {
    const [username, password, submit] = loginSteps();
    const interloper = step({ action: 'click', target: target({ role: 'button', accessibleName: 'Show password' }) });
    const session = buildSession([username!, interloper, password!, submit!], 0);
    const { code, matchedSpans } = renderSpec(session, { catalog: [loginEntry] });
    // Every recorded action has to survive into the spec — collapsing this span
    // would have dropped the "Show password" click entirely.
    expect(code).toContain(`getByRole('button', { name: 'Show password' })`);
    expect(code).toContain(`.fill('alice');`);
    expect(code).toContain(`.fill('secret');`);
    expect(matchedSpans).toEqual([]);
  });

  test('an entry whose identifiers are not identifiers is never emitted as a call', () => {
    // These fields land in the generated source unquoted. The API rejects them
    // on the way in; codegen refuses them on the way out as well, since an MCP
    // agent can also fill a catalog from repository source.
    const injected: TestFunctionEntry = {
      ...loginEntry,
      receiver: `loginPage); await page.goto('https://evil.test'); (0`,
      importName: `LoginPage } from 'node:child_process'; import { execSync`,
    };
    const session = buildSession(loginSteps(), 0);
    const { code, matchedSpans } = renderSpec(session, { catalog: [injected] });
    expect(code).not.toContain('evil.test');
    expect(code).not.toContain('child_process');
    expect(matchedSpans).toEqual([]);
    // The steps still come out — refusing the call must not lose the recording.
    expect(code).toContain(`.fill('alice');`);
  });

  test('a name that is not an identifier is refused for a helper too', () => {
    const injected: TestFunctionEntry = { ...loginEntry, kind: 'helper', receiver: null, name: 'do(); evil' };
    const session = buildSession(loginSteps(), 0);
    const { code } = renderSpec(session, { catalog: [injected] });
    expect(code).not.toContain('evil');
    expect(code).toContain(`.fill('alice');`);
  });

  test('a helper (no receiver) is imported and called directly with page as the first arg', () => {
    const helper: TestFunctionEntry = {
      ...loginEntry,
      id: 2,
      name: 'addItem',
      kind: 'helper',
      receiver: null,
      importName: null,
      module: './helpers/cart',
      params: [{ name: 'sku', type: 'string' }],
      steps: [{ action: 'click', target: { role: 'button', name: 'Add to cart' } }],
      paramSources: [{ param: 'sku', stepIndex: 0, from: 'testId' }],
    };
    const cartStep = step({ target: target({ role: 'button', accessibleName: 'Add to cart', testId: 'sku-42' }) });
    const session = buildSession([cartStep], 0);
    const { code } = renderSpec(session, { catalog: [helper] });
    expect(code).toContain(`import { addItem } from './helpers/cart';`);
    expect(code).toContain(`await addItem(page, 'sku-42');`);
  });
});

/**
 * The shape most real Playwright helpers actually take — an options bag
 * (`selectOption(page, { label }, { value })`) rather than positional
 * scalars. Before `object` params existed these could only be declared
 * `string`, and codegen emitted a bare `''` into a slot needing a literal.
 */
describe('renderSpec — object params', () => {
  const selectEntry: TestFunctionEntry = {
    id: 10,
    name: 'selectOption',
    kind: 'helper',
    module: './helpers/select',
    receiver: null,
    importName: null,
    urlPattern: null,
    params: [
      { name: 'source', type: 'object', fields: ['label'] },
      { name: 'option', type: 'object', fields: ['value'] },
    ],
    steps: [
      { action: 'click', target: { role: 'combobox' } },
      { action: 'click', target: { role: 'option' } },
    ],
    paramSources: [
      { param: 'source', path: 'label', stepIndex: 0, from: 'text' },
      { param: 'option', path: 'value', stepIndex: 1, from: 'text' },
    ],
  };

  function selectSteps(optionText: string | null): RecordedStep[] {
    return [
      step({ target: target({ role: 'combobox', accessibleName: 'Country', text: 'Country' }) }),
      step({ target: target({ role: 'option', accessibleName: 'France', text: optionText }) }),
    ];
  }

  test('each object param renders as a literal built from its resolved fields', () => {
    const session = buildSession(selectSteps('France'), 0);
    const { code } = renderSpec(session, { catalog: [selectEntry] });
    expect(code).toContain(`await selectOption(page, { label: 'Country' }, { value: 'France' });`);
  });

  test('a field that resolved to nothing is omitted, not emitted empty', () => {
    const session = buildSession(selectSteps(null), 0);
    const { code } = renderSpec(session, { catalog: [selectEntry] });
    // `option.value` had no text to read, so the bag renders empty rather than `{ value: '' }`.
    expect(code).toContain(`await selectOption(page, { label: 'Country' }, {});`);
  });

  test('a field name that is not a bare identifier is quoted as a key', () => {
    const quirky: TestFunctionEntry = {
      ...selectEntry,
      params: [
        { name: 'source', type: 'object', fields: ['data-label'] },
        { name: 'option', type: 'object', fields: ['value'] },
      ],
      paramSources: [
        { param: 'source', path: 'data-label', stepIndex: 0, from: 'text' },
        { param: 'option', path: 'value', stepIndex: 1, from: 'text' },
      ],
    };
    const session = buildSession(selectSteps('France'), 0);
    const { code } = renderSpec(session, { catalog: [quirky] });
    expect(code).toContain(`{ 'data-label': 'Country' }`);
  });
});

describe('renderSpec — options', () => {
  const origin = 'https://x.test';
  const at = (path: string) => `${origin}${path}`;
  const brittle = { locator: `locator('.btn').nth(1)`, method: 'locator', score: 20 };
  const byRole = { locator: `getByRole('button', { name: 'Log in' })`, method: 'getByRole', score: 90 };

  test('with no options the output is the plain recorder export', () => {
    const session = buildSession([step()], 0);
    session.startUrl = at('/login');
    const { code, warnings } = renderSpec(session);
    expect(code).toBe(
      [
        `import { test, expect } from '@playwright/test';`,
        ``,
        `test('recorded flow', async ({ page }) => {`,
        `  await page.goto('https://x.test/login');`,
        `  await page.getByRole('button', { name: 'Log in' }).click();`,
        `});`,
        ``,
      ].join('\n'),
    );
    expect(warnings).toEqual([]);
  });

  test('testImport replaces the module test and expect come from', () => {
    const { code } = renderSpec(buildSession([step()], 0), { testImport: '../fixtures' });
    expect(code).toContain(`import { test, expect } from '../fixtures';`);
    expect(code).not.toContain('@playwright/test');
  });

  test('relative urls write the recorded origin as paths and leave other origins alone', () => {
    const session = buildSession(
      [
        step({ action: 'goto', target: null, value: at('/login?next=%2Fcart'), pageUrl: at('/login') }),
        step({ action: 'goto', target: null, value: 'https://pay.example/checkout', pageUrl: at('/login') }),
      ],
      0,
    );
    const { code } = renderSpec(session, { urls: 'relative' });
    expect(code).toContain(`await page.goto('/login?next=%2Fcart');`);
    expect(code).toContain(`await page.goto('https://pay.example/checkout');`);
  });

  test('the leading goto from startUrl follows the url mode too', () => {
    const session = buildSession([step()], 0);
    session.startUrl = at('/login');
    expect(renderSpec(session, { urls: 'relative' }).code).toContain(`await page.goto('/login');`);
  });

  test('stable locators skip a brittle first alternative; the default keeps it and warns', () => {
    const session = buildSession([step({ target: target({ alternatives: [brittle, byRole] }) })], 0);
    const first = renderSpec(session);
    expect(first.code).toContain(`page.locator('.btn').nth(1).click()`);
    expect(first.warnings).toEqual([
      expect.objectContaining({ step: 0, code: 'brittle-locator', detail: `locator('.btn').nth(1)` }),
    ]);
    const stable = renderSpec(session, { locators: 'stable' });
    expect(stable.code).toContain(`page.getByRole('button', { name: 'Log in' }).click()`);
    expect(stable.warnings).toEqual([]);
  });

  test('a chain the suite already uses comes first, unless it is brittle', () => {
    const byTestId = { locator: `getByTestId('login')`, method: 'getByTestId', score: 100 };
    const session = buildSession([step({ target: target({ alternatives: [byTestId, byRole, brittle] }) })], 0);
    const preferred = renderSpec(session, { preferLocators: new Set([byRole.locator]) });
    expect(preferred.code).toContain(`page.getByRole('button', { name: 'Log in' }).click()`);
    const brittleKnown = renderSpec(session, { preferLocators: new Set([brittle.locator]) });
    expect(brittleKnown.code).toContain(`page.getByTestId('login').click()`);
  });

  test('url checks wait for the next page after a step that leads to it, then for its element alone', () => {
    const session = buildSession(
      [
        step({ pageUrl: at('/login') }),
        step({ pageUrl: at('/orders/42'), target: target({ accessibleName: 'Pay' }) }),
        step({ pageUrl: at('/orders/42?tab=items'), target: target({ accessibleName: 'Items' }) }),
      ],
      0,
    );
    const { code } = renderSpec(session, { urlChecks: true });
    const lines = code.split('\n').map((l) => l.trim());
    const login = lines.indexOf(`await page.getByRole('button', { name: 'Log in' }).click();`);
    expect(lines[login + 1]).toBe('await expect(page).toHaveURL(/\\/orders\\/[^/?#]+(?:[?#]|$)/);');
    // The page it left can still be on screen: an action would fail on a match there, the count waits it out.
    expect(lines[login + 2]).toBe(`await expect(page.getByRole('button', { name: 'Pay' })).toHaveCount(1);`);
    expect(lines[login + 3]).toBe(`await page.getByRole('button', { name: 'Pay' }).click();`);
    // The query changes, the page does not: no second check.
    expect(code.match(/toHaveURL/g)).toHaveLength(1);
    expect(code.match(/toHaveCount/g)).toHaveLength(1);
  });

  test('page url patterns match the page with any id and nothing else', () => {
    const regex = (url: string) => new Function(`return ${pageUrlPattern(url)}`)() as RegExp;
    const orders = regex('https://x.test/orders/42');
    expect(orders.test('http://localhost:3000/orders/7')).toBe(true);
    expect(orders.test('http://localhost:3000/orders/7?tab=items#top')).toBe(true);
    expect(orders.test('http://localhost:3000/orders/7/items')).toBe(false);
    const root = regex('https://x.test/');
    expect(root.test('http://localhost:3000/')).toBe(true);
    expect(root.test('http://localhost:3000')).toBe(true);
    expect(root.test('http://localhost:3000/cart')).toBe(false);
    const odd = regex('https://x.test/a.b(c)/d');
    expect(odd.test('https://x.test/a.b(c)/d')).toBe(true);
    expect(odd.test('https://x.test/aXb(c)/d')).toBe(false);
    expect(pageUrlPattern('mailto:someone@example.com')).toBeNull();
  });

  test('env values read every typed value from the environment', () => {
    const field = target({ role: 'textbox', accessibleName: 'Email' });
    const session = buildSession([step({ action: 'fill', value: 'ana@acme.test', target: field })], 0);
    const { code } = renderSpec(session, { values: 'env' });
    expect(code).toContain(`.fill(process.env.PIWI_TEST_VALUE_0 ?? '');`);
    expect(code).toContain('// Typed values come from PIWI_TEST_VALUE_0.');
    expect(code).not.toContain('ana@acme.test');
  });

  test('a redacted value warns', () => {
    const session = buildSession([step({ action: 'fill', value: null, redacted: true })], 0);
    expect(renderSpec(session).warnings).toEqual([
      expect.objectContaining({ code: 'redacted-value', detail: 'PIWI_TEST_VALUE_0' }),
    ]);
  });

  test('expectFail, tags and annotations shape the test declaration', () => {
    const { code } = renderSpec(buildSession([step()], 0), {
      title: 'bug: coupon ignored',
      expectFail: { reason: 'SHOP-812: passes while\nthe bug exists' },
      tags: ['bug', '@checkout'],
      annotations: [{ type: 'piwi:bug', description: "37 'quoted'" }, { type: 'slow' }],
    });
    expect(code).toContain(
      [
        `test('bug: coupon ignored', {`,
        `  tag: ['@bug', '@checkout'],`,
        `  annotation: [`,
        `    { type: 'piwi:bug', description: '37 \\'quoted\\'' },`,
        `    { type: 'slow' },`,
        `  ],`,
        `}, async ({ page }) => {`,
        `  test.fail(); // SHOP-812: passes while the bug exists`,
      ].join('\n'),
    );
  });

  test('body format holds only the lines to paste, with the imports they need', () => {
    const logIn: TestFunctionEntry = {
      id: 9,
      name: 'logIn',
      kind: 'page-object-method',
      module: './pages/login',
      receiver: 'loginPage',
      importName: 'LoginPage',
      params: [],
      urlPattern: null,
      steps: [{ action: 'click', target: { role: 'button', name: 'Log in' } }],
      paramSources: [],
    };
    const search = target({ role: 'searchbox', tagName: 'input', accessibleName: 'Search' });
    const session = buildSession([step(), step({ action: 'fill', value: 'mug', target: search })], 0);
    const { code } = renderSpec(session, { format: 'body', catalog: [logIn] });
    expect(code).toBe(
      [
        `  // Needs: import { LoginPage } from './pages/login';`,
        `  const loginPage = new LoginPage(page);`,
        `  await page.goto('https://x.test/login');`,
        `  await loginPage.logIn();`,
        `  await page.getByRole('searchbox', { name: 'Search' }).fill('mug');`,
        ``,
      ].join('\n'),
    );
  });
});

describe('renderSpec — assertions', () => {
  const total = target({ role: null, tagName: 'output', accessibleName: null, testId: 'cart-total' });

  test('a value assertion writes the expected value and the recorded one beside it', () => {
    const session = buildSession(
      [
        step({
          action: 'assert',
          target: total,
          assertion: { matcher: 'toHaveText', expected: 'Total: 42', actual: 'Total: 40', negated: false, note: null },
        }),
      ],
      0,
    );
    expect(renderSpec(session).code).toContain(
      `await expect(page.getByTestId('cart-total')).toHaveText('Total: 42'); // recorded: 'Total: 40'`,
    );
  });

  test('state assertions, negation and notes', () => {
    const session = buildSession(
      [
        step({
          action: 'assert',
          target: total,
          assertion: { matcher: 'toBeVisible', expected: null, actual: null, negated: true, note: 'gone\nafter pay' },
        }),
      ],
      0,
    );
    const { code } = renderSpec(session);
    expect(code).toContain('  // gone after pay\n');
    expect(code).toContain(`await expect(page.getByTestId('cart-total')).not.toBeVisible();`);
  });

  test('toHaveURL checks the page and follows the url mode', () => {
    const assertion = { matcher: 'toHaveURL' as const, expected: '/thanks', actual: null, negated: false, note: null };
    const session = buildSession([step({ action: 'assert', target: null, assertion })], 0);
    session.startUrl = 'https://x.test/cart';
    expect(renderSpec(session, { urls: 'relative' }).code).toContain(`await expect(page).toHaveURL('/thanks');`);
    expect(renderSpec(session).code).toContain(`await expect(page).toHaveURL('https://x.test/thanks');`);
  });

  test('an assertion with nothing to check becomes a comment and a warning', () => {
    const session = buildSession(
      [
        step({ action: 'assert', target: total }),
        step({
          action: 'assert',
          target: total,
          assertion: { matcher: 'toHaveText', expected: null, actual: null, negated: false, note: null },
        }),
      ],
      0,
    );
    const { code, warnings } = renderSpec(session);
    expect(code).not.toContain('expect(page.getByTestId');
    expect(warnings.map((w) => w.code)).toEqual(['incomplete-assertion', 'incomplete-assertion']);
  });

  test('the legacy assertVisible step still renders', () => {
    const session = buildSession([step({ action: 'assertVisible', target: total })], 0);
    expect(renderSpec(session).code).toContain(`await expect(page.getByTestId('cart-total')).toBeVisible();`);
  });
});

describe('renderSpec — only steps, never code', () => {
  test('a locator that is not a Playwright chain is never written into the spec', () => {
    const evil = { locator: `getByRole('x')); process.exit(1); ((0`, method: 'getByRole', score: 99 };
    const session = buildSession([step({ target: target({ alternatives: [evil] }) })], 0);
    const { code, warnings } = renderSpec(session);
    expect(code).not.toContain('process.exit');
    expect(code).toContain(`page.locator('/* no locator captured */').click()`);
    expect(warnings).toEqual([expect.objectContaining({ code: 'no-locator' })]);
  });

  test('a regex argument must be a valid pattern on one line', () => {
    expect(safeLocator('getByText(/total/i)')?.text).toBe('getByText(/total/i)');
    expect(safeLocator('getByText(/a\nb/)')).toBeNull();
    expect(safeLocator('getByText(/(/)')).toBeNull();
    expect(safeLocator('getByText(/x/zz)')).toBeNull();
  });

  test('a locator is re-rendered in canonical form', () => {
    expect(safeLocator(`getByRole("button", {name: "Pay"})`)?.text).toBe(`getByRole('button', { name: 'Pay' })`);
  });

  test('a spec with every option parses as TypeScript', () => {
    const session = buildSession(
      [
        step({ action: 'goto', target: null, value: 'https://x.test/cart', pageUrl: 'https://x.test/cart' }),
        step({ action: 'fill', value: `it's "quoted"\n`, pageUrl: 'https://x.test/cart' }),
        step({ action: 'press', target: null, value: 'Enter', pageUrl: 'https://x.test/cart' }),
        step({ pageUrl: 'https://x.test/cart' }),
        step({
          action: 'assert',
          pageUrl: 'https://x.test/orders/9',
          target: target({ testId: 'total' }),
          assertion: { matcher: 'toHaveText', expected: 'a b', actual: `x'y`, negated: true, note: '*/ // note' },
        }),
      ],
      0,
    );
    const { code } = renderSpec(session, {
      title: `bug: it's \n broken`,
      testImport: `../fix'tures`,
      urls: 'relative',
      locators: 'stable',
      urlChecks: true,
      expectFail: { reason: 'SHOP-1 */' },
      tags: ['bug'],
      annotations: [{ type: 'piwi:link', description: 'https://x.test/a?b=1&c= ' }],
    });
    const out = ts.transpileModule(code, {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    });
    expect(out.diagnostics ?? []).toEqual([]);
  });
});
