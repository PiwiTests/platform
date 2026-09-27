import { test, expect } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

/**
 * Code reach end to end: a run submitted with each case's `codeReach` field
 * (the reporter's opt-in JavaScript coverage) answers which tests reach a
 * source file, and fills the code index editors read.
 */

function run(minutes: number, cases: Array<{ title: string; codeReach?: string[] }>) {
  return {
    projectName: PROJECT.CODE_REACH,
    status: 'passed',
    startTime: new Date(Date.UTC(2026, 8, 2, 10, minutes)).toISOString(),
    duration: 1000,
    totalTests: cases.length,
    passedTests: cases.length,
    failedTests: 0,
    skippedTests: 0,
    testCases: cases.map((c) => ({
      title: c.title,
      status: 'passed',
      duration: 100,
      location: 'tests/checkout.spec.ts:1:1',
      retries: 0,
      codeReach: c.codeReach,
    })),
  };
}

test.describe.serial('Code reach', () => {
  let projectId: number;

  test('a submitted run records the files each test executed', async ({ request }) => {
    const response = await request.post('/api/test-runs/submit', {
      data: run(0, [
        { title: 'pays', codeReach: ['src/components/Pay.vue', 'src/lib/cart.ts', 'node_modules/vue/index.js'] },
        { title: 'adds to cart', codeReach: ['src/lib/cart.ts'] },
        { title: 'has no reach' },
      ]),
    });
    expect(response.ok()).toBeTruthy();
    projectId = (await response.json()).projectId;

    const reach = await (
      await request.get(`/api/projects/${projectId}/code-reach`, { params: { file: 'lib/cart.ts' } })
    ).json();
    expect(reach.tests.map((t: { title: string; origin: string }) => [t.title, t.origin]).sort()).toEqual([
      ['adds to cart', 'client'],
      ['pays', 'client'],
    ]);
    expect((await request.get(`/api/projects/${projectId}/code-reach`)).status()).toBe(400);
  });

  test('a later run replaces a test’s reach; a run without it keeps it', async ({ request }) => {
    await request.post('/api/test-runs/submit', {
      data: run(5, [{ title: 'pays', codeReach: ['src/components/Pay.vue'] }]),
    });
    await request.post('/api/test-runs/submit', { data: run(10, [{ title: 'pays' }, { title: 'adds to cart' }]) });
    const index = await (await request.get(`/api/projects/${projectId}/code-index`)).json();
    expect(index.files).toEqual(['src/components/Pay.vue', 'src/lib/cart.ts']);
    const byFile = Object.fromEntries(
      index.reach.map((r: { file: number; tests: number[] }) => [
        index.files[r.file],
        r.tests.map((t) => index.tests[t].title),
      ]),
    );
    expect(byFile).toEqual({ 'src/components/Pay.vue': ['pays'], 'src/lib/cart.ts': ['adds to cart'] });
  });
});
