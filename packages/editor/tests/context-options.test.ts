import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { recorderBrowser } from '../src/recorder/context-options';

const cwd = path.resolve('/work/app');
const options = (existing: string[] = [], headless = false) => ({
  cwd,
  headless,
  exists: (file: string) => existing.includes(file),
});

describe('recorderBrowser', () => {
  test('Chromium, headed, with no option set', () => {
    expect(recorderBrowser({}, options())).toEqual({
      browserName: 'chromium',
      launchOptions: { headless: false },
      contextOptions: {},
      testIdAttribute: null,
      notes: [],
    });
  });

  test('the project’s browser, channel and launch options; headless only when asked', () => {
    const use = {
      defaultBrowserType: 'webkit',
      browserName: 'firefox',
      channel: 'firefox-beta',
      headless: true,
      launchOptions: { args: ['--remote-debugging-port=9333'], slowMo: 50, headless: true, channel: 'old' },
    };
    expect(recorderBrowser(use, options())).toMatchObject({
      browserName: 'firefox',
      launchOptions: { args: ['--remote-debugging-port=9333'], slowMo: 50, headless: false, channel: 'firefox-beta' },
    });
    expect(recorderBrowser({ defaultBrowserType: 'webkit' }, options([], true))).toMatchObject({
      browserName: 'webkit',
      launchOptions: { headless: true },
    });
    expect(recorderBrowser({ browserName: 'netscape' }, options()).browserName).toBe('chromium');
  });

  test('the context options of the allowlist, the project’s over contextOptions', () => {
    const use = {
      baseURL: 'http://127.0.0.1:4173/app/',
      viewport: { width: 393, height: 727 },
      screen: { width: 393, height: 851 },
      deviceScaleFactor: 2.75,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Pixel 5',
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      colorScheme: 'dark',
      extraHTTPHeaders: { 'X-Team': 'checkout' },
      httpCredentials: { username: 'u', password: 'p' },
      ignoreHTTPSErrors: true,
      permissions: ['clipboard-read'],
      geolocation: { latitude: 48.85, longitude: 2.35 },
      proxy: { server: 'http://proxy:3128' },
      javaScriptEnabled: true,
      bypassCSP: true,
      serviceWorkers: 'block',
      acceptDownloads: false,
      contextOptions: { reducedMotion: 'reduce', forcedColors: 'active', locale: 'de-DE', offline: true },
      actionTimeout: 5_000,
      trace: 'on',
      video: 'retain-on-failure',
    };
    expect(recorderBrowser(use, options()).contextOptions).toEqual({
      baseURL: 'http://127.0.0.1:4173/app/',
      viewport: { width: 393, height: 727 },
      screen: { width: 393, height: 851 },
      deviceScaleFactor: 2.75,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Pixel 5',
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      forcedColors: 'active',
      extraHTTPHeaders: { 'X-Team': 'checkout' },
      httpCredentials: { username: 'u', password: 'p' },
      ignoreHTTPSErrors: true,
      permissions: ['clipboard-read'],
      geolocation: { latitude: 48.85, longitude: 2.35 },
      proxy: { server: 'http://proxy:3128' },
      javaScriptEnabled: true,
      bypassCSP: true,
      serviceWorkers: 'block',
      acceptDownloads: false,
    });
  });

  test('screen only with a viewport', () => {
    const screen = { width: 1920, height: 1080 };
    expect(recorderBrowser({ viewport: null, screen }, options()).contextOptions).toEqual({ viewport: null });
    expect(recorderBrowser({ screen }, options()).contextOptions).toEqual({});
  });

  test('the test id attribute', () => {
    expect(recorderBrowser({ testIdAttribute: 'data-test' }, options()).testIdAttribute).toBe('data-test');
    expect(recorderBrowser({ testIdAttribute: '' }, options()).testIdAttribute).toBeNull();
  });

  test('a storage state file that exists, relative to the config’s folder, is kept', () => {
    const existing = [path.join(cwd, 'playwright/.auth/user.json')];
    const browser = recorderBrowser({ storageState: 'playwright/.auth/user.json' }, options(existing));
    expect(browser.contextOptions).toEqual({ storageState: 'playwright/.auth/user.json' });
    expect(browser.notes).toEqual([]);
  });

  test('a storage state file that does not exist yet is left out, and said so', () => {
    const browser = recorderBrowser({ storageState: 'playwright/.auth/user.json', locale: 'en-GB' }, options());
    expect(browser.contextOptions).toEqual({ locale: 'en-GB' });
    expect(browser.notes).toEqual([
      'The sign-in state playwright/.auth/user.json does not exist yet: run the setup project first.',
    ]);
  });

  test('a storage state given as an object is kept as it is', () => {
    const state = { cookies: [], origins: [] };
    expect(recorderBrowser({ storageState: state }, options()).contextOptions).toEqual({ storageState: state });
  });
});
