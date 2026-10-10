import { describe, expect, test } from 'vitest';
import { isTourLanguage, pickTourLanguage } from '../../app/utils/demo-tour/languages';
import { boldLabels, escapeTourHtml, fillTourText, plainTourText, tourMarkup } from '../../app/utils/demo-tour/markup';
import {
  readTourPromptState,
  shouldAutoPrompt,
  TOUR_PROMPT_STORAGE_KEY,
  TOUR_SNOOZE_MS,
} from '../../app/utils/demo-tour/prompt-state';

describe('pickTourLanguage', () => {
  test('takes the first preferred language the tour speaks, on its primary subtag', () => {
    expect(pickTourLanguage(['fr-CA', 'en-US'])).toBe('fr');
    expect(pickTourLanguage(['pt-BR', 'de-AT', 'es'])).toBe('de');
    expect(pickTourLanguage(['en-GB', 'fr'])).toBe('en');
  });

  test('ignores case', () => {
    expect(pickTourLanguage(['ES-mx'])).toBe('es');
  });

  test('falls back to English', () => {
    expect(pickTourLanguage(['zh-CN', 'ja'])).toBe('en');
    expect(pickTourLanguage([])).toBe('en');
    expect(pickTourLanguage([''])).toBe('en');
  });
});

describe('isTourLanguage', () => {
  test('accepts the tour languages only', () => {
    expect(isTourLanguage('fr')).toBe(true);
    expect(isTourLanguage('FR')).toBe(false);
    expect(isTourLanguage('pt')).toBe(false);
    expect(isTourLanguage(null)).toBe(false);
  });
});

describe('escapeTourHtml', () => {
  test('escapes every character HTML gives a meaning to', () => {
    expect(escapeTourHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  test('leaves plain text alone', () => {
    expect(escapeTourHtml('Next · 3 of 6 — « Visite guidée »')).toBe('Next · 3 of 6 — « Visite guidée »');
  });
});

describe('tourMarkup', () => {
  test('turns each **label** into a <strong>', () => {
    expect(tourMarkup('**Most likely** names the cause, and **Next** is the step.')).toBe(
      '<strong>Most likely</strong> names the cause, and <strong>Next</strong> is the step.',
    );
  });

  test('escapes the text, bold labels included', () => {
    expect(tourMarkup('**A & B** <b>not bold</b>')).toBe('<strong>A &amp; B</strong> &lt;b&gt;not bold&lt;/b&gt;');
    expect(tourMarkup('**<img src=x onerror=alert(1)>**')).toBe('<strong>&lt;img src=x onerror=alert(1)&gt;</strong>');
  });

  test('leaves an unpaired ** as written', () => {
    expect(tourMarkup('2 ** 3')).toBe('2 ** 3');
  });
});

describe('plainTourText', () => {
  test('drops the bold markers', () => {
    expect(plainTourText('**Simulate a test run** replays a stream.')).toBe('Simulate a test run replays a stream.');
  });
});

describe('boldLabels', () => {
  test('lists the bold labels in order', () => {
    expect(boldLabels('Pick **Leaky run** in **Simulate a test run**.')).toEqual(['Leaky run', 'Simulate a test run']);
  });

  test('is empty when nothing is bold', () => {
    expect(boldLabels('No label here.')).toEqual([]);
  });
});

describe('fillTourText', () => {
  test('fills each known placeholder', () => {
    expect(fillTourText('{count} stops', { count: 6 })).toBe('6 stops');
    expect(fillTourText('{a} and {a} of {b}', { a: 'x', b: 'y' })).toBe('x and x of y');
  });

  test("leaves unknown placeholders and driver.js's {{current}} / {{total}} as written", () => {
    expect(fillTourText('{count} {unknown}', { count: 4 })).toBe('4 {unknown}');
    expect(fillTourText('{{current}} of {{total}}', { count: 4 })).toBe('{{current}} of {{total}}');
  });
});

describe('readTourPromptState', () => {
  test('reads a stored state', () => {
    expect(TOUR_PROMPT_STORAGE_KEY).toBe('piwi-demo-tour');
    expect(readTourPromptState('{"decision":"snoozed","decidedAt":1700000000000,"language":"fr"}')).toEqual({
      decision: 'snoozed',
      decidedAt: 1700000000000,
      language: 'fr',
    });
    expect(readTourPromptState('{"language":"de"}')).toEqual({ language: 'de' });
  });

  test('is empty for nothing stored, or for what is not a state', () => {
    for (const raw of [null, '', 'not json', '[]', '"snoozed"', '42', 'null', '{']) {
      expect(readTourPromptState(raw)).toEqual({});
    }
  });

  test('drops the fields it does not recognize', () => {
    expect(readTourPromptState('{"decision":"maybe","decidedAt":"yesterday","language":"pt","extra":true}')).toEqual(
      {},
    );
    expect(readTourPromptState('{"decision":"dismissed","decidedAt":1e400}')).toEqual({ decision: 'dismissed' });
  });
});

describe('shouldAutoPrompt', () => {
  const now = 1_800_000_000_000;

  test('asks a browser that never decided', () => {
    expect(shouldAutoPrompt({}, now)).toBe(true);
    expect(shouldAutoPrompt({ language: 'fr' }, now)).toBe(true);
  });

  test('never asks again after × or a started tour', () => {
    expect(shouldAutoPrompt({ decision: 'dismissed', decidedAt: now - 365 * TOUR_SNOOZE_MS }, now)).toBe(false);
    expect(shouldAutoPrompt({ decision: 'started', decidedAt: now - 365 * TOUR_SNOOZE_MS }, now)).toBe(false);
  });

  test('asks again a day after Later', () => {
    expect(TOUR_SNOOZE_MS).toBe(24 * 60 * 60 * 1000);
    expect(shouldAutoPrompt({ decision: 'snoozed', decidedAt: now - 60_000 }, now)).toBe(false);
    expect(shouldAutoPrompt({ decision: 'snoozed', decidedAt: now - TOUR_SNOOZE_MS + 1 }, now)).toBe(false);
    expect(shouldAutoPrompt({ decision: 'snoozed', decidedAt: now - TOUR_SNOOZE_MS }, now)).toBe(true);
    expect(shouldAutoPrompt({ decision: 'snoozed', decidedAt: now - 3 * TOUR_SNOOZE_MS }, now)).toBe(true);
  });

  test('asks again after a Later with no time', () => {
    expect(shouldAutoPrompt({ decision: 'snoozed' }, now)).toBe(true);
  });
});
