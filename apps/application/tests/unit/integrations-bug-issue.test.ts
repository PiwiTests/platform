import { describe, test, expect } from 'vitest';
import { buildBugIssue, bugIssueLabels, type BugIssueFacts } from '../../shared/integrations/build-issue';
import { renderMarkdown } from '../../shared/integrations/render-markdown';
import { couponBugReport } from '../utils/bug-report-sample';

function facts(overrides: Partial<BugIssueFacts> = {}): BugIssueFacts {
  const report = couponBugReport('Gutschein wird nicht angewendet');
  const steps = {
    ...report.steps,
    steps: report.steps.steps.map((step) =>
      step.assertion ? { ...step, assertion: { ...step.assertion, note: 'Der Gutschein wird ignoriert' } } : step,
    ),
  };
  return {
    id: 37,
    title: 'Gutschein wird nicht angewendet',
    steps,
    evidence: report.evidence,
    context: report.context,
    reportLanguage: 'de',
    reportedBy: 'Ana',
    reportedAt: '27 sept. 2026',
    spec: { path: 'tests/bugs/gutschein.spec.ts', code: "test('bug: gutschein', async ({ page }) => {});" },
    reproductions: [{ verdict: 'reproduced', divergedAt: null, origin: 'http://localhost:3000', source: 'replay' }],
    reportUrl: 'https://piwi.acme.test/bug-reports/37',
    ...overrides,
  };
}

describe('buildBugIssue', () => {
  test('a report written in German files a French ticket: the steps in French, the reporter’s words as typed', () => {
    const md = renderMarkdown(buildBugIssue(facts(), { locale: 'fr' }).document);
    expect(md).toContain('## Étapes pour reproduire');
    expect(md).toMatch(/Saisir « SPRING10 »/);
    expect(md).toContain('## Attendu et constaté');
    expect(md).toContain('Der Gutschein wird ignoriert');
    expect(md).toContain('Signalé en allemand');
    expect(md).toContain('tests/bugs/gutschein.spec.ts');
    expect(md).toContain('Reproduit — http://localhost:3000 (rejoué dans un navigateur)');
    expect(md).toContain('Piwi-Bug: 37');
    expect(md).not.toMatch(/\bFill\b|Steps to reproduce/);
  });

  test('says nothing about the language when the report is in the ticket’s', () => {
    const md = renderMarkdown(buildBugIssue(facts({ reportLanguage: 'en' }), { locale: 'en' }).document);
    expect(md).toContain('## Steps to reproduce');
    expect(md).not.toContain('Reported in');
  });

  test('carries the labels a filed report is found by', () => {
    expect(buildBugIssue(facts()).labels).toEqual(bugIssueLabels(37));
    expect(bugIssueLabels(37)).toEqual(['piwi', 'piwi-bug-37']);
  });
});
