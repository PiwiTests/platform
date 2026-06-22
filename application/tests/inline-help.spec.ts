import { test, expect, type Page } from './fixtures';
import { PROJECT } from '../shared/test-project-names';
import { DOCS_BASE_URL } from '../shared/docs';

/**
 * Verifies the inline-help affordance (`HelpHint`): the trigger is an
 * accessible button, activating it reveals the explanatory popover, and the
 * "Learn more" link points at the right docs anchor.
 *
 * NOTE: in dev mode Vite compiles pages on-demand, so the SSR markup is
 * interactive only once the client bundle hydrates (a few seconds on first
 * load). `openHint` polls the click until the popover actually opens instead of
 * assuming the page is hydrated.
 */
async function openHint(page: Page, name: string) {
  const trigger = page.getByRole('button', { name });
  await trigger.waitFor({ state: 'visible', timeout: 15000 });
  await expect(async () => {
    await trigger.click();
    expect(await trigger.getAttribute('aria-expanded')).toBe('true');
  }).toPass({ timeout: 20000, intervals: [250] });
  return trigger;
}

test.describe('Inline help (HelpHint)', () => {
  test('MCP page help icon opens a popover with a docs link', async ({ page }) => {
    await page.goto('/mcp');

    await openHint(page, 'Help: What it provides');

    // Popover explanation is shown.
    await expect(page.getByText('The tools this MCP server exposes')).toBeVisible();

    // "Learn more" resolves through docsUrl() to the verified anchor.
    const learnMore = page.getByRole('link', { name: /Learn more/ });
    await expect(learnMore).toHaveAttribute('href', `${DOCS_BASE_URL}/mcp#what-it-provides`);
    await expect(learnMore).toHaveAttribute('target', '_blank');
  });

  test('project detail performance hint links to the flaky-tests docs', async ({ page, request }) => {
    const res = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.INLINE_HELP,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 5000,
        totalTests: 2,
        passedTests: 2,
        failedTests: 0,
        skippedTests: 0,
        testCases: [
          { title: 'a', status: 'passed', duration: 1000, location: 'tests/a.spec.ts:1:1' },
          { title: 'b', status: 'passed', duration: 1500, location: 'tests/b.spec.ts:1:1' },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const { projectId } = await res.json();

    await page.goto(`/projects/${projectId}?tab=performance`);

    await openHint(page, 'Help: Performance');

    await expect(page.getByText('Duration trends for the suite')).toBeVisible();
    const learnMore = page.getByRole('link', { name: /Learn more/ });
    await expect(learnMore).toHaveAttribute('href', `${DOCS_BASE_URL}/flaky-tests#performance`);
  });
});
