import { describe, it, expect } from 'vitest';
import { injectionFailureText } from '../../src/shared/injection-failure.js';

// The messages below are the ones Chromium gives `chrome.scripting.executeScript`.
describe('injectionFailureText', () => {
  it('says the tab shows an error page, whose address still reads as the site', () => {
    expect(
      injectionFailureText(new Error('Frame with ID 0 is showing error page'), 'http://localhost:3000/cart'),
    ).toMatch(/^This tab shows an error page instead of the site\. Is the site running\?/);
  });

  it('keeps the browser’s own pages and the extension store apart', () => {
    const browserPage = /browsers keep their own pages and extension stores out of reach/;
    expect(injectionFailureText(new Error('Cannot access a chrome:// URL'), 'chrome://settings/')).toMatch(browserPage);
    expect(
      injectionFailureText(
        new Error('The extensions gallery cannot be scripted.'),
        'https://chromewebstore.google.com/detail/x',
      ),
    ).toMatch(browserPage);
    expect(injectionFailureText(new Error('Cannot access contents of the page.'), undefined)).toMatch(browserPage);
  });

  it('names a policy, and passes any other reason on as the browser wrote it', () => {
    expect(
      injectionFailureText(
        new Error('This page cannot be scripted due to an ExtensionsSettings policy.'),
        'https://intranet.example/',
      ),
    ).toBe('Your organization’s browser settings keep extensions off this site.');
    expect(injectionFailureText(new Error('No tab with id: 12.'), 'https://shop.test/')).toBe(
      'Piwi Picker can’t run on this page. The browser says: No tab with id: 12.',
    );
  });
});
