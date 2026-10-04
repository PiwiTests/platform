import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

/**
 * `buildAgentContext` calls @piwitests/core's `generateAlternatives`, which
 * has its own web of private module-level helpers — like
 * `assertion-suggest.spec.ts`, this drives the real built
 * `agent-context-panel.js` and reads what it bridges out to
 * `globalThis.__piwiAgentContext` (see that file) instead of attempting
 * `Function.prototype.toString()` reconstruction, which can't carry those
 * helpers along.
 */
async function pickAndBuildContext(page: Page, targetSelector: string): Promise<string> {
  await page.addScriptTag({ path: path.join(DIST, 'agent-context-panel.js') });
  await page.hover(targetSelector);
  await page.click(targetSelector);
  await expect.poll(() => page.evaluate(() => typeof (globalThis as any).__piwiAgentContext)).toBe('string');
  return page.evaluate(() => (globalThis as any).__piwiAgentContext as string);
}

test.describe('buildAgentContext (via the real built agent-context-panel.js)', () => {
  test('bundles the page URL, an element summary, and every ranked locator', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button data-testid="submit-btn">Submit</button>
    </body></html>`);
    const contextText = await pickAndBuildContext(page, '[data-testid="submit-btn"]');

    // A page with no web address, as a bug report writes one.
    expect(page.url()).toBe('about:blank');
    expect(contextText).toContain('Page: about:…');
    expect(contextText).toContain('<button>');
    expect(contextText).toContain('role: button');
    expect(contextText).toContain('accessible name: "Submit"');
    expect(contextText).toContain('data-testid="submit-btn"');
    expect(contextText).toContain('Text: "Submit"');
    expect(contextText).toContain('Ranked locators (best first):');
    expect(contextText).toContain(`1. [100] getByTestId('submit-btn')`);
  });

  test('leaves query values and the fragment out of the page’s and a link’s address', async ({ context }) => {
    await context.route('https://agent.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body style="margin-top:120px">
          <a id="reset" href="/reset/42?token=secret-value#step-2">Reset</a>
        </body></html>`,
      }),
    );
    const page = await context.newPage();
    await page.goto('https://agent.test/orders/42?tab=details&token=abc123#access_token=xyz789');
    const contextText = await pickAndBuildContext(page, '#reset');
    expect(contextText).toMatch(/^Page: https:\/\/agent\.test\/orders\/:id\?tab=[^&\s]*&token=\S*$/m);
    expect(contextText).toMatch(/href="\/reset\/:id\?token=[^"#]*"/);
    for (const secret of ['abc123', 'xyz789', 'access_token', 'secret-value', 'step-2', 'details']) {
      expect(contextText).not.toContain(secret);
    }
  });

  test('keeps a link to an id on the page as written', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body style="margin-top:120px">
      <a id="faq" href="#faq">FAQ</a>
    </body></html>`);
    const contextText = await pickAndBuildContext(page, '#faq');
    expect(contextText).toContain('href="#faq"');
  });

  test('whitespace in text content is normalized (collapsed and trimmed)', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button data-testid="msg-btn">   Hello   \n   World   </button>
    </body></html>`);
    const contextText = await pickAndBuildContext(page, '[data-testid="msg-btn"]');
    expect(contextText).toContain('Text: "Hello World"');
  });

  test('lists every ranked locator alternative, not just the top one', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button data-testid="submit-btn" id="submit-el">Submit</button>
    </body></html>`);
    const contextText = await pickAndBuildContext(page, '[data-testid="submit-btn"]');

    const rankedIndex = contextText.indexOf('Ranked locators (best first):');
    expect(rankedIndex).toBeGreaterThan(-1);
    const rankedSection = contextText.slice(rankedIndex);
    expect(rankedSection).toContain(`getByTestId('submit-btn')`);
    expect(rankedSection).toContain(`getByRole('button', { name: 'Submit' })`);
  });

  test('checks each locator on the page: the narrowed one first, the loose one with its count', async ({ context }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <button id="failed">Failed</button><button>3 failed</button>
    </body></html>`);
    const contextText = await pickAndBuildContext(page, '#failed');
    expect(contextText).toContain(
      `1. [89] getByRole('button', { name: 'Failed', exact: true }) (narrowed from getByRole('button', { name: 'Failed' }), which finds 2 elements)`,
    );
    expect(contextText).toContain(`getByRole('button', { name: 'Failed' }) (finds 2 elements on this page)`);
  });

  test('an element with no identifying attributes, text, or role reports no locator alternative', async ({
    context,
  }) => {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><html><body>
      <div style="width:60px;height:20px;"></div>
    </body></html>`);
    const contextText = await pickAndBuildContext(page, 'div');
    expect(contextText).toContain('No stable locator alternative could be generated for this element.');
  });
});
