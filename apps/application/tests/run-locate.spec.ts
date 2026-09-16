import { test, expect } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

const FILE = 'tests/locate.spec.ts';
const TITLE = 'locate me & friends';

/**
 * The reporter prints `/test-runs/:id/locate?file=…&title=…&retry=…&browser=…`
 * links the moment a test fails, before the server has assigned execution ids.
 * The route resolves them to the execution page.
 */
test.describe.serial('Run execution locator', () => {
  let runId: number;
  let executions: Array<{ executionId: number; retries: number; status: string }>;

  test('a run with a retried failure provides executions to resolve', async ({ request }) => {
    const submit = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.RUN_LOCATE,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 4000,
        totalTests: 2,
        passedTests: 1,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: TITLE,
            status: 'failed',
            duration: 1200,
            retries: 0,
            location: `${FILE}:5:3`,
            browser: { projectName: 'chromium', browserName: 'chromium' },
            error: 'Error: boom',
          },
          {
            title: TITLE,
            status: 'failed',
            duration: 1100,
            retries: 1,
            location: `${FILE}:5:3`,
            browser: { projectName: 'chromium', browserName: 'chromium' },
            error: 'Error: boom',
          },
          {
            title: 'passes',
            status: 'passed',
            duration: 100,
            retries: 0,
            location: `${FILE}:12:3`,
            browser: { projectName: 'chromium', browserName: 'chromium' },
          },
        ],
      },
    });
    expect(submit.ok()).toBeTruthy();
    ({ runId } = await submit.json());

    const run = (await (await request.get(`/api/test-runs/${runId}`)).json()) as {
      testCases: Array<{ executionId: number; title: string; retries: number; status: string }>;
    };
    executions = run.testCases.filter((c) => c.title === TITLE);
    expect(executions).toHaveLength(2);
  });

  test('redirects to the execution of the requested attempt', async ({ request }) => {
    const params = new URLSearchParams({ file: FILE, title: TITLE, retry: '1', browser: 'chromium' });
    const res = await request.get(`/test-runs/${runId}/locate?${params}`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const wanted = executions.find((e) => e.retries === 1)!;
    expect(res.headers()['location']).toBe(`/test-run-cases/${wanted.executionId}`);
  });

  test('falls back to the latest failing attempt when the retry is unknown', async ({ request }) => {
    const params = new URLSearchParams({ file: FILE, title: TITLE, retry: '7' });
    const res = await request.get(`/test-runs/${runId}/locate?${params}`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const latest = executions.reduce((a, b) => (b.retries > a.retries ? b : a));
    expect(res.headers()['location']).toBe(`/test-run-cases/${latest.executionId}`);
  });

  test('renders a readable 404 page when the test is not in the run', async ({ request }) => {
    const params = new URLSearchParams({ file: FILE, title: 'never ran', retry: '0' });
    const res = await request.get(`/test-runs/${runId}/locate?${params}`, { maxRedirects: 0 });
    expect(res.status()).toBe(404);
    expect(res.headers()['content-type']).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Piwi could not find that test');
    expect(body).toContain(`/test-runs/${runId}`);
  });

  test('renders a readable 404 page for an unknown run', async ({ request }) => {
    const params = new URLSearchParams({ file: FILE, title: TITLE, retry: '0' });
    const res = await request.get(`/test-runs/999999999/locate?${params}`, { maxRedirects: 0 });
    expect(res.status()).toBe(404);
    expect(await res.text()).toContain('does not exist');
  });
});
