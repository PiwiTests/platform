import { describe, test, expect } from 'vitest';
import { BUG_PHRASES, bugPhrases } from '../src/bug-phrases';
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

const portuguese = BUG_PHRASES.pt!;

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
const menu = target({ tagName: 'nav', role: 'navigation', text: 'Shop' });

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

describe('Brazilian Portuguese', () => {
  const words = (s: RecordedStep) => describeStepInWords(s, portuguese);
  const expectation = (s: RecordedStep) => describeExpectation(s, portuguese);

  test('is the phrasebook of pt and pt-BR', () => {
    expect(bugPhrases('pt-BR')).toBe(portuguese);
    expect(bugPhrases('pt_BR')).toBe(portuguese);
    expect(portuguese.language).toBe('pt-BR');
    expect(portuguese.roles.combobox?.noun).toBe('lista suspensa');
  });

  test('writes the steps of the plan, the preposition contracted with the article', () => {
    expect(words(step('goto', { value: '/cart' }))).toBe('Abrir `/cart`');
    expect(words(step('click', { target: button }))).toBe('Clicar no botão “Apply coupon”');
    expect(words(step('fill', { target: coupon, value: 'SPRING10' }))).toBe(
      'Digitar “SPRING10” no campo de texto “Coupon”',
    );
    expect(words(step('selectOption', { target: country, value: 'France' }))).toBe(
      'Escolher “France” na lista suspensa “Country”',
    );
    expect(words(step('check', { target: agree }))).toBe('Marcar a caixa de seleção “I agree”');
    expect(words(step('hover', { target: row }))).toBe('Passar o mouse sobre a linha de tabela “Invoice 42”');
    expect(words(step('uncheck', { target: agree }))).toBe('Desmarcar a caixa de seleção “I agree”');
    expect(words(step('fill', { target: coupon, redacted: true }))).toBe(
      'Digitar uma senha (não gravada) no campo de texto “Coupon”',
    );
  });

  test('contracts em with every kind of subject', () => {
    expect(words(step('click', { target: logo }))).toBe('Clicar na imagem “Acme”');
    expect(words(step('click', { target: menu }))).toBe('Clicar na navegação “Shop”');
    expect(words(step('click', { target: target({ accessibleName: 'Save' }) }))).toBe('Clicar em “Save”');
    expect(words(step('click', { target: target({ testId: 'pay' }) }))).toBe('Clicar no elemento com o test id `pay`');
    expect(words(step('click', { target: target({ tagName: 'span' }) }))).toBe('Clicar em um elemento `span`');
    expect(words(step('click', { target: target({ tagName: 'li', role: 'option' }) }))).toBe('Clicar em uma opção');
  });

  test('names keys as Brazilian keyboards print them', () => {
    expect(words(step('press', { target: coupon, value: 'Enter' }))).toBe(
      'Pressionar Enter no campo de texto “Coupon”',
    );
    expect(words(step('press', { value: 'Escape' }))).toBe('Pressionar Esc');
    expect(words(step('press', { value: 'ArrowDown' }))).toBe('Pressionar Seta para baixo');
    expect(words(step('press', { value: 'F5' }))).toBe('Pressionar F5');
  });

  test('says what should happen for every kind of matcher', () => {
    expect(words(step('assert', { target: total, ...assertion('toHaveText', false, 'Total: 42') }))).toBe(
      'O elemento com o test id `cart-total` deveria mostrar “Total: 42”',
    );
    expect(expectation(step('assert', { target: total, ...assertion('toHaveText', true, 'Total: 42') }))).toBe(
      'o elemento com o test id `cart-total` não deveria mostrar “Total: 42”',
    );
    expect(expectation(step('assert', { target: coupon, ...assertion('toHaveValue', false, 'SPRING10') }))).toBe(
      'o campo de texto “Coupon” deveria ter o valor “SPRING10”',
    );
    expect(expectation(step('assert', { target: button, ...assertion('toHaveAccessibleName', false, 'Pay') }))).toBe(
      // Named by what it is, not by the name the expectation is about.
      'o botão deveria se chamar “Pay”',
    );
    expect(expectation(step('assert', assertion('toHaveURL', false, '/checkout')))).toBe(
      'a página deveria ser `/checkout`',
    );
    expect(expectation(step('assert', assertion('toHaveURL', true, '/checkout')))).toBe(
      'a página não deveria ser `/checkout`',
    );
    expect(expectation(step('assertVisible', { target: button }))).toBe('o botão “Apply coupon” deveria estar visível');
    expect(expectation(step('assert', { target: button, ...assertion('toBeEnabled') }))).toBe(
      'o botão “Apply coupon” deveria estar habilitado',
    );
  });

  test('makes the state agree with the noun', () => {
    expect(expectation(step('assert', { target: logo, ...assertion('toBeHidden') }))).toBe(
      'a imagem “Acme” deveria estar oculta',
    );
    expect(expectation(step('assert', { target: button, ...assertion('toBeHidden') }))).toBe(
      'o botão “Apply coupon” deveria estar oculto',
    );
    expect(expectation(step('assert', { target: agree, ...assertion('toBeDisabled', true) }))).toBe(
      'a caixa de seleção “I agree” não deveria estar desabilitada',
    );
    expect(expectation(step('assert', { target: button, ...assertion('toBeDisabled', true) }))).toBe(
      'o botão “Apply coupon” não deveria estar desabilitado',
    );
    expect(expectation(step('assert', { target: country, ...assertion('toBeEnabled') }))).toBe(
      'a lista suspensa “Country” deveria estar habilitada',
    );
  });

  test('counts the evidence with Brazilian plurals: 0 and 1 in the singular', () => {
    expect(summarizeEvidence(report([]).evidence, portuguese)).toBe(
      '3 capturas de tela · 3 erros de console · 1 aviso de console · 1 requisição com falha · estrutura da página',
    );
    expect(summarizeEvidence(emptyBugEvidence(), portuguese)).toBe('nenhuma captura de tela');
    expect(
      portuguese.evidence({
        screenshots: 1,
        stepShots: 0,
        consoleErrors: 1234,
        consoleWarnings: 0,
        failedRequests: 2,
        outline: false,
      }),
    ).toBe('1 captura de tela · 1.234 erros de console · 2 requisições com falha');
  });

  test('writes a whole report in Portuguese, with no English template left', () => {
    const markdown = renderBugMarkdown(report(everyTemplate()), portuguese);
    expect(markdown).toContain('# Bug em /cart');
    expect(markdown).toContain('## Passos para reproduzir');
    expect(markdown).toContain('## Esperado e obtido');
    expect(markdown).toContain('- Passo 11: o elemento com o test id `cart-total` deveria mostrar “Total: 42”.');
    expect(markdown).toContain(
      '**Página** `/cart` em https://shop.test · Chrome 141 · 1280×720 · 2026-09-27 14:05 UTC',
    );
    expect(markdown).toContain('### Console (4 de 6)');
    expect(markdown).toContain('- erro não capturado em `/cart` às 14:00:00: `x is undefined`');
    expect(markdown).toContain('- promise rejeitada sem tratamento em `/cart` às 14:00:00: `boom`');
    expect(markdown).toContain('- `POST /api/coupons` → 500, em `/cart` às 14:00:00');
    expect(markdown).toContain('- `screenshots/1-marked.png`, depois do passo 4');
    expect(markdown).toContain('### Estrutura da página');
    for (const english of [
      ' should ',
      'Click ',
      'Fill ',
      'Step ',
      'Evidence',
      'Screenshots',
      ' on `',
      ' at ',
      'Expected',
      'Page outline',
      'uncaught',
      'Note:',
      'Actual:',
      '"',
    ]) {
      expect(markdown.replace(/```[\s\S]*?```/g, ''), english).not.toContain(english);
    }
  });
});
