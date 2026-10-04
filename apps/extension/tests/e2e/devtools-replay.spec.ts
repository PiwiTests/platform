import type { BrowserContext, Page, Worker } from '@playwright/test';
import { openDevtoolsPage } from './devtools-stub.js';
import { expect, panelNode, replayState, startReplay, step, stepsDoc, target, test } from './trusted-site.js';

/**
 * The Piwi panel in DevTools driving a replay in step mode: its buttons write
 * the extension's session storage and message the replayed site's tabs, where
 * the registered replay script reads both. The real extension, on a local site.
 */

/** A cart whose coupon button shows 4 s after the page loads: the replay waits for it. */
const LATE_CART = `<!doctype html><html><body><output data-testid="total">Total: 40</output><script>
  setTimeout(() => {
    const b = document.createElement('button');
    b.dataset.testid = 'apply-coupon';
    b.textContent = 'Apply coupon';
    b.onclick = () => (document.querySelector('[data-testid="total"]').textContent = 'Total: 42');
    document.body.prepend(b);
  }, 4000);
</script></body></html>`;

test.use({ pages: { '/cart': LATE_CART } });

function applyCoupon(site: string) {
  return stepsDoc('Apply the coupon', site, [
    step('goto', '/cart', { value: '/cart' }),
    step('click', '/cart', { target: target('apply-coupon', 'button', 'Apply coupon') }),
  ]);
}

/**
 * Opens the Piwi panel on its Replay tab, inspecting a new tab, then starts the
 * replay in step mode in that tab: its first step opens the cart, where the
 * replay shows its panel and looks for the coupon button.
 */
async function replayFromPanel(
  context: BrowserContext,
  control: Page,
  worker: Worker,
  site: string,
): Promise<{ page: Page; panel: Page }> {
  const page = await context.newPage();
  // The cursor reaches an element at once: the replay waits for Next as soon as the cursor's caption shows.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const panel = await openDevtoolsPage(context, new URL(worker.url()).host, 'devtools-panel.html', page);
  await panel.getByRole('tab', { name: 'Replay' }).click();
  await startReplay(control, context, site, applyCoupon(site), '/start', true, page);
  await page.waitForURL('**/cart');
  await expect(page.locator('#piwi-replay-hud-host')).toBeAttached({ timeout: 20_000 });
  return { page, panel };
}

/** Waits a moment: the replay looks for the coupon button, not there yet. */
async function lookingForButton(page: Page): Promise<void> {
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('apply-coupon')).toHaveCount(0);
}

/**
 * Waits for the replay's cursor to read "Next: …": the replay found the
 * step's element and, unless paused, waits for Next.
 */
async function foundElement(page: Page): Promise<void> {
  await expect
    .poll(async () => (await panelNode(page, (node) => !!node.nodeValue?.startsWith('Next: '))) !== null, {
      message: 'the replay stops on the button before the click',
      timeout: 15_000,
    })
    .toBe(true);
}

/** Pauses the replay from the panel, then lets it go on. */
async function pauseAndContinue(panel: Page): Promise<void> {
  await panel.getByRole('button', { name: 'Pause' }).click();
  await panel.getByRole('button', { name: 'Continue' }).click();
  await expect(panel.getByRole('button', { name: 'Pause' })).toBeVisible();
}

/** The click is not played until the panel's Next step, which plays it. */
async function playsOnNext(page: Page, panel: Page, worker: Worker): Promise<void> {
  await page.waitForTimeout(1000);
  expect((await replayState(worker)).results).toHaveLength(1);
  await expect(page.getByTestId('total')).toHaveText('Total: 40');
  await panel.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByTestId('total')).toHaveText('Total: 42');
}

test('a Pause and a Continue from DevTools while a step waits for its element leave the step waiting for Next', async ({
  context,
  control,
  site,
  worker,
}) => {
  const { page, panel } = await replayFromPanel(context, control, worker, site);
  await lookingForButton(page);
  await pauseAndContinue(panel);

  await foundElement(page);
  await playsOnNext(page, panel, worker);
});

test('a Pause and a Continue from DevTools while the replay waits for Next leave the step waiting for Next', async ({
  context,
  control,
  site,
  worker,
}) => {
  const { page, panel } = await replayFromPanel(context, control, worker, site);
  await foundElement(page);
  await pauseAndContinue(panel);

  await playsOnNext(page, panel, worker);
});

test('a Pause while a step waits for its element and a Continue once it is found leave the step waiting for Next', async ({
  context,
  control,
  site,
  worker,
}) => {
  const { page, panel } = await replayFromPanel(context, control, worker, site);
  await lookingForButton(page);
  await panel.getByRole('button', { name: 'Pause' }).click();
  await foundElement(page);
  await panel.getByRole('button', { name: 'Continue' }).click();

  await playsOnNext(page, panel, worker);
});
