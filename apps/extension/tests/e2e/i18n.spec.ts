import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { substitutePlaceholders, type RawCatalog } from '../../src/shared/i18n.js';
import { test, expect } from './fixtures.js';
import { stubChromeI18n } from './i18n-stub.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const readCatalog = (code: string): RawCatalog =>
  JSON.parse(readFileSync(path.join(here, '..', '..', 'public', '_locales', code, 'messages.json'), 'utf8'));

/**
 * The arguments each message is tried with: one per placeholder, in
 * placeholder order, with a `$1` and a `$$` among them to show a value is
 * never read again.
 */
function calls(catalog: RawCatalog): Array<{ key: string; substitutions: string[] }> {
  return Object.entries(catalog).map(([key, entry]) => ({
    key,
    substitutions: Object.keys(entry.placeholders ?? {}).map((_, i) => (i === 0 ? `“$1 $$ ${key}”` : `v${i + 1}`)),
  }));
}

async function browserMessages(page: Page, list: Array<{ key: string; substitutions: string[] }>): Promise<string[]> {
  return page.evaluate(
    (items) => items.map(({ key, substitutions }) => chrome.i18n.getMessage(key, substitutions)),
    list,
  );
}

/** The text of every translated element and attribute of the page: none may be empty or show a placeholder. */
async function untranslated(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    const check = (where: string, text: string | null) => {
      if (!text?.trim() || /[$]/.test(text)) bad.push(`${where}: ${JSON.stringify(text)}`);
    };
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) check(el.dataset.i18n!, el.textContent);
    for (const [data, attribute] of [
      ['data-i18n-title', 'title'],
      ['data-i18n-placeholder', 'placeholder'],
      ['data-i18n-aria-label', 'aria-label'],
    ]) {
      for (const el of document.querySelectorAll(`[${data}]`))
        check(el.getAttribute(data)!, el.getAttribute(attribute));
    }
    return bad;
  });
}

/** Elements whose content is wider than their box: a label that clips. */
async function clipped(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
      .map((el) => `${el.tagName.toLowerCase()}#${el.id}.${el.className}: ${el.scrollWidth} > ${el.clientWidth}`),
  );
}

test.describe('in an English browser', () => {
  test('the Options override fills a message exactly as chrome.i18n does, for every English message', async ({
    context,
    extensionId,
  }) => {
    const english = readCatalog('en');
    const list = calls(english);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    const fromBrowser = await browserMessages(page, list);
    const fromOverride = list.map(({ key, substitutions }) => substitutePlaceholders(english[key]!, substitutions));
    expect(fromOverride).toEqual(fromBrowser);

    // The stub the specs use for a faked `chrome` answers the same.
    await stubChromeI18n(context);
    const plain = await context.newPage();
    await plain.route('https://i18n.test/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>i18n</p>' }),
    );
    await plain.goto('https://i18n.test/');
    expect(await browserMessages(plain, list)).toEqual(fromBrowser);
  });

  test('the Language setting switches the popup to French without a restart, and back', async ({
    context,
    extensionId,
  }) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    const language = options.getByLabel('Language');
    await expect(language.locator('option')).toHaveText(['Same as the browser (English)', 'English', 'Français']);
    await expect(language).toHaveValue('');

    await language.selectOption('fr');
    await expect(options.locator('#status')).toHaveText('Langue enregistrée.');
    // The page redraws itself in the new language.
    await expect(options.getByRole('heading', { name: 'Connexion à Piwi' })).toBeVisible();
    await expect(options.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(options.getByLabel('Langue')).toHaveValue('fr');
    await expect(options.getByLabel('Langue').locator('option').first()).toHaveText('Celle du navigateur (English)');

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('button', { name: /Choisir un élément/ })).toBeVisible();
    await expect(popup.locator('html')).toHaveAttribute('lang', 'fr');
    expect(await untranslated(popup)).toEqual([]);

    await options.getByLabel('Langue').selectOption('');
    await expect(options.locator('#status')).toHaveText('Language saved.');
    await popup.reload();
    await expect(popup.getByRole('button', { name: /Pick an element/ })).toBeVisible();
    await expect(popup.locator('html')).toHaveAttribute('lang', /^en/);
  });

  test('the badge follows what runs, in the chosen language, whatever it said before', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.getByLabel('Language').selectOption('fr');
    await expect(page.locator('#status')).toHaveText('Langue enregistrée.');

    const replayFinished = () =>
      page.evaluate(async () => {
        await chrome.runtime.sendMessage({ type: 'piwi-replay-finished' });
        return chrome.action.getBadgeText({});
      });
    // A recording started while the replay ran keeps its badge.
    await page.evaluate(() =>
      chrome.storage.session.set({
        piwiRecording: { active: true, events: [], startedAt: 1, grantedOriginPattern: null, mode: 'actions' },
      }),
    );
    expect(await replayFinished()).toBe('ENR');
    await page.evaluate(() => chrome.storage.session.remove('piwiRecording'));
    expect(await replayFinished()).toBe('');
  });
});

test.describe('in a French browser', () => {
  test.use({ browserLanguage: 'fr' });

  test('the browser answers in French', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    expect(await page.evaluate(() => [chrome.i18n.getUILanguage(), chrome.i18n.getMessage('popup_pick')])).toEqual([
      'fr',
      'Choisir un élément',
    ]);
  });

  test('the popup is in French, with the same keys', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    for (const name of [
      'Éléments testés',
      'Signaler un bug',
      'Rejouer un rapport de bug',
      'Enregistrer',
      'Choisir un élément',
    ]) {
      await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Réglages' })).toBeVisible();
    await expect(page.locator('#coverage-hint')).toHaveText('Connectez Piwi pour voir ce que vos tests atteignent');
    await expect(page.locator('footer kbd')).toHaveText(['1', '0', 'T', 'B', 'R', /./]);
    expect(await untranslated(page)).toEqual([]);
    expect(await clipped(page)).toEqual([]);

    // The single-key shortcuts are the same in every language.
    await page.evaluate(() => {
      (globalThis as unknown as { clicked: string[] }).clicked = [];
      for (const b of document.querySelectorAll<HTMLElement>('.actions button')) {
        b.addEventListener('click', () => (globalThis as unknown as { clicked: string[] }).clicked.push(b.id));
      }
    });
    await page.keyboard.press('2');
    expect(await page.evaluate(() => (globalThis as unknown as { clicked: string[] }).clicked)).toEqual(['pick']);
  });

  test('the options page is in French', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(page).toHaveTitle('Réglages de Piwi Picker');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByLabel('Langue').locator('option')).toHaveText([
      'Celle du navigateur (Français)',
      'English',
      'Français',
    ]);
    await expect(page.getByRole('heading', { name: 'Projets par site' })).toBeVisible();
    await expect(page.locator('.empty-mappings')).toHaveText(
      'Aucune ligne pour l’instant : ajoutez-en une ci-dessous.',
    );
    await expect(page.locator('p.hint code')).toHaveText(['*', '**', 'develop']);
    await page.getByRole('button', { name: '+ Ajouter une ligne' }).click();
    await expect(page.getByRole('textbox', { name: 'Motif d’adresse' })).toHaveAttribute(
      'placeholder',
      'https://boutique.exemple.fr/**',
    );
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.locator('#status')).toHaveText('Saisissez d’abord l’adresse de votre instance Piwi.');
    expect(await untranslated(page)).toEqual([]);
  });

  test('the Options override fills every French message exactly as chrome.i18n does', async ({
    context,
    extensionId,
  }) => {
    const french = readCatalog('fr');
    const list = calls(french);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    expect(list.map(({ key, substitutions }) => substitutePlaceholders(french[key]!, substitutions))).toEqual(
      await browserMessages(page, list),
    );
  });
});
