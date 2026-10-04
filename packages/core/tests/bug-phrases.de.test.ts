import { describe, test, expect } from 'vitest';
import { BUG_PHRASES, bugPhrases, type BugPhrases } from '../src/bug-phrases';
import {
  BUG_REPORT_VERSION,
  describeExpectation,
  describeStepInWords,
  emptyBugEvidence,
  renderBugMarkdown,
  summarizeEvidence,
  type BugReport,
} from '../src/bug-report';
import {
  ASSERTION_MATCHERS,
  type AssertionMatcher,
  type RecordedStep,
  type RecordedTarget,
  type StepAction,
} from '../src/recording';

const german = BUG_PHRASES.de!;

function target(overrides: Partial<RecordedTarget>): RecordedTarget {
  return { tagName: 'div', role: null, accessibleName: null, testId: null, text: null, alternatives: [], ...overrides };
}

function step(action: StepAction, overrides: Partial<RecordedStep> = {}): RecordedStep {
  return {
    action,
    target: null,
    value: null,
    redacted: false,
    pageUrl: 'https://shop.test/cart',
    timestamp: 1,
    ...overrides,
  };
}

function assertion(matcher: AssertionMatcher, negated = false, expected: string | null = null): Partial<RecordedStep> {
  return { assertion: { matcher, expected, actual: null, negated, note: null } };
}

const button = target({ tagName: 'button', role: 'button', accessibleName: 'Apply coupon' });
const coupon = target({ tagName: 'input', role: 'textbox', accessibleName: 'Coupon' });
const country = target({ tagName: 'select', role: 'combobox', accessibleName: 'Country' });
const agree = target({ tagName: 'input', role: 'checkbox', accessibleName: 'I agree' });
const darkMode = target({ tagName: 'button', role: 'switch', accessibleName: 'Dark mode' });
const total = target({ tagName: 'p', testId: 'cart-total', text: 'Total: 40' });
const row = target({ tagName: 'tr', role: 'row', accessibleName: 'Invoice 42' });
const logo = target({ tagName: 'img', role: 'img', accessibleName: 'Acme' });
const heading = target({ tagName: 'h1', role: 'heading', accessibleName: 'Cart' });

/** Every action and every matcher, negated or not. */
function everyTemplate(): RecordedStep[] {
  return [
    step('goto', { value: 'https://shop.test/cart' }),
    step('click', { target: button }),
    step('fill', { target: coupon, value: 'SPRING10' }),
    step('fill', { target: target({ tagName: 'input', role: 'textbox', accessibleName: 'Password' }), redacted: true }),
    step('check', { target: agree }),
    step('uncheck', { target: agree }),
    step('selectOption', { target: country, value: 'France' }),
    step('press', { target: coupon, value: 'Enter' }),
    step('press', { value: 'Escape' }),
    step('assertVisible', { target: logo }),
    ...ASSERTION_MATCHERS.flatMap((matcher) =>
      [false, true].map((negated) =>
        step('assert', {
          target: matcher === 'toHaveURL' ? null : matcher === 'toBeHidden' ? logo : total,
          ...assertion(matcher, negated, matcher === 'toHaveURL' ? '/checkout' : 'Total: 42'),
        }),
      ),
    ),
    step('hover', { target: row }),
  ];
}

function report(steps: RecordedStep[]): BugReport {
  return {
    v: BUG_REPORT_VERSION,
    steps: { v: 1, title: '', note: null, steps } as unknown as BugReport['steps'],
    evidence: {
      ...emptyBugEvidence(),
      console: [
        { level: 'error', source: 'console', message: 'Coupon failed', page: '/cart', time: Date.UTC(2026, 8, 27, 14) },
        { level: 'error', source: 'error', message: 'x is undefined', page: '/cart', time: Date.UTC(2026, 8, 27, 14) },
        { level: 'error', source: 'rejection', message: 'boom', page: '/cart', time: Date.UTC(2026, 8, 27, 14) },
        { level: 'warn', source: 'console', message: 'slow', page: '/cart', time: Date.UTC(2026, 8, 27, 14) },
      ],
      consoleDropped: 2,
      requests: [{ method: 'POST', url: '/api/coupons', status: 500, page: '/cart', time: Date.UTC(2026, 8, 27, 14) }],
      requestsDropped: 0,
      screenshots: [
        { file: 'screenshots/1-marked.png', step: 3, moment: 'marked', takenAt: 1 },
        { file: 'screenshots/2-finish.png', step: null, moment: 'finish', takenAt: 2 },
        { file: 'screenshots/3-manual.png', step: null, moment: 'manual', takenAt: 3 },
      ],
      outline: '- button "Apply coupon"',
    },
    context: {
      origin: 'https://shop.test',
      pageKey: '/cart',
      path: '/cart',
      browser: 'Chrome 141',
      userAgent: null,
      viewport: { width: 1280, height: 720 },
      time: Date.UTC(2026, 8, 27, 14, 5),
      extensionVersion: '0.40.0',
    },
  };
}

describe('German', () => {
  const words = (s: RecordedStep, phrases: BugPhrases = german) => describeStepInWords(s, phrases);
  const q = (text: string) => `„${text}“`;

  test('is the phrasebook of every German tag', () => {
    expect(bugPhrases('de')).toBe(german);
    expect(bugPhrases('de-AT')).toBe(german);
    expect(german.roles.combobox?.noun).toBe('Auswahlliste');
  });

  test('writes the steps of the plan’s table, page texts kept as they are', () => {
    expect(words(step('click', { target: button }))).toBe(`Auf den Button ${q('Apply coupon')} klicken`);
    expect(words(step('fill', { target: coupon, value: 'SPRING10' }))).toBe(
      `${q('SPRING10')} in das Textfeld ${q('Coupon')} eingeben`,
    );
    expect(words(step('selectOption', { target: country, value: 'France' }))).toBe(
      `${q('France')} in der Auswahlliste ${q('Country')} auswählen`,
    );
    expect(words(step('check', { target: agree }))).toBe(`Das Kontrollkästchen ${q('I agree')} aktivieren`);
    expect(words(step('hover', { target: row }))).toBe(`Mit der Maus über die Tabellenzeile ${q('Invoice 42')} fahren`);
  });

  test('writes the other actions', () => {
    expect(words(step('goto', { value: '/cart' }))).toBe('`/cart` öffnen');
    expect(words(step('uncheck', { target: agree }))).toBe(`Das Kontrollkästchen ${q('I agree')} deaktivieren`);
    expect(words(step('fill', { target: coupon, redacted: true }))).toBe(
      `Ein Passwort (nicht aufgezeichnet) in das Textfeld ${q('Coupon')} eingeben`,
    );
    // Keys by the names German keyboards print; Enter keeps its name.
    expect(words(step('press', { target: coupon, value: 'Enter' }))).toBe(`Enter im Textfeld ${q('Coupon')} drücken`);
    expect(words(step('press', { value: 'Escape' }))).toBe('Esc drücken');
    expect(words(step('press', { value: 'Delete' }))).toBe('Entf drücken');
    // A shortcut as its keys read, the letter in capitals.
    expect(words(step('press', { value: 'ControlOrMeta+k' }))).toBe('Strg+K drücken');
    expect(words(step('press', { value: 'Shift+Tab' }))).toBe('Umschalt+Tab drücken');
  });

  test('declines the article by the noun’s gender and the case the preposition asks for', () => {
    // Accusative after auf and after in (a direction), dative after in (a place), contracted to im.
    expect(words(step('click', { target: logo }))).toBe(`Auf das Bild ${q('Acme')} klicken`);
    expect(words(step('click', { target: heading }))).toBe(`Auf die Überschrift ${q('Cart')} klicken`);
    expect(words(step('check', { target: darkMode }))).toBe(`Den Schalter ${q('Dark mode')} aktivieren`);
    expect(words(step('selectOption', { target: darkMode, value: 'On' }))).toBe(
      `${q('On')} im Schalter ${q('Dark mode')} auswählen`,
    );
    expect(words(step('press', { target: country, value: 'ArrowDown' }))).toBe(
      `Pfeil nach unten in der Auswahlliste ${q('Country')} drücken`,
    );
    expect(words(step('click', { target: target({ tagName: 'span', testId: 'promo' }) }))).toBe(
      'Auf das Element mit der Test-ID `promo` klicken',
    );
    expect(words(step('fill', { target: target({ tagName: 'input', testId: 'promo' }), value: 'X' }))).toBe(
      `${q('X')} in das Element mit der Test-ID \`promo\` eingeben`,
    );
  });

  test('states what should happen, for every matcher, negated or not', () => {
    const expectation = (s: RecordedStep) => describeExpectation(s, german);
    expect(words(step('assert', { target: total, ...assertion('toHaveText', false, 'Total: 42') }))).toBe(
      `Das Element mit der Test-ID \`cart-total\` sollte ${q('Total: 42')} anzeigen`,
    );
    expect(expectation(step('assert', { target: total, ...assertion('toHaveText', true, 'Total: 42') }))).toBe(
      `das Element mit der Test-ID \`cart-total\` sollte nicht ${q('Total: 42')} anzeigen`,
    );
    expect(expectation(step('assert', { target: coupon, ...assertion('toHaveValue', false, 'SPRING10') }))).toBe(
      `das Textfeld ${q('Coupon')} sollte den Wert ${q('SPRING10')} haben`,
    );
    expect(expectation(step('assert', { target: button, ...assertion('toHaveAccessibleName', false, 'Pay') }))).toBe(
      // A name is not described by the name that is wrong.
      `der Button sollte ${q('Pay')} heißen`,
    );
    expect(expectation(step('assert', assertion('toHaveURL', false, '/checkout')))).toBe(
      'die Seite sollte `/checkout` sein',
    );
    expect(expectation(step('assert', assertion('toHaveURL', true, '/checkout')))).toBe(
      'die Seite sollte nicht `/checkout` sein',
    );
    expect(expectation(step('assert', { target: logo, ...assertion('toBeVisible') }))).toBe(
      `das Bild ${q('Acme')} sollte sichtbar sein`,
    );
    expect(expectation(step('assert', { target: logo, ...assertion('toBeHidden') }))).toBe(
      `das Bild ${q('Acme')} sollte ausgeblendet sein`,
    );
    expect(expectation(step('assert', { target: button, ...assertion('toBeEnabled') }))).toBe(
      `der Button ${q('Apply coupon')} sollte nutzbar sein`,
    );
    expect(expectation(step('assert', { target: button, ...assertion('toBeDisabled', true) }))).toBe(
      `der Button ${q('Apply coupon')} sollte nicht ausgegraut sein`,
    );
    expect(words(step('assertVisible', { target: heading }))).toBe(`Die Überschrift ${q('Cart')} sollte sichtbar sein`);
  });

  test('counts the evidence with German plurals: only 1 in the singular', () => {
    expect(summarizeEvidence(report([]).evidence, german)).toBe(
      '3 Screenshots · 3 Konsolenfehler · 1 Konsolenwarnung · 1 fehlgeschlagene Anfrage · Seitenstruktur',
    );
    expect(summarizeEvidence(emptyBugEvidence(), german)).toBe('kein Screenshot');
    expect(
      german.evidence({
        screenshots: 1,
        stepShots: 12,
        consoleErrors: 1,
        consoleWarnings: 2,
        failedRequests: 1234,
        outline: false,
      }),
    ).toBe(
      '1 Screenshot · 12 Schritt-Screenshots · 1 Konsolenfehler · 2 Konsolenwarnungen · 1.234 fehlgeschlagene Anfragen',
    );
  });

  test('writes a whole report in German, with no English template left', () => {
    const markdown = renderBugMarkdown(report(everyTemplate()), german);
    expect(markdown).toContain('# Bug auf /cart');
    expect(markdown).toContain(
      '**Seite** `/cart` auf https://shop.test · Chrome 141 · 1280×720 · 2026-09-27 14:05 UTC',
    );
    expect(markdown).toContain('## Schritte zum Reproduzieren');
    expect(markdown).toContain(`2. Auf den Button ${q('Apply coupon')} klicken`);
    expect(markdown).toContain('## Erwartet und tatsächlich');
    expect(markdown).toContain(
      `- Schritt 11: das Element mit der Test-ID \`cart-total\` sollte ${q('Total: 42')} anzeigen.`,
    );
    expect(markdown).toContain('## Belege');
    expect(markdown).toContain('### Screenshots');
    expect(markdown).toContain('- `screenshots/1-marked.png`, nach Schritt 4');
    expect(markdown).toContain('- `screenshots/3-manual.png`, von Hand aufgenommen');
    expect(markdown).toContain('### Konsole (4 von 6)');
    expect(markdown).toContain('- nicht abgefangener Fehler auf `/cart` um 14:00:00: `x is undefined`');
    expect(markdown).toContain('- unbehandelte Promise-Ablehnung auf `/cart` um 14:00:00: `boom`');
    expect(markdown).toContain('### Fehlgeschlagene Anfragen (1)');
    expect(markdown).toContain('- `POST /api/coupons` → 500, auf `/cart` um 14:00:00');
    expect(markdown).toContain('### Seitenstruktur');
    for (const english of [
      ' should ',
      'Click ',
      'Fill ',
      'Step ',
      'Evidence',
      ' on `',
      ' at ',
      'Expected',
      'error ',
      'Page outline',
    ]) {
      expect(markdown, english).not.toContain(english);
    }
  });

  test('writes what the page showed, and the report’s own labels', () => {
    const marked = step('assert', {
      target: total,
      assertion: {
        matcher: 'toHaveText',
        expected: 'Total: 42',
        actual: 'Total: 40',
        negated: false,
        note: 'Rabatt fehlt',
      },
    });
    const markdown = renderBugMarkdown(report([marked]), german);
    expect(markdown).toContain(`   - Ergebnis: ${q('Total: 40')}`);
    expect(markdown).toContain('   - Notiz: Rabatt fehlt');
    expect(markdown).toContain(
      `- Schritt 1: das Element mit der Test-ID \`cart-total\` sollte ${q('Total: 42')} anzeigen. Ergebnis: ${q('Total: 40')}.`,
    );
    const empty = renderBugMarkdown({ ...report([]), context: { ...report([]).context, pageKey: '' } }, german);
    expect(empty).toContain('# Gemeldeter Bug');
    expect(empty).toContain('Es wurden keine Schritte aufgezeichnet.');
    expect(empty).toContain('Nichts wurde als Fehler markiert.');
  });
});
