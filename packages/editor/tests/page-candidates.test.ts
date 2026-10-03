import { describe, expect, test } from 'vitest';
import { pageCandidates, recordingPlacement, testImportOf } from '../src/recorder/page-candidates';

const file = (...lines: string[]) => lines.join('\n');
/** The 0-based line holding `marker` (a comment such as `// here`), for a caret placed on it. */
const lineOf = (text: string, marker: string) => text.split(/\r?\n/).findIndex((l) => l.includes(marker));
const expressions = (text: string, line: number) => pageCandidates(text, line).candidates.map((c) => c.expression);

const SPEC = file(
  "import { test, expect } from '@playwright/test';",
  '',
  "test('pays', async ({ page }) => {",
  "  await page.goto('/cart');",
  '',
  '});',
  '',
  "test('signs in', async ({ page, request }) => {",
  "  await page.getByRole('button', { name: 'Sign in' }).click();",
  '});',
  '',
);

describe('pageCandidates', () => {
  test('in a test with page: the page it uses, as the test body context', () => {
    const result = pageCandidates(SPEC, 4);
    expect(result).toEqual({
      context: 'test',
      default: 'page',
      candidates: [{ expression: 'page', reason: 'used on line 4' }],
    });
  });

  test('a test with page and no call yet offers its page fixture', () => {
    const text = file("test('empty', async ({ page }) => {", '', '});');
    expect(pageCandidates(text, 1)).toEqual({
      context: 'test',
      default: 'page',
      candidates: [{ expression: 'page', reason: 'fixture of this test' }],
    });
  });

  test('with two fixtures: the receiver of the nearest page call before the caret, then the other', () => {
    const text = file(
      "test('approves', async ({ adminPage, userPage }) => {",
      "  await adminPage.goto('/admin');",
      "  await userPage.goto('/inbox');",
      "  await userPage.getByRole('button', { name: 'Request' }).click();",
      '  // here',
      "  await adminPage.getByText('Approve').click();",
      '});',
    );
    const result = pageCandidates(text, lineOf(text, '// here'));
    expect(result.context).toBe('test');
    expect(result.default).toBe('userPage');
    expect(result.candidates).toEqual([
      { expression: 'userPage', reason: 'used on line 4' },
      { expression: 'adminPage', reason: 'used on line 2' },
    ]);
  });

  test('with two fixtures and no call yet: the first page fixture', () => {
    const text = file("test('approves', async ({ adminPage, userPage, request }) => {", '', '});');
    const result = pageCandidates(text, 1);
    expect(result.default).toBe('adminPage');
    expect(result.candidates.map((c) => [c.expression, c.reason])).toEqual([
      ['adminPage', 'fixture of this test'],
      ['userPage', 'fixture of this test'],
    ]);
  });

  test('a renamed fixture is offered by its local name', () => {
    const text = file("test('t', async ({ adminPage: admin }) => {", '', '});');
    expect(pageCandidates(text, 1).default).toBe('admin');
  });

  test('a popup variable, opened from a waitForEvent promise, becomes the default once used', () => {
    const text = file(
      "test('opens the invoice', async ({ page }) => {",
      "  const popupPromise = page.waitForEvent('popup');",
      "  await page.getByRole('link', { name: 'Invoice' }).click();",
      '  const popup = await popupPromise;',
      "  await popup.getByRole('heading').isVisible();",
      '  // here',
      '});',
    );
    const result = pageCandidates(text, lineOf(text, '// here'));
    expect(result.default).toBe('popup');
    expect(result.candidates).toEqual([
      { expression: 'popup', reason: 'used on line 5' },
      { expression: 'page', reason: 'used on line 3' },
    ]);
  });

  test('a page variable not used yet is offered after the receivers, with where it was opened', () => {
    const text = file(
      "test('two tabs', async ({ page, context }) => {",
      "  await page.goto('/');",
      '  const second = await context.newPage();',
      '  const [popup] = await Promise.all([page.waitForEvent("popup"), page.click("a")]);',
      '  let other: Page;',
      '  // here',
      '});',
    );
    const result = pageCandidates(text, lineOf(text, '// here'));
    expect(result.default).toBe('page');
    expect(result.candidates).toEqual([
      { expression: 'page', reason: 'used on line 4' },
      { expression: 'other', reason: 'declared on line 5' },
      { expression: 'popup', reason: 'opened on line 4' },
      { expression: 'second', reason: 'opened on line 3' },
    ]);
  });

  test('in a page object: this.page, as a class context', () => {
    const text = file(
      "import type { Locator, Page } from '@playwright/test';",
      '',
      'export class SignInPage {',
      '  readonly email: Locator;',
      '',
      '  constructor(private readonly page: Page) {',
      "    this.email = page.getByLabel('Email');",
      '  }',
      '',
      '  async signIn() {',
      '    // here',
      '  }',
      '}',
    );
    const result = pageCandidates(text, lineOf(text, '// here'));
    expect(result).toEqual({
      context: 'class',
      default: 'this.page',
      candidates: [{ expression: 'this.page', reason: 'field of SignInPage' }],
    });
  });

  test('in a page object: the receiver used before the caret comes first, then the class fields', () => {
    const text = file(
      'export class CheckoutPage {',
      '  readonly page: Page;',
      '  readonly adminPage: Page;',
      '  constructor(page: Page, adminPage: Page) {',
      '    this.page = page;',
      '    this.adminPage = adminPage;',
      '  }',
      '  async approve() {',
      "    await this.adminPage.goto('/approve');",
      '    // here',
      '  }',
      '}',
    );
    const result = pageCandidates(text, lineOf(text, '// here'));
    expect(result.context).toBe('class');
    expect(result.candidates).toEqual([
      { expression: 'this.adminPage', reason: 'used on line 9' },
      { expression: 'this.page', reason: 'field of CheckoutPage' },
    ]);
  });

  test('a class whose constructor assigns this.page offers it', () => {
    const text = file(
      'class Cart {',
      '  constructor(page) {',
      '    this.page = page;',
      '  }',
      '  add() {',
      '    // here',
      '  }',
      '}',
    );
    expect(pageCandidates(text, lineOf(text, '// here')).default).toBe('this.page');
  });

  test('a fixture object: the member chain the test calls the page through', () => {
    const text = file(
      "test('orders', async ({ app }) => {",
      "  await app.page.goto('/orders');",
      '  await app.openOrders();',
      '',
      '});',
    );
    const result = pageCandidates(text, 3);
    expect(result.default).toBe('app.page');
    expect(result.candidates).toEqual([{ expression: 'app.page', reason: 'used on line 2' }]);
  });

  test('a page object fixture whose methods are not a page’s is not offered', () => {
    const text = file("test('t', async ({ page, cartPage }) => {", '  await cartPage.addProduct("mug");', '', '});');
    const result = pageCandidates(text, 2);
    expect(result.default).toBe('page');
    // `cartPage` is a fixture whose name looks like a page's: offered after `page`, never ahead of it.
    expect(result.candidates[0]).toEqual({ expression: 'page', reason: 'fixture of this test' });
  });

  test('a locator variable is not a page', () => {
    const text = file(
      "test('t', async ({ page }) => {",
      "  const form = page.locator('form');",
      "  await form.getByRole('button').click();",
      "  await form.fill('x');",
      '',
      '});',
    );
    expect(expressions(text, 4)).toEqual(['page']);
  });

  test('between tests: a file context, with the fixtures of the tests around it', () => {
    const text = file(
      "test('a', async ({ adminPage }) => {",
      "  await adminPage.goto('/');",
      '});',
      '',
      "test('b', async ({ page }) => {});",
    );
    const result = pageCandidates(text, 3);
    expect(result.context).toBe('file');
    expect(result.default).toBe('adminPage');
    expect(result.candidates).toEqual([
      { expression: 'adminPage', reason: 'fixture in this file' },
      { expression: 'page', reason: 'fixture in this file' },
    ]);
  });

  test('on the closing line of a test the block goes after it: between tests', () => {
    expect(pageCandidates(SPEC, 5).context).toBe('file');
    expect(pageCandidates(SPEC, 2).context).toBe('test');
  });

  test('at the top of the file: page', () => {
    expect(pageCandidates(SPEC, 0)).toEqual({
      context: 'file',
      default: 'page',
      candidates: [{ expression: 'page', reason: 'fixture in this file' }],
    });
    expect(pageCandidates('', 0)).toEqual({
      context: 'file',
      default: 'page',
      candidates: [{ expression: 'page', reason: "Playwright's page fixture" }],
    });
  });

  test('inside a test.describe, between its tests', () => {
    const text = file(
      "test.describe('checkout', () => {",
      '  test.beforeEach(async ({ page }) => {',
      "    await page.goto('/checkout');",
      '  });',
      '',
      "  test('pays', async ({ page }) => {",
      '    // inside',
      '  });',
      '});',
    );
    expect(pageCandidates(text, 4)).toMatchObject({ context: 'file', default: 'page' });
    expect(pageCandidates(text, lineOf(text, '// inside'))).toMatchObject({ context: 'test', default: 'page' });
    // A hook's body counts as a test's.
    expect(pageCandidates(text, 2).context).toBe('test');
  });

  test('a module-level page from beforeAll is offered in a test that uses it', () => {
    const text = file(
      'let page: Page;',
      'test.beforeAll(async ({ browser }) => {',
      '  page = await browser.newPage();',
      '});',
      "test('a', async () => {",
      "  await page.goto('/');",
      '',
      '});',
    );
    expect(pageCandidates(text, 6)).toMatchObject({ context: 'test', default: 'page' });
  });

  test('in a helper function: its Page parameter', () => {
    const text = file(
      "import type { Page } from '@playwright/test';",
      'export async function signIn(target: Page, email: string) {',
      '  // here',
      '}',
    );
    expect(pageCandidates(text, 2)).toEqual({
      context: 'file',
      default: 'target',
      candidates: [{ expression: 'target', reason: 'declared on line 2' }],
    });
  });

  test('with CRLF line endings', () => {
    const text = SPEC.replace(/\n/g, '\r\n');
    expect(pageCandidates(text, 4)).toMatchObject({ context: 'test', default: 'page' });
    expect(pageCandidates(text, 5).context).toBe('file');
  });

  test('code inside strings, template literals, regular expressions and comments does not count', () => {
    const text = file(
      "test('a ) { in the title', async ({ page, userPage }) => {",
      '  const s = "adminPage.goto(\'/\') }";',
      '  const t = `${userPage.url()} } adminPage.goto(`;',
      "  // adminPage.goto('/');",
      "  /* adminPage.goto('/') } */",
      '  await expect(page).toHaveURL(/\\/a(?:[?#]|$)\\)}/);',
      '  // here',
      '});',
    );
    const result = pageCandidates(text, lineOf(text, '// here'));
    expect(result.context).toBe('test');
    expect(result.candidates).toEqual([
      { expression: 'page', reason: 'used on line 6' },
      { expression: 'userPage', reason: 'fixture of this test' },
    ]);
  });

  test('a page of another test is not offered', () => {
    const text = file(
      "test('a', async ({ adminPage }) => {",
      "  await adminPage.goto('/');",
      '});',
      "test('b', async ({ page }) => {",
      '',
      '});',
    );
    expect(expressions(text, 4)).toEqual(['page']);
  });
});

describe('recordingPlacement', () => {
  test('a blank caret line takes the block; a line with text gets a new line after it', () => {
    expect(recordingPlacement(SPEC, 4, 'steps')).toEqual({ line: 4, newLine: false, indent: '  ' });
    expect(recordingPlacement(SPEC, 3, 'steps')).toEqual({ line: 4, newLine: true, indent: '  ' });
  });

  test('a new test between tests goes at the top-level indentation', () => {
    expect(recordingPlacement(SPEC, 6, 'test')).toEqual({ line: 6, newLine: false, indent: '' });
    expect(recordingPlacement(SPEC, 5, 'test')).toEqual({ line: 6, newLine: true, indent: '' });
  });

  test('a new test inside a test.describe follows the tests around it', () => {
    const text = file(
      "test.describe('checkout', () => {",
      "    test('pays', async ({ page }) => {",
      '    });',
      '',
      '});',
    );
    expect(recordingPlacement(text, 3, 'test')).toEqual({ line: 3, newLine: false, indent: '    ' });
  });

  test('an empty describe or test body takes its opening line’s indentation plus the file’s step', () => {
    const fourSpaces = file(
      'function helper() {',
      '    return 1;',
      '}',
      "test.describe('empty', () => {",
      "    test('t', async ({ page }) => {",
      '    });',
      '});',
    );
    expect(recordingPlacement(fourSpaces, 4, 'steps')).toEqual({ line: 5, newLine: true, indent: '        ' });
    const tabs = file("test('t', async ({ page }) => {", '\tawait page.goto("/");', '});', "test('u', () => {", '});');
    expect(recordingPlacement(tabs, 3, 'steps')).toEqual({ line: 4, newLine: true, indent: '\t' });
  });

  test('a body’s first lines set the indentation, past continuation lines and strings', () => {
    const text = file(
      "test('t', async ({ page }) => {",
      '   await page',
      "       .goto('/');",
      '   const s = `',
      'text',
      '`;',
      '',
      '});',
    );
    expect(recordingPlacement(text, 6, 'steps')).toEqual({ line: 6, newLine: false, indent: '   ' });
  });

  test('a page object’s method body', () => {
    const text = file('class A {', '  async go() {', '    await this.page.goto("/");', '  }', '}');
    expect(recordingPlacement(text, 2, 'steps')).toEqual({ line: 3, newLine: true, indent: '    ' });
  });

  test('with CRLF line endings', () => {
    expect(recordingPlacement(SPEC.replace(/\n/g, '\r\n'), 3, 'steps')).toEqual({
      line: 4,
      newLine: true,
      indent: '  ',
    });
  });

  test('a new file starts at its first line', () => {
    expect(recordingPlacement('', 0, 'file')).toEqual({ line: 0, newLine: false, indent: '' });
  });

  test('a caret past the end of the file stays on its last line', () => {
    expect(recordingPlacement(SPEC, 99, 'test')).toEqual({
      line: SPEC.split('\n').length - 1,
      newLine: false,
      indent: '',
    });
  });
});

describe('testImportOf', () => {
  test('the module the file imports test from', () => {
    expect(testImportOf(SPEC)).toBe('@playwright/test');
    expect(testImportOf("import { expect, test } from './fixtures';\n")).toBe('./fixtures');
    expect(testImportOf("import fixtures, { test } from '../support';\n")).toBe('../support');
  });

  test('none when test is renamed, declared in the file, imported as a type, or absent', () => {
    expect(
      testImportOf("import { test as base } from '@playwright/test';\nexport const test = base.extend({});"),
    ).toBeNull();
    expect(testImportOf("import type { test } from './fixtures';")).toBeNull();
    expect(testImportOf("// import { test } from './fixtures';\nconst x = 1;")).toBeNull();
    expect(testImportOf('')).toBeNull();
  });
});
