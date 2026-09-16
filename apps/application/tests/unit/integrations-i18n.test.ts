import { describe, test, expect } from 'vitest';
import { en } from '../../shared/integrations/messages/en';
import { fr } from '../../shared/integrations/messages/fr';
import { selectPlural, t, formatDate, SUPPORTED_LOCALES } from '../../shared/integrations/messages';
import { buildIssue, type IssueFacts } from '../../shared/integrations/build-issue';
import { renderMarkdown } from '../../shared/integrations/render-markdown';

describe('message catalogs', () => {
  test('fr has exactly the keys of en — no missing, no extra', () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  test('en is the supported base locale', () => {
    expect(SUPPORTED_LOCALES).toContain('en');
    expect(SUPPORTED_LOCALES).toContain('fr');
  });
});

describe('plural selection', () => {
  test('French treats 0 and 1 as singular; English only 1', () => {
    expect(selectPlural('fr', 0)).toBe('one');
    expect(selectPlural('fr', 1)).toBe('one');
    expect(selectPlural('fr', 2)).toBe('other');
    expect(selectPlural('en', 0)).toBe('other');
    expect(selectPlural('en', 1)).toBe('one');
    expect(selectPlural('en', 2)).toBe('other');
  });

  test('t() picks the plural form and interpolates the localized count', () => {
    expect(t('en', 'section.affectedTests', { count: 1 })).toBe('1 affected test');
    expect(t('en', 'section.affectedTests', { count: 3 })).toBe('3 affected tests');
    expect(t('fr', 'section.affectedTests', { count: 1 })).toBe('1 test affecté');
    expect(t('fr', 'section.affectedTests', { count: 3 })).toBe('3 tests affectés');
  });
});

describe('formatDate', () => {
  test('formats a medium UTC date per locale', () => {
    const iso = '2026-07-12T14:03:00.000Z';
    expect(formatDate('en', iso)).toMatch(/Jul/);
    expect(formatDate('fr', iso)).toMatch(/juil/);
    expect(formatDate('en', null)).toBeNull();
  });
});

function facts(): IssueFacts {
  return {
    clusterId: 7,
    fingerprint: 'abcdef1234',
    title: 'Timeout on checkout',
    headline: "getByRole('button') timed out",
    errorType: 'timeout',
    firstSeen: '12 juil. 2026',
    lastSeen: '13 juil. 2026',
    occurrences: 3,
    affectedTests: [{ title: 'checks out', filePath: 'checkout.spec.ts', owner: '@acme/checkout' }],
    branch: 'main',
    environment: 'staging',
    commit: 'abc123',
    diagnosisSummary: null,
    rootCause: null,
    clue: 'Timed out waiting for the app',
    errorExcerpt: 'TimeoutError: locator.click',
    failingLocator: "getByRole('button')",
    patch: null,
    locatorEdits: [],
    verifyCommand: 'npx playwright test checkout.spec.ts',
    reproduceScript: null,
    clusterUrl: 'https://piwi.test/failure-clusters/7',
    executionUrl: null,
    runUrl: null,
    shareUrl: null,
  };
}

describe('French document', () => {
  const md = renderMarkdown(buildIssue(facts(), { locale: 'fr' }).document);

  test('headings and fact labels are French', () => {
    expect(md).toContain("## Ce qui s'est passé");
    expect(md).toContain('## Preuves');
    expect(md).toContain('## Quoi faire');
    expect(md).toContain('## Liens');
    expect(md).toContain("**Type d'erreur**");
    expect(md).toContain('**Première occurrence**');
    expect(md).toContain('### 1 test affecté');
    expect(md).toContain('Localisateur en échec');
  });

  test('data is never translated — locators, commands and the trailer stay verbatim', () => {
    expect(md).toContain("getByRole('button')");
    expect(md).toContain('npx playwright test checkout.spec.ts');
    expect(md).toContain('Piwi-Cluster: 7');
    // The deterministic English clue is quoted as-is.
    expect(md).toContain('Timed out waiting for the app');
  });
});
