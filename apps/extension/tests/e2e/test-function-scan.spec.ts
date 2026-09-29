import { test, expect } from './fixtures.js';
import { testCatalogAgainstPage } from '../../src/content/test-function-scan.js';
import { domRoleOf } from '@piwitests/picker-dom';
import { scoreTargetMatch, type TestFunctionEntry } from '@piwitests/core/function-match';
import { TAG_TO_ROLE, INPUT_TYPE_TO_ROLE } from '@piwitests/core/locator-generation';
import type { Page } from '@playwright/test';
import { engineBundle } from './engine-bundle.js';

const MAPS = { tagRoles: TAG_TO_ROLE, inputRoles: INPUT_TYPE_TO_ROLE };

/**
 * `testCatalogAgainstPage` nests every helper inside its own body for the
 * same reason `derivePattern` does (see that function's e2e test): only its
 * genuine cross-module imports — `domRoleOf`, `scoreTargetMatch` — need
 * installing as globals first. Names come from the engine bundle's `DomModel`,
 * as the panel passes them.
 */
async function evalScan(page: Page, catalog: TestFunctionEntry[]) {
  await page.addScriptTag({ path: await engineBundle() });
  await page.evaluate(
    ([roleSrc, scoreSrc]) => {
      (globalThis as any).domRoleOf = new Function(`return (${roleSrc})`)();
      (globalThis as any).scoreTargetMatch = new Function(`return (${scoreSrc})`)();
    },
    [domRoleOf.toString(), scoreTargetMatch.toString()],
  );
  return page.evaluate(
    ([fnSrc, cat, maps]) => {
      const scan = new Function(`return (${fnSrc})`)() as typeof testCatalogAgainstPage;
      const nameOf = (globalThis as any).__piwiAccessibleName as (el: Element) => string | null;
      return scan(cat as TestFunctionEntry[], maps as typeof MAPS, nameOf);
    },
    [testCatalogAgainstPage.toString(), catalog, MAPS] as const,
  );
}

function entry(overrides: Partial<TestFunctionEntry> = {}): TestFunctionEntry {
  return {
    id: 1,
    name: 'addToCart',
    kind: 'helper',
    module: './helpers/cart',
    receiver: null,
    importName: null,
    params: [],
    urlPattern: null,
    steps: [{ action: 'click', target: { role: 'button', name: 'Add to cart' } }],
    paramSources: [],
    ...overrides,
  };
}

test.describe('testCatalogAgainstPage', () => {
  test('a single step that resolves to exactly one element is "ready"', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>Add to cart</button></body></html>`);
    const [result] = await evalScan(page, [entry()]);
    expect(result!.verdict).toBe('ready');
    expect(result!.steps[0]).toMatchObject({ matchCount: 1, verdict: 'unique' });
  });

  test('names a composite control as Playwright does, with a space before its badge', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <div role="tablist"><button role="tab">Regressions<span style="display:inline-flex">5</span></button></div>
    </body></html>`);
    const [result] = await evalScan(page, [
      entry({ steps: [{ action: 'click', target: { role: 'tab', name: 'Regressions 5' } }] }),
    ]);
    expect(result!.steps[0]).toMatchObject({ matchCount: 1, verdict: 'unique' });
    await expect(page.getByRole('tab', { name: 'Regressions 5' })).toHaveCount(1);
  });

  test('a step matching nothing on the page is "not-found"', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>Checkout</button></body></html>`);
    const [result] = await evalScan(page, [entry()]);
    expect(result!.verdict).toBe('not-found');
    expect(result!.steps[0]).toMatchObject({ matchCount: 0, verdict: 'missing' });
  });

  test('a step matching multiple elements is ambiguous, not ready', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(
      `<!doctype html><html><body><button>Add to cart</button><button>Add to cart</button></body></html>`,
    );
    const [result] = await evalScan(page, [entry()]);
    expect(result!.verdict).toBe('partial');
    expect(result!.steps[0]).toMatchObject({ matchCount: 2, verdict: 'ambiguous' });
  });

  test('a multi-step function is "ready" only when every step resolves uniquely', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <input data-testid="username-field" />
      <button>Log in</button>
    </body></html>`);
    const loginEntry = entry({
      id: 2,
      name: 'login',
      steps: [
        { action: 'fill', target: { testId: 'username-field' } },
        { action: 'click', target: { role: 'button', name: 'Log in' } },
      ],
    });
    const [result] = await evalScan(page, [loginEntry]);
    expect(result!.verdict).toBe('ready');
    expect(result!.steps.map((s) => s.verdict)).toEqual(['unique', 'unique']);
  });

  test('a multi-step function with one missing step is "partial", not "ready"', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><input data-testid="username-field" /></body></html>`);
    const loginEntry = entry({
      id: 2,
      name: 'login',
      steps: [
        { action: 'fill', target: { testId: 'username-field' } },
        { action: 'click', target: { role: 'button', name: 'Log in' } },
      ],
    });
    const [result] = await evalScan(page, [loginEntry]);
    expect(result!.verdict).toBe('partial');
    expect(result!.steps.map((s) => s.verdict)).toEqual(['unique', 'missing']);
  });

  test('testId matching takes priority and ignores role/name entirely', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><div data-testid="sku-42">irrelevant text</div></body></html>`);
    const testIdEntry = entry({ steps: [{ action: 'click', target: { testId: 'sku-42' } }] });
    const [result] = await evalScan(page, [testIdEntry]);
    expect(result!.verdict).toBe('ready');
  });

  test('scans every catalog entry independently in one pass', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><button>Add to cart</button></body></html>`);
    const results = await evalScan(page, [
      entry({ id: 1, name: 'addToCart' }),
      entry({ id: 2, name: 'checkout', steps: [{ action: 'click', target: { role: 'button', name: 'Checkout' } }] }),
    ]);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.entry.name === 'addToCart')!.verdict).toBe('ready');
    expect(results.find((r) => r.entry.name === 'checkout')!.verdict).toBe('not-found');
  });
});
