import { test, expect } from './fixtures.js';

const ORIGIN = 'http://piwi-viewport.test';

test.describe('Open this page at a viewport', () => {
  test('opens a window whose viewport, not its frame, has the size asked for', async ({ context, extensionId }) => {
    await context.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Shop</p>' }),
    );
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const opened = context.waitForEvent('page');
    const reply = await popup.evaluate(
      (url) => chrome.runtime.sendMessage({ type: 'piwi-open-viewport', url, width: 800, height: 500 }),
      `${ORIGIN}/cart`,
    );
    // Sizes the headless browser's 1280×720 screen can hold: it keeps a window at least 500 pixels wide.
    expect(reply).toEqual({ ok: true, width: 800, height: 500 });
    await opened;
    // Measured by the browser, not by the page: Playwright emulates its own viewport in the pages it drives.
    const tab = await popup.evaluate(async () => {
      const windows = await chrome.windows.getAll({ populate: true });
      const newest = windows.sort((a, b) => b.id! - a.id!)[0]!;
      return [newest.tabs?.[0]?.width, newest.tabs?.[0]?.height];
    });
    expect(tab).toEqual([800, 500]);

    const refused = await popup.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'piwi-open-viewport', url: 'chrome://settings', width: 390, height: 664 }),
    );
    expect(refused).toMatchObject({ ok: false });
  });

  test('offers the viewports of the project’s Playwright projects, or a size typed by hand', async ({
    context,
    extensionId,
  }) => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    const viewport = popup.getByRole('combobox', { name: 'Open this page at a viewport' });
    await expect(viewport.locator('option')).toHaveText(['Size typed by hand']);
    await expect(popup.getByRole('spinbutton', { name: 'Width' })).toBeVisible();

    await popup.evaluate(() =>
      chrome.storage.local.set({
        piwiConnection: {
          instanceUrl: 'https://piwi.test',
          apiKey: '',
          projectMappings: [{ urlPattern: '**', projectId: 1, projectLabel: 'Shop' }],
        },
        piwiLocatorIndexCache: {
          '1': {
            fetchedAt: Date.now(),
            index: {
              projectId: 1,
              projectName: 'Shop',
              branch: null,
              defaultBranch: 'main',
              branches: [],
              builtAt: null,
              generatedAt: new Date().toISOString(),
              testIdAttributes: null,
              viewports: [
                { project: 'chromium', width: 1280, height: 720 },
                { project: 'Mobile Safari', width: 390, height: 664 },
              ],
              tests: [],
              locators: [],
              truncated: false,
            },
          },
        },
      }),
    );
    // The project the popup's Active project select chose: this page, opened as a tab, has no address to match.
    await popup.evaluate(() =>
      chrome.storage.session.set({ piwiActiveProjectOverride: { projectId: 1, projectLabel: 'Shop' } }),
    );
    await popup.reload();
    await expect(viewport.locator('option')).toHaveText([
      'chromium (1,280×720)',
      'Mobile Safari (390×664)',
      'Size typed by hand',
    ]);
    await expect(popup.getByRole('spinbutton', { name: 'Width' })).toBeHidden();
    await expect(popup.getByText('Viewport only: no touch, pixel ratio or user agent.')).toBeVisible();
  });
});
