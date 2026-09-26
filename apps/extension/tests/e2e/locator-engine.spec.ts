import { test, expect, selectors, type Locator, type Page } from '@playwright/test';
import { parseLocatorChain, type LocatorArg, type LocatorChain } from '@piwitests/core/locator-chain';
import { engineBundle, servePages, tagElements } from './engine-bundle.js';
import { EDGE_CASES, LOCATOR_CASES } from './locator-cases.js';

/**
 * The extension's locator engine against Playwright itself: every expression
 * is resolved by the real test runner and by the engine on the same page, and
 * the two must return the same elements in the same order, or both refuse the
 * expression. Elements are compared by a `data-eid` tag set on every element
 * of every frame beforehand.
 */

const ORIGIN = 'https://engine.test';

/** Expressions Playwright itself rejects; the engine must reject them too. */
const EXPECTED_REFUSALS = new Set([
  "getByRole('button', { checked: true })",
  "getByRole('link', { level: 1 })",
  "locator('invalid[[[')",
  "locator('button:nth-match(2)')",
]);

interface Outcome {
  ids?: Array<string | null>;
  error?: string;
}

function argValue(page: Page, arg: LocatorArg): unknown {
  switch (arg.type) {
    case 'string':
    case 'number':
    case 'boolean':
      return arg.value;
    case 'regex':
      return new RegExp(arg.source, arg.flags);
    case 'object':
      return Object.fromEntries(arg.entries.map(([key, value]) => [key, argValue(page, value)]));
    case 'chain':
      return playwrightLocator(page, arg.chain);
  }
}

/** The chain rebuilt with the real Playwright API: each call name is the method of the same name. */
function playwrightLocator(page: Page, chain: LocatorChain): Locator {
  let current: unknown = page;
  for (const call of chain.calls) {
    const args = call.args.map((arg) => argValue(page, arg));
    const target = current as Record<string, (...a: unknown[]) => unknown>;
    current = target[call.method]!(...args);
  }
  return current as Locator;
}

async function playwrightOutcome(page: Page, expression: string): Promise<Outcome> {
  try {
    const locator = playwrightLocator(page, parseLocatorChain(expression));
    const ids = await Promise.race([
      locator.evaluateAll((elements) => elements.map((e) => e.getAttribute('data-eid'))),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 5000)),
    ]);
    return { ids };
  } catch (error) {
    return { error: (error as Error).message.split('\n')[0] };
  }
}

async function engineOutcomes(page: Page, expressions: string[], testIdAttributes?: string[]): Promise<Outcome[]> {
  return page.evaluate(
    ([list, attributes]) =>
      (
        globalThis as unknown as { __piwiEngineQueryAll: (e: string[], a?: string[]) => Outcome[] }
      ).__piwiEngineQueryAll(list, attributes),
    [expressions, testIdAttributes] as const,
  );
}

async function openFixture(page: Page, file = 'locator-kinds.html'): Promise<void> {
  await servePages(page, ORIGIN);
  await page.goto(`${ORIGIN}/${file}`);
  if (file === 'locator-kinds.html') {
    await page
      .frameLocator('#child-frame')
      .frameLocator('#grandchild')
      .getByRole('button', { name: 'Verify' })
      .waitFor();
  }
  await tagElements(page);
  await page.addScriptTag({ path: await engineBundle() });
}

function describe(outcome: Outcome): string {
  return outcome.error !== undefined ? `error: ${outcome.error}` : JSON.stringify(outcome.ids);
}

async function compare(page: Page, expressions: string[], testIdAttributes?: string[]) {
  const engine = await engineOutcomes(page, expressions, testIdAttributes);
  const mismatches: string[] = [];
  let matchedSomething = 0;
  for (const [i, expression] of expressions.entries()) {
    const expected = await playwrightOutcome(page, expression);
    const actual = engine[i]!;
    if (expected.ids?.length) matchedSomething++;
    const agree =
      expected.error !== undefined
        ? actual.error !== undefined
        : actual.error === undefined && JSON.stringify(actual.ids) === JSON.stringify(expected.ids);
    if (expected.error !== undefined && !EXPECTED_REFUSALS.has(expression)) {
      mismatches.push(`${expression}\n    unexpectedly refused by Playwright: ${expected.error}`);
    }
    if (!agree) {
      mismatches.push(`${expression}\n    playwright: ${describe(expected)}\n    engine:     ${describe(actual)}`);
    }
  }
  return { mismatches, matchedSomething };
}

test.describe('locator engine matches Playwright', () => {
  for (const [group, expressions] of Object.entries(LOCATOR_CASES)) {
    test(group, async ({ page }) => {
      await openFixture(page);
      const { mismatches, matchedSomething } = await compare(page, expressions);
      expect(mismatches, mismatches.join('\n')).toEqual([]);
      // The fixture really loaded: most expressions of every group find something.
      expect(matchedSomething).toBeGreaterThan(expressions.length / 3);
    });
  }

  for (const [group, expressions] of Object.entries(EDGE_CASES)) {
    test(`edge cases: ${group}`, async ({ page }) => {
      await openFixture(page, 'locator-edge-cases.html');
      const { mismatches, matchedSomething } = await compare(page, expressions);
      expect(mismatches, mismatches.join('\n')).toEqual([]);
      expect(matchedSomething).toBeGreaterThan(expressions.length / 3);
    });
  }

  test('getByTestId reads the configured test id attribute', async ({ page }) => {
    await openFixture(page);
    const expressions = [
      "getByTestId('product')",
      "getByTestId('footer-cta')",
      "getByTestId('pay')",
      "getByRole('region').getByTestId('product').nth(1)",
    ];
    selectors.setTestIdAttribute('data-qa');
    try {
      const { mismatches, matchedSomething } = await compare(page, expressions, ['data-qa']);
      expect(mismatches, mismatches.join('\n')).toEqual([]);
      expect(matchedSomething).toBe(3);
    } finally {
      selectors.setTestIdAttribute('data-testid');
    }
  });

  test('one engine answers the same expression identically, cached or not', async ({ page }) => {
    await openFixture(page);
    const expressions = Object.values(LOCATOR_CASES).flat();
    const shared = await engineOutcomes(page, expressions);
    const separate = await page.evaluate((list) => {
      const query = (globalThis as unknown as { __piwiEngineQueryAll: (e: string[]) => Outcome[] })
        .__piwiEngineQueryAll;
      return list.map((expression) => query([expression])[0]!);
    }, expressions);
    expect(shared).toEqual(separate);
  });
});
