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
 * as the panel passes them; the elements are the page's and its open shadow
 * roots', and an element counts as hidden when the browser does not render it
 * or it sits under `aria-hidden`. The panel's own wiring, through the page
 * engine, is checked in `test-function-panel.spec.ts`.
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
      const elements: Element[] = [];
      const visit = (root: Document | ShadowRoot) => {
        for (const el of root.querySelectorAll('*')) {
          elements.push(el);
          if (el.shadowRoot) visit(el.shadowRoot);
        }
      };
      visit(document);
      const isHidden = (el: Element) =>
        !el.checkVisibility({ visibilityProperty: true }) || !!el.closest('[aria-hidden="true"]');
      return scan(cat as TestFunctionEntry[], maps as typeof MAPS, { elements, nameOf, isHidden });
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

  test('skips a hidden copy of the element, as getByRole does', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <nav class="desktop"><a href="/pricing">Pricing</a></nav>
      <nav class="mobile" style="display:none"><a href="/pricing">Pricing</a></nav>
    </body></html>`);
    const [result] = await evalScan(page, [
      entry({ steps: [{ action: 'click', target: { role: 'link', name: 'Pricing' } }] }),
    ]);
    expect(result!.steps[0]).toMatchObject({ matchCount: 1, verdict: 'unique' });
    await expect(page.getByRole('link', { name: 'Pricing' })).toHaveCount(1);
  });

  test('counts a hidden copy of a test id, as getByTestId does', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button data-testid="pricing">Pricing</button>
      <button data-testid="pricing" style="display:none">Pricing</button>
    </body></html>`);
    const [result] = await evalScan(page, [entry({ steps: [{ action: 'click', target: { testId: 'pricing' } }] })]);
    expect(result!.steps[0]).toMatchObject({ matchCount: 2, verdict: 'ambiguous' });
    await expect(page.getByTestId('pricing')).toHaveCount(2);
  });

  test('finds elements inside a web component', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body><cart-widget></cart-widget><script>
      customElements.define('cart-widget', class extends HTMLElement {
        constructor() {
          super();
          this.attachShadow({ mode: 'open' }).innerHTML = '<button data-testid="checkout">Check out</button>';
        }
      });
    </script></body></html>`);
    const [byRole, byTestId] = await evalScan(page, [
      entry({ steps: [{ action: 'click', target: { role: 'button', name: 'Check out' } }] }),
      entry({ id: 2, steps: [{ action: 'click', target: { testId: 'checkout' } }] }),
    ]);
    expect(byRole!.verdict).toBe('ready');
    expect(byTestId!.verdict).toBe('ready');
    await expect(page.getByRole('button', { name: 'Check out' })).toHaveCount(1);
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
