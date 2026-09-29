import { test, expect, type Page } from '@playwright/test';
import { installPickerOverlay, type PickerOverlayArg } from '../../src/overlay-element.js';
import { probeElementAttrs } from '../../src/probe.js';

const FIXTURE = `<!doctype html><html><body>
  <div id="wrap"><span id="inner">Click me</span></div>
  <button id="submit" data-testid="submit-btn">Submit</button>
</body></html>`;

const install = (page: Page, arg: PickerOverlayArg) => page.evaluate(installPickerOverlay, arg);

const dispatchKey = (page: Page, key: string) =>
  page.evaluate(
    (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })),
    key,
  );

/** `window.parent === window` at the top level — patching `postMessage` lets a plain page stand in for the sandboxed iframe. */
async function recordPostMessages(page: Page): Promise<void> {
  await page.evaluate(() => {
    (globalThis as any).__piwiMessages = [];
    const orig = window.postMessage.bind(window);
    window.postMessage = (msg: unknown, ...rest: unknown[]) => {
      (globalThis as any).__piwiMessages.push(msg);
      return (orig as (...a: unknown[]) => unknown)(msg, ...rest);
    };
  });
}

const messagesOfType = (page: Page, type: string) =>
  page.evaluate((t) => (globalThis as any).__piwiMessages.filter((m: any) => m?.type === t), type);

test.describe('installPickerOverlay — global transport (live page)', () => {
  test('click reports the picked element via globalThis and suppresses stray pointer events', async ({ page }) => {
    await page.setContent(FIXTURE);
    await install(page, { transport: 'global', failing: null });
    await page.hover('#submit');
    await page.click('#submit');
    const state = await page.evaluate(() => (globalThis as any).__piwiPickState);
    expect(state).toBe('picked');
    const pickedId = await page.evaluate(() => (globalThis as any).__piwiPickedElement.id);
    expect(pickedId).toBe('submit');
  });

  test('Escape reports skipped and removes the overlay chrome', async ({ page }) => {
    await page.setContent(FIXTURE);
    await install(page, { transport: 'global', failing: "getByText('Pay now')" });
    await expect(page.locator('#__piwi_picker_banner')).toBeVisible();
    await dispatchKey(page, 'Escape');
    const state = await page.evaluate(() => (globalThis as any).__piwiPickState);
    expect(state).toBe('skipped');
    await expect(page.locator('#__piwi_picker_banner')).toHaveCount(0);
  });

  test('shows the hovered element locator on the element and in the banner', async ({ page }) => {
    await page.setContent(FIXTURE);
    await install(page, { transport: 'global', failing: null });
    await page.hover('#submit');
    await expect(page.locator('#__piwi_picker_label')).toBeVisible();
    await expect(page.locator('#__piwi_picker_label')).toContainText("getByTestId('submit-btn')");
    await expect(page.locator('#__piwi_picker_label')).toContainText('<button>');
    await expect(page.locator('#__piwi_picker_locator')).toContainText("getByTestId('submit-btn')");
  });

  test('a host describe hook supplies the locator the overlay shows', async ({ page }) => {
    await page.setContent(FIXTURE);
    await page.evaluate(() => {
      (globalThis as any).__piwiDescribeElement = (el: Element) => `getByRole('button', { name: '${el.id}' })`;
    });
    await install(page, { transport: 'global', failing: null });
    await page.hover('#submit');
    await expect(page.locator('#__piwi_picker_locator')).toContainText("getByRole('button', { name: 'submit' })");
  });

  test('ArrowUp walks to the parent before the click commits', async ({ page }) => {
    await page.setContent(FIXTURE);
    await install(page, { transport: 'global', failing: null });
    await page.hover('#inner');
    await dispatchKey(page, 'ArrowUp');
    await page.click('#inner', { force: true });
    const pickedId = await page.evaluate(() => (globalThis as any).__piwiPickedElement.id);
    expect(pickedId).toBe('wrap');
  });
});

test.describe('installPickerOverlay — postMessage transport (snapshot picker)', () => {
  test('click probes inline and posts elementPicked, staying inert afterward', async ({ page }) => {
    await page.setContent(FIXTURE);
    await recordPostMessages(page);
    await page.evaluate((probeSrc) => {
      // Mirrors what the host's script-tag builder does at a source level:
      // install the probe on a well-known global before the overlay runs.
      (globalThis as any).__piwiProbe = new Function(`return (${probeSrc})`)();
    }, probeElementAttrs.toString());
    await install(page, {
      transport: 'postMessage',
      probeArg: { keep: ['id', 'data-testid'], includeStructural: false },
    });
    expect((await messagesOfType(page, 'pickerReady')).length).toBe(1);

    await page.hover('#submit');
    await page.click('#submit');
    const picked = await messagesOfType(page, 'elementPicked');
    expect(picked).toHaveLength(1);
    expect(picked[0].attrs.attributes['data-testid']).toBe('submit-btn');

    // The snapshot stays inert through the review step — a stray click must
    // still do nothing (freezeAfterPick's intent), not resume picking.
    const clicksBefore = (await messagesOfType(page, 'elementPicked')).length;
    await page.click('#submit', { force: true });
    expect((await messagesOfType(page, 'elementPicked')).length).toBe(clicksBefore);
  });

  test('Escape posts pickerClosed', async ({ page }) => {
    await page.setContent(FIXTURE);
    await recordPostMessages(page);
    await install(page, {
      transport: 'postMessage',
      probeArg: { keep: [], includeStructural: false },
    });
    await dispatchKey(page, 'Escape');
    expect((await messagesOfType(page, 'pickerClosed')).length).toBe(1);
    await expect(page.locator('#__piwi_picker_banner')).toHaveCount(0);
  });

  test('forwards a piwiPickerKey message into the tree walk', async ({ page }) => {
    await page.setContent(FIXTURE);
    await recordPostMessages(page);
    await page.evaluate((probeSrc) => {
      (globalThis as any).__piwiProbe = new Function(`return (${probeSrc})`)();
    }, probeElementAttrs.toString());
    await install(page, {
      transport: 'postMessage',
      probeArg: { keep: ['id'], includeStructural: false },
    });
    await page.hover('#inner');
    await expect(page.locator('#__piwi_picker_locator')).toContainText("locator('#inner')");
    // The iframe rarely holds focus in the real snapshot picker, so its host
    // forwards arrow keys via postMessage instead of a real keydown — confirm
    // the walk actually moves before asserting on the eventual pick.
    await page.evaluate(() => window.postMessage({ type: 'piwiPickerKey', key: 'ArrowUp' }, '*'));
    await expect(page.locator('#__piwi_picker_locator')).toContainText("locator('#wrap')");
    await page.click('#inner', { force: true });
    const picked = await messagesOfType(page, 'elementPicked');
    expect(picked[picked.length - 1]!.attrs.attributes.id).toBe('wrap');
  });
});
