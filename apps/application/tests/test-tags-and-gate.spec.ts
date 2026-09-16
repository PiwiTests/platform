/**
 * End-to-end coverage for the two halves of tag-driven CI policy:
 *
 * 1. Test tags and `piwi:` ownership metadata survive ingest, land on both the
 *    per-execution row and the shared test-case row, and drive the catalog and
 *    flaky-leaderboard filters.
 * 2. The gate endpoint turns a finished run into a pass/fail verdict, including
 *    the case that matters most — a required tag nobody carries.
 */

import { test, expect, type APIRequestContext } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

interface SubmitCase {
  title: string;
  status: string;
  location?: string;
  error?: string;
  retries?: number;
  tags?: string[];
  testAnnotations?: Array<{ type: string; description?: string }>;
}

async function submitRun(
  request: APIRequestContext,
  projectName: string,
  cases: SubmitCase[],
  startTime?: string,
): Promise<{ runId: number; projectId: number }> {
  const passedTests = cases.filter((c) => c.status === 'passed').length;
  const failedTests = cases.filter((c) => c.status === 'failed').length;

  const res = await request.post('/api/test-runs/submit', {
    data: {
      projectName,
      status: failedTests > 0 ? 'failed' : 'passed',
      startTime: startTime ?? new Date().toISOString(),
      duration: 5000,
      totalTests: cases.length,
      passedTests,
      failedTests,
      skippedTests: 0,
      testCases: cases.map((c) => ({ duration: 100, location: 'tests/app.spec.ts:1:1', ...c })),
    },
  });
  expect(res.ok()).toBeTruthy();
  return res.json() as Promise<{ runId: number; projectId: number }>;
}

test.describe.serial('Test tags and piwi metadata', () => {
  let projectId: number;
  let runId: number;

  test.beforeAll(async ({ request }) => {
    const result = await submitRun(request, PROJECT.TEST_TAGS, [
      {
        title: 'checkout completes',
        status: 'passed',
        tags: ['@smoke', '@critical'],
        testAnnotations: [
          { type: 'piwi:owner', description: '@checkout-team' },
          { type: 'piwi:priority', description: 'critical' },
          { type: 'piwi:feature', description: 'Checkout' },
          { type: 'piwi:link', description: 'https://example.com/PROJ-1' },
        ],
      },
      { title: 'settings page loads', status: 'passed', tags: ['smoke'] },
      { title: 'untagged helper', status: 'passed' },
    ]);
    projectId = result.projectId;
    runId = result.runId;
  });

  test('tags and metadata land on the run’s executions', async ({ request }) => {
    const res = await request.get(`/api/test-runs/${runId}`);
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      testCases: Array<{ title: string; tags: string[] | null; testMeta: Record<string, string> | null }>;
    };

    const tagged = body.testCases.find((c) => c.title === 'checkout completes');
    // Stored with the leading @ stripped, however it was declared.
    expect(tagged?.tags).toEqual(['smoke', 'critical']);
    expect(tagged?.testMeta).toEqual({
      owner: '@checkout-team',
      priority: 'critical',
      feature: 'Checkout',
      link: 'https://example.com/PROJ-1',
    });

    const untagged = body.testCases.find((c) => c.title === 'untagged helper');
    expect(untagged?.tags).toBeNull();
    expect(untagged?.testMeta).toBeNull();
  });

  test('the catalog filters by tag, requiring every listed tag', async ({ request }) => {
    const smoke = await request.get(`/api/projects/${projectId}/test-cases?tags=smoke&maxAgeDays=0`);
    const smokeBody = (await smoke.json()) as { items: Array<{ title: string }> };
    expect(smokeBody.items.map((i) => i.title).sort()).toEqual(['checkout completes', 'settings page loads']);

    // Two tags is an AND, not an OR.
    const both = await request.get(`/api/projects/${projectId}/test-cases?tags=smoke,critical&maxAgeDays=0`);
    const bothBody = (await both.json()) as { items: Array<{ title: string }> };
    expect(bothBody.items.map((i) => i.title)).toEqual(['checkout completes']);
  });

  test('a leading @ in the filter is optional', async ({ request }) => {
    const res = await request.get(`/api/projects/${projectId}/test-cases?tags=@critical&maxAgeDays=0`);
    const body = (await res.json()) as { items: Array<{ title: string }> };
    expect(body.items.map((i) => i.title)).toEqual(['checkout completes']);
  });

  test('a tag prefix does not match a longer tag', async ({ request }) => {
    const res = await request.get(`/api/projects/${projectId}/test-cases?tags=smok&maxAgeDays=0`);
    const body = (await res.json()) as { items: unknown[]; total: number };
    expect(body.total).toBe(0);
  });

  test('the catalog filters by owner and priority', async ({ request }) => {
    const owner = await request.get(
      `/api/projects/${projectId}/test-cases?owner=${encodeURIComponent('@checkout-team')}&maxAgeDays=0`,
    );
    const ownerBody = (await owner.json()) as { items: Array<{ title: string; owner: string | null }> };
    expect(ownerBody.items.map((i) => i.title)).toEqual(['checkout completes']);
    expect(ownerBody.items[0]?.owner).toBe('@checkout-team');

    const priority = await request.get(`/api/projects/${projectId}/test-cases?priority=critical&maxAgeDays=0`);
    const priorityBody = (await priority.json()) as { items: Array<{ title: string }> };
    expect(priorityBody.items.map((i) => i.title)).toEqual(['checkout completes']);
  });

  test('removing a tag from a spec clears it on the next run', async ({ request }) => {
    await submitRun(request, PROJECT.TEST_TAGS, [{ title: 'settings page loads', status: 'passed' }]);

    const res = await request.get(`/api/projects/${projectId}/test-cases?tags=smoke&maxAgeDays=0`);
    const body = (await res.json()) as { items: Array<{ title: string }> };
    expect(body.items.map((i) => i.title)).toEqual(['checkout completes']);
  });
});

test.describe.serial('CI gate policy', () => {
  let runId: number;

  test.beforeAll(async ({ request }) => {
    const result = await submitRun(request, PROJECT.GATE_POLICY, [
      { title: 'critical checkout path', status: 'failed', error: 'Error: boom', tags: ['@critical'] },
      { title: 'nice-to-have banner', status: 'failed', error: 'Error: cosmetic', tags: ['@cosmetic'] },
      { title: 'stable login', status: 'passed', tags: ['@critical', '@login'] },
    ]);
    runId = result.runId;
  });

  test('fails when a required tag’s test failed', async ({ request }) => {
    const res = await request.post(`/api/test-runs/${runId}/gate`, { data: { requireTags: ['critical'] } });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      passed: boolean;
      violations: Array<{ rule: string; message: string }>;
    };
    expect(body.passed).toBe(false);
    expect(body.violations[0]?.rule).toBe('required-tag');
    expect(body.violations[0]?.message).toContain('critical checkout path');
    // The passing @critical test must not be reported as a violation.
    expect(body.violations[0]?.message).not.toContain('stable login');
  });

  test('passes when every test carrying the required tag passed', async ({ request }) => {
    // @login sits only on the passing test, so the policy is satisfied even
    // though the run as a whole failed — that is the point of a tag rule.
    const res = await request.post(`/api/test-runs/${runId}/gate`, { data: { requireTags: ['login'] } });
    const body = (await res.json()) as { passed: boolean; violations: unknown[] };
    expect(body.passed).toBe(true);
    expect(body.violations).toEqual([]);
  });

  // The rule that makes the whole feature trustworthy: a misspelled tag must
  // never quietly pass, because a gate that protects nothing looks identical to
  // a gate that protects everything.
  test('fails on a required tag no test carries', async ({ request }) => {
    const res = await request.post(`/api/test-runs/${runId}/gate`, { data: { requireTags: ['critcal'] } });
    const body = (await res.json()) as { passed: boolean; violations: Array<{ rule: string; message: string }> };
    expect(body.passed).toBe(false);
    expect(body.violations[0]?.rule).toBe('unmatched-tag');
    expect(body.violations[0]?.message).toContain('@critcal');
  });

  test('enforces the failure threshold', async ({ request }) => {
    const strict = await request.post(`/api/test-runs/${runId}/gate`, { data: { maxFailed: 1 } });
    expect(((await strict.json()) as { passed: boolean }).passed).toBe(false);

    const lenient = await request.post(`/api/test-runs/${runId}/gate`, { data: { maxFailed: 2 } });
    expect(((await lenient.json()) as { passed: boolean }).passed).toBe(true);
  });

  test('reports every violation, not just the first', async ({ request }) => {
    const res = await request.post(`/api/test-runs/${runId}/gate`, {
      data: { requireTags: ['critical'], maxFailed: 0, failOnNewCluster: true },
    });
    const body = (await res.json()) as { violations: Array<{ rule: string }> };
    const rules = body.violations.map((v) => v.rule);
    expect(rules).toContain('required-tag');
    expect(rules).toContain('max-failed');
    expect(rules).toContain('new-cluster');
  });

  test('rejects an empty policy rather than passing it', async ({ request }) => {
    const res = await request.post(`/api/test-runs/${runId}/gate`, { data: {} });
    expect(res.status()).toBe(400);
  });

  test('returns 404 for an unknown run', async ({ request }) => {
    const res = await request.post('/api/test-runs/99999999/gate', { data: { maxFailed: 0 } });
    expect(res.status()).toBe(404);
  });
});
