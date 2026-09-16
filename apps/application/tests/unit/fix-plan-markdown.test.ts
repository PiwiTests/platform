import { describe, it, expect } from 'vitest';
import { fixPlanToMarkdown } from '#shared/fix-plan-markdown';
import type { FixPlan } from '#shared/fix-plan.types';

function makePlan(overrides: Partial<FixPlan> = {}): FixPlan {
  return {
    cluster: {
      id: 7,
      title: 'Pay button never enables',
      signature: 'Timeout <N>ms exceeded.',
      errorType: 'TimeoutError',
      status: 'open',
      occurrences: 3,
      fixVerification: null,
    },
    diagnosis: null,
    edits: [],
    failingTests: [{ testCaseId: 1, title: 'checkout completes', filePath: 'tests/checkout.spec.ts', executionId: 42 }],
    ownership: { owner: null, source: null },
    verify: {
      command: 'npx playwright test tests/checkout.spec.ts',
      expectation: 'When these pass, Piwi records the fix.',
    },
    reproduce: {
      steps: [
        {
          step: 'Check out the failing commit',
          bash: 'git switch --detach abc123',
          powershell: 'git switch --detach abc123',
        },
        {
          step: 'Run the failing test',
          bash: 'npx playwright test tests/checkout.spec.ts',
          powershell: 'npx playwright test tests/checkout.spec.ts',
        },
      ],
      env: [{ label: 'Environment', value: 'production' }],
      notes: [],
      commit: 'abc123',
      playwrightVersion: '1.50.1',
      browser: 'chromium',
      project: 'chromium',
    },
    bisect: {
      available: true,
      good: 'green01',
      bad: 'abc123',
      goodShort: 'green01',
      badShort: 'abc123',
      bash: 'git bisect start abc123 green01\ngit bisect run npx playwright test\ngit bisect reset',
      powershell: 'git bisect start abc123 green01\ngit bisect run npx playwright test\ngit bisect reset',
      explanation: 'Walks the commits between green01 and abc123.',
    },
    bisectedCommit: null,
    reproduceDesktop: {
      projectId: 1,
      cases: [{ filePath: 'tests/checkout.spec.ts', title: 'checkout completes', line: 42, projectName: 'chromium' }],
      browserName: 'chromium',
      commit: 'abc123',
      good: 'green01',
      bad: 'abc123',
      clusterId: 7,
      repositoryUrl: 'https://github.com/acme/web',
      bisectedCommit: null,
    },
    fixedBefore: [],
    ...overrides,
  };
}

describe('fixPlanToMarkdown', () => {
  it('renders the title, failing tests and verify command for a thin plan', () => {
    const md = fixPlanToMarkdown(makePlan());
    expect(md).toContain('# Fix plan — Pay button never enables');
    expect(md).toContain('## Failing tests');
    expect(md).toContain('checkout completes');
    expect(md).toContain('## Verify');
    expect(md).toContain('npx playwright test tests/checkout.spec.ts');
    // No diagnosis / edits / owner sections when those are absent.
    expect(md).not.toContain('## Diagnosis');
    expect(md).not.toContain('## Suggested locator edits');
    expect(md).not.toContain('## Owner');
  });

  it('renders the reproduce recipe and the bisect', () => {
    const md = fixPlanToMarkdown(makePlan());
    expect(md).toContain('## Reproduce locally');
    expect(md).toContain('# Check out the failing commit');
    expect(md).toContain('git switch --detach abc123');
    expect(md).toContain('Environment: production');
    expect(md).toContain('## Bisect the regression');
    expect(md).toContain('git bisect start abc123 green01');
  });

  it('names the bisected first bad commit when one was recorded', () => {
    const md = fixPlanToMarkdown(
      makePlan({
        bisectedCommit: {
          sha: 'deadbeef1234',
          subject: 'tighten the checkout guard',
          author: 'Dev One',
          date: '2026-01-02',
          commitUrl: 'https://github.com/acme/web/commit/deadbeef1234',
        },
      }),
    );
    expect(md).toContain('Bisected to `deadbeef1234`');
    expect(md).toContain('tighten the checkout guard');
    expect(md).toContain('Dev One, 2026-01-02');
  });

  it('renders the bisect reason when the window is unavailable', () => {
    const md = fixPlanToMarkdown(
      makePlan({ bisect: { available: false, reason: 'A git bisect needs a last-green commit.' } }),
    );
    expect(md).toContain('## Bisect the regression');
    expect(md).toContain('A git bisect needs a last-green commit.');
  });

  it('renders the diagnosis, its patch validation and the patch fence', () => {
    const md = fixPlanToMarkdown(
      makePlan({
        diagnosis: {
          category: 'test-bug',
          confidence: 'high',
          rootCause: 'The locator no longer matches.',
          summary: 'Renamed button.',
          patch: '--- a/x\n+++ b/x\n@@\n-old\n+new',
          patchValidation: { status: 'applies', filesChecked: 1, filesInPatch: 1, errors: [] },
        },
      }),
    );
    expect(md).toContain('## Diagnosis');
    expect(md).toContain('**Category:** test-bug');
    expect(md).toContain('**Root cause:** The locator no longer matches.');
    expect(md).toContain('**Patch validation:** Applies cleanly');
    expect(md).toContain('```diff');
  });

  it('renders locator edits and the owner, and appends the url footer', () => {
    const md = fixPlanToMarkdown(
      makePlan({
        edits: [
          {
            filePath: 'tests/checkout.spec.ts',
            line: 12,
            currentLine: "  await page.getByRole('button').click();",
            failingLocator: "getByRole('button')",
            suggestedLocator: "getByRole('button', { name: 'Pay' })",
            score: 90,
            edit: null,
            executionId: 42,
          },
        ],
        ownership: { owner: '@checkout-team', source: 'codeowners' },
      }),
      { url: 'https://piwi.example/failure-clusters/7' },
    );
    expect(md).toContain('## Suggested locator edits');
    expect(md).toContain('tests/checkout.spec.ts:12');
    expect(md).toContain("getByRole('button', { name: 'Pay' })");
    expect(md).toContain('(score 90/100)');
    expect(md).toContain('## Owner');
    expect(md).toContain('@checkout-team (codeowners)');
    expect(md).toContain('[Open this cluster in Piwi](https://piwi.example/failure-clusters/7)');
  });

  it('renders a "Fixed before" section with the resolving commit and reason', () => {
    const md = fixPlanToMarkdown(
      makePlan({
        fixedBefore: [
          {
            clusterId: 3,
            title: 'Pay button never enables',
            status: 'resolved',
            resolvedAt: '2026-07-12T09:00:00.000Z',
            openMs: 2 * 86_400_000,
            fixCommit: 'abc1234def',
            fixCommitShort: 'abc1234',
            fixCommitUrl: 'https://github.com/acme/app/commit/abc1234def',
            triageNote: 'Waited for the network idle before asserting.',
            owner: '@checkout-team',
            diagnosisTitle: 'The pay button stays disabled until the cart request resolves.',
            diagnosisFeedback: 'up',
            reason: 'same error and locator',
            score: 0.8,
          },
        ],
      }),
    );
    expect(md).toContain('## Fixed before');
    expect(md).toContain('#3 Pay button never enables');
    expect(md).toContain('resolved 12 Jul 2026');
    expect(md).toContain('[`abc1234`](https://github.com/acme/app/commit/abc1234def)');
    expect(md).toContain('open 2 days');
    expect(md).toContain('_same error and locator_');
    expect(md).toContain('Waited for the network idle before asserting.');
  });
});
