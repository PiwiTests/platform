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

const spanish = BUG_PHRASES.es!;

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
const total = target({ tagName: 'p', testId: 'cart-total', text: 'Total: 40' });
const row = target({ tagName: 'tr', role: 'row', accessibleName: 'Invoice 42' });
const logo = target({ tagName: 'img', role: 'img', accessibleName: 'Acme' });
const menu = target({ tagName: 'nav', role: 'menu', accessibleName: 'Account' });

/** Every action and every matcher, negated or not: each template of the phrasebook. */
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

describe('Spanish', () => {
  const words = (s: RecordedStep, phrases: BugPhrases = spanish) => describeStepInWords(s, phrases);
  const q = (text: string) => `«${text}»`;

  test('is the phrasebook of every Spanish tag', () => {
    expect(bugPhrases('es')).toBe(spanish);
    expect(bugPhrases('es-419')).toBe(spanish);
    expect(bugPhrases('es_MX')).toBe(spanish);
    expect(spanish.roles.combobox?.noun).toBe('lista desplegable');
  });

  test('writes the steps of the plan’s table, page texts kept as they are', () => {
    expect(words(step('click', { target: button }))).toBe('Hacer clic en el botón «Apply coupon»');
    expect(words(step('fill', { target: coupon, value: 'SPRING10' }))).toBe(
      'Escribir «SPRING10» en el campo de texto «Coupon»',
    );
    expect(words(step('selectOption', { target: country, value: 'France' }))).toBe(
      'Elegir «France» en la lista desplegable «Country»',
    );
    expect(words(step('check', { target: agree }))).toBe('Marcar la casilla «I agree»');
    expect(words(step('hover', { target: row }))).toBe('Pasar el cursor sobre la fila de tabla «Invoice 42»');
  });

  test('writes the other actions, with Spanish key names', () => {
    expect(words(step('goto', { value: '/cart' }))).toBe('Abrir `/cart`');
    expect(words(step('uncheck', { target: agree }))).toBe(`Desmarcar la casilla ${q('I agree')}`);
    expect(words(step('fill', { target: coupon, redacted: true }))).toBe(
      `Escribir una contraseña (no grabada) en el campo de texto ${q('Coupon')}`,
    );
    expect(words(step('press', { target: coupon, value: 'Enter' }))).toBe(
      `Presionar Enter en el campo de texto ${q('Coupon')}`,
    );
    expect(words(step('press', { value: 'Backspace' }))).toBe('Presionar Retroceso');
    expect(words(step('press', { value: 'F5' }))).toBe('Presionar F5');
    expect(words(step('click', { target: logo }))).toBe(`Hacer clic en la imagen ${q('Acme')}`);
  });

  test('states each matcher, negated or not', () => {
    const expectation = (s: RecordedStep) => describeExpectation(s, spanish);
    expect(expectation(step('assert', { target: total, ...assertion('toHaveText', false, 'Total: 42') }))).toBe(
      `el elemento con el test id \`cart-total\` debería mostrar ${q('Total: 42')}`,
    );
    expect(expectation(step('assert', { target: coupon, ...assertion('toHaveValue', true, 'SPRING10') }))).toBe(
      `el campo de texto ${q('Coupon')} no debería tener el valor ${q('SPRING10')}`,
    );
    expect(expectation(step('assert', { target: button, ...assertion('toHaveAccessibleName', false, 'Pay') }))).toBe(
      `el botón debería llamarse ${q('Pay')}`,
    );
    expect(expectation(step('assert', assertion('toHaveURL', false, '/checkout')))).toBe(
      'la página debería ser `/checkout`',
    );
    expect(expectation(step('assert', assertion('toHaveURL', true, '/checkout')))).toBe(
      'la página no debería ser `/checkout`',
    );
    expect(expectation(step('assert', { target: button, ...assertion('toBeVisible') }))).toBe(
      `el botón ${q('Apply coupon')} debería estar visible`,
    );
    expect(expectation(step('assert', { target: button, ...assertion('toBeEnabled', true) }))).toBe(
      `el botón ${q('Apply coupon')} no debería estar habilitado`,
    );
  });

  test('makes the article and the state agree with the noun', () => {
    const expectation = (s: RecordedStep) => describeExpectation(s, spanish);
    expect(expectation(step('assert', { target: logo, ...assertion('toBeHidden') }))).toBe(
      `la imagen ${q('Acme')} debería estar oculta`,
    );
    expect(expectation(step('assert', { target: menu, ...assertion('toBeHidden') }))).toBe(
      `el menú ${q('Account')} debería estar oculto`,
    );
    expect(expectation(step('assert', { target: country, ...assertion('toBeDisabled', true) }))).toBe(
      `la lista desplegable ${q('Country')} no debería estar deshabilitada`,
    );
    expect(expectation(step('assert', { target: button, ...assertion('toBeDisabled') }))).toBe(
      `el botón ${q('Apply coupon')} debería estar deshabilitado`,
    );
    expect(words(step('assert', { target: logo, ...assertion('toBeHidden') }))).toBe(
      `La imagen ${q('Acme')} debería estar oculta`,
    );
  });

  test('counts the evidence with Spanish plurals: only 1 in the singular', () => {
    expect(summarizeEvidence(report([]).evidence, spanish)).toBe(
      '3 capturas de pantalla · 3 errores de consola · 1 advertencia de consola · 1 solicitud fallida · esquema de la página',
    );
    expect(summarizeEvidence(emptyBugEvidence(), spanish)).toBe('ninguna captura de pantalla');
    const one = {
      ...emptyBugEvidence(),
      screenshots: [{ file: 'screenshots/1-manual.png', step: null, moment: 'manual' as const, takenAt: 1 }],
    };
    expect(summarizeEvidence(one, spanish)).toBe('1 captura de pantalla');
    expect(
      spanish.evidence({
        screenshots: 2,
        stepShots: 1,
        consoleErrors: 1,
        consoleWarnings: 2,
        failedRequests: 2,
        outline: false,
      }),
    ).toBe(
      '2 capturas de pantalla · 1 captura de paso · 1 error de consola · 2 advertencias de consola · 2 solicitudes fallidas',
    );
  });

  test('writes a whole report in Spanish, with no English template left', () => {
    const markdown = renderBugMarkdown(report(everyTemplate()), spanish);
    expect(markdown).toContain('# Bug en /cart');
    expect(markdown).toContain('## Pasos para reproducirlo');
    expect(markdown).toContain('## Resultado esperado y obtenido');
    expect(markdown).toContain(
      `- Paso 11: el elemento con el test id \`cart-total\` debería mostrar ${q('Total: 42')}.`,
    );
    expect(markdown).toContain(
      '**Página** `/cart` en https://shop.test · Chrome 141 · 1280×720 · 2026-09-27 14:05 UTC',
    );
    expect(markdown).toContain('## Datos recogidos');
    expect(markdown).toContain('### Capturas de pantalla');
    expect(markdown).toContain('### Consola (4 de 6)');
    expect(markdown).toContain('- error no capturado en `/cart` a las 14:00:00: `x is undefined`');
    expect(markdown).toContain('- promesa rechazada no gestionada en `/cart` a las 14:00:00: `boom`');
    expect(markdown).toContain('- advertencia en `/cart` a las 14:00:00: `slow`');
    expect(markdown).toContain('### Solicitudes fallidas (1)');
    expect(markdown).toContain('- `POST /api/coupons` → 500, en `/cart` a las 14:00:00');
    expect(markdown).toContain('- `screenshots/1-marked.png`, después del paso 4');
    expect(markdown).toContain('- `screenshots/2-finish.png`, al terminar el informe');
    expect(markdown).toContain('- `screenshots/3-manual.png`, hecha a mano');
    expect(markdown).toContain('### Esquema de la página');
    for (const english of [
      ' should ',
      'Click ',
      'Fill ',
      'Step ',
      'Evidence',
      'Screenshots',
      'Expected',
      'Failed requests',
      ' on `',
      ' at ',
      '"',
    ]) {
      expect(markdown.replace(/```[\s\S]*?```/g, ''), english).not.toContain(english);
    }
  });
});
