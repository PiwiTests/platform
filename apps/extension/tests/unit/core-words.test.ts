import { describe, it, expect } from 'vitest';
import { assessLocator } from '@piwitests/core/locator-stability';
import { buildSession } from '@piwitests/core/recording';
import { renderSpec } from '@piwitests/core/codegen';
import { actionLabel, codegenWarningText, interfacePhrases, stabilityText } from '../../src/shared/core-words.js';
import { setBrowserLanguage } from './setup-i18n.js';

const brittle = assessLocator(`locator('.btn > span').nth(2)`)!;
const redacted = renderSpec(
  buildSession(
    [
      {
        action: 'fill',
        target: {
          tagName: 'input',
          role: 'textbox',
          accessibleName: 'Password',
          testId: null,
          text: null,
          alternatives: [{ locator: `getByLabel('Password')`, method: 'getByLabel', score: 90 }],
        },
        value: null,
        redacted: true,
        pageUrl: 'https://shop.test/login',
        timestamp: 1,
      },
    ],
    0,
  ),
).warnings[0]!;

describe('core’s texts in the interface language', () => {
  it('in English, the words core itself uses', () => {
    expect(interfacePhrases().language).toBe('en');
    expect(stabilityText(brittle)).toBe('position · CSS class · CSS structure');
    expect(actionLabel('selectOption')).toBe('Select option');
    expect(actionLabel('expect.not.toBeVisible')).toBe('Expect not toBeVisible');
    expect(actionLabel('somethingNew')).toBe('somethingNew');
    expect(codegenWarningText(redacted)).toBe('A password was typed here: the test reads it from PIWI_TEST_VALUE_0.');
  });

  it('in French, by code, with Playwright’s names kept as code', () => {
    setBrowserLanguage('fr');
    expect(interfacePhrases().language).toBe('fr');
    expect(stabilityText(brittle, ', ')).toBe('position, classe CSS, structure CSS');
    expect(actionLabel('click')).toBe('Clic');
    expect(actionLabel('expect.toHaveText')).toBe('Vérification toHaveText');
    expect(codegenWarningText(redacted)).toBe(
      'Un mot de passe a été saisi ici : le test le lit dans PIWI_TEST_VALUE_0.',
    );
  });
});
