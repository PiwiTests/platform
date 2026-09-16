import { describe, test, expect } from 'vitest';
import { buildHealPrTitle, buildHealPrBody, HEAL_PR_MARKER } from '#shared/heal-pr';
import type { HealActionPayload, HealEditPayload } from '#shared/auto-heal';

const edit = (over: Partial<HealEditPayload> = {}): HealEditPayload => ({
  filePath: 'tests/checkout.spec.ts',
  line: 42,
  oldLine: "  await page.getByRole('button', { name: 'Pay' }).click();",
  newLine: "  await page.getByTestId('pay-btn').click();",
  failingLocator: "getByRole('button', { name: 'Pay' })",
  suggestedLocator: "getByTestId('pay-btn')",
  score: 100,
  source: 'prior-run',
  pickedByUser: false,
  clusterId: 7,
  executionId: 1,
  testTitle: 'checkout pays',
  owner: '@checkout-team',
  ...over,
});

const payload = (edits: HealEditPayload[]): HealActionPayload => ({
  repositoryUrl: 'https://github.com/acme/app',
  provider: 'github',
  baseBranch: 'main',
  baseSha: 'abc123',
  branch: 'piwi/heal/9-deadbeef',
  commitMessage: 'test: heal broken locators',
  title: 'test: heal broken locators',
  draft: true,
  verifyCommand: 'npx playwright test "tests/checkout.spec.ts" -g "checkout pays"',
  edits,
});

describe('buildHealPrTitle', () => {
  test('is the configured (conventional-commit) message', () => {
    expect(buildHealPrTitle(payload([edit()]))).toBe('test: heal broken locators');
  });
});

describe('buildHealPrBody', () => {
  test('carries the marker, a per-edit row, owners, clusters and the verify command', () => {
    const body = buildHealPrBody(payload([edit()]), 'https://piwi.example.com');
    expect(body.startsWith(HEAL_PR_MARKER)).toBe(true);
    expect(body).toContain('healed 1 broken locator in 1 file');
    expect(body).toContain('`tests/checkout.spec.ts`');
    expect(body).toContain("getByTestId('pay-btn')");
    expect(body).toContain('last passing run');
    expect(body).toContain('@checkout-team');
    expect(body).toContain('[#7](https://piwi.example.com/failure-clusters/7)');
    expect(body).toContain('npx playwright test "tests/checkout.spec.ts" -g "checkout pays"');
  });

  test('labels a user pick and omits cluster links without a site URL', () => {
    const body = buildHealPrBody(payload([edit({ pickedByUser: true, clusterId: null })]), null);
    expect(body).toContain('your confirmed pick');
    expect(body).not.toContain('failure-clusters');
  });

  test('collapses a long edit list', () => {
    const edits = Array.from({ length: 25 }, (_, i) => edit({ line: i + 1, executionId: i + 1 }));
    const body = buildHealPrBody(payload(edits), null);
    expect(body).toContain('…and 5 more');
  });
});
