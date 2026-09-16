import { describe, test, expect } from 'vitest';
import { applyHealAction } from '../../server/utils/heal/dispatch';
import type { ScmProvider, ScmFileContent, ScmFileEdit, ScmPullRequest } from '../../server/utils/scm/ScmProvider';
import type { HealActionPayload } from '#shared/auto-heal';

const FILE =
  "import { test } from '@playwright/test';\n\ntest('pay', async ({ page }) => {\n  await page.getByRole('button', { name: 'Pay' }).click();\n});\n";
const OLD = "  await page.getByRole('button', { name: 'Pay' }).click();";
const NEW = "  await page.getByTestId('pay-btn').click();";

interface FakeConfig {
  branchHeads?: Record<string, string | null>;
  existingPr?: ScmPullRequest | null;
  files?: Record<string, ScmFileContent | null>;
}

function fakeProvider(cfg: FakeConfig) {
  const calls = {
    createBranch: [] as Array<{ name: string; fromSha: string }>,
    commitFiles: [] as Array<{ branch: string; message: string; files: ScmFileEdit[] }>,
    createPullRequest: 0,
  };
  const provider = {
    provider: 'github' as const,
    async getBranchHead(branch: string) {
      return cfg.branchHeads?.[branch] ?? null;
    },
    async findPullRequestForBranch() {
      return cfg.existingPr ?? null;
    },
    async fetchFileAtRef(path: string) {
      return cfg.files?.[path] ?? null;
    },
    async createBranch(name: string, fromSha: string) {
      calls.createBranch.push({ name, fromSha });
    },
    async commitFiles(branch: string, message: string, files: ScmFileEdit[]) {
      calls.commitFiles.push({ branch, message, files });
      return 'newcommitsha';
    },
    async createPullRequest(): Promise<ScmPullRequest> {
      calls.createPullRequest++;
      return { number: 123, url: 'https://github.com/acme/app/pull/123' };
    },
  };
  return { provider: provider as unknown as ScmProvider, calls };
}

function payload(over: Partial<HealActionPayload> = {}): HealActionPayload {
  return {
    repositoryUrl: 'https://github.com/acme/app',
    provider: 'github',
    baseBranch: 'main',
    baseSha: 'basesha',
    branch: 'piwi/heal/9-deadbeef',
    commitMessage: 'test: heal broken locators',
    title: 'test: heal broken locators',
    draft: true,
    verifyCommand: 'npx playwright test',
    edits: [
      {
        filePath: 'tests/a.spec.ts',
        line: 4,
        oldLine: OLD,
        newLine: NEW,
        failingLocator: "getByRole('button', { name: 'Pay' })",
        suggestedLocator: "getByTestId('pay-btn')",
        score: 100,
        source: 'prior-run',
        pickedByUser: false,
        clusterId: 1,
        executionId: 1,
        testTitle: 'pay',
        owner: null,
      },
    ],
    ...over,
  };
}

const file = (content: string): ScmFileContent => ({ path: 'tests/a.spec.ts', content, truncated: false });
const action = (p: HealActionPayload) => ({ dedupeKey: 'heal:v1:1:deadbeef', payload: p });

describe('applyHealAction', () => {
  test('happy path — creates branch, commits the rewrite, opens the PR', async () => {
    const { provider, calls } = fakeProvider({
      branchHeads: { main: 'basesha', 'piwi/heal/9-deadbeef': null },
      files: { 'tests/a.spec.ts': file(FILE) },
    });
    const out = await applyHealAction(provider, action(payload()), 'https://piwi.example.com');

    expect(out.status).toBe('opened');
    if (out.status === 'opened') {
      expect(out.result).toMatchObject({ prNumber: 123, commitSha: 'newcommitsha', branch: 'piwi/heal/9-deadbeef' });
    }
    expect(calls.createBranch).toEqual([{ name: 'piwi/heal/9-deadbeef', fromSha: 'basesha' }]);
    expect(calls.commitFiles).toHaveLength(1);
    expect(calls.commitFiles[0]!.files[0]!.content).toContain(NEW);
    expect(calls.commitFiles[0]!.message).toContain('Piwi-Heal: heal:v1:1:deadbeef');
    expect(calls.createPullRequest).toBe(1);
  });

  test('adopts an existing PR instead of opening a duplicate', async () => {
    const { provider, calls } = fakeProvider({
      branchHeads: { main: 'basesha', 'piwi/heal/9-deadbeef': 'branchsha' },
      existingPr: { number: 55, url: 'https://github.com/acme/app/pull/55' },
      files: { 'tests/a.spec.ts': file(FILE.replace(OLD, NEW)) }, // already healed on the branch
    });
    const out = await applyHealAction(provider, action(payload()), null);

    expect(out.status).toBe('opened');
    if (out.status === 'opened') expect(out.result.prNumber).toBe(55);
    expect(calls.createPullRequest).toBe(0);
    expect(calls.commitFiles).toHaveLength(0);
  });

  test('skips when the target line has drifted (stale)', async () => {
    const { provider, calls } = fakeProvider({
      branchHeads: { main: 'basesha', 'piwi/heal/9-deadbeef': null },
      files: { 'tests/a.spec.ts': file("test('pay', async () => { await page.click(); });\n") },
    });
    const out = await applyHealAction(provider, action(payload()), null);

    expect(out.status).toBe('skipped');
    if (out.status === 'skipped') expect(out.reason).toContain('stale');
    expect(calls.createBranch).toHaveLength(0);
    expect(calls.commitFiles).toHaveLength(0);
    expect(calls.createPullRequest).toBe(0);
  });

  test('resumes after a crash between commit and PR (branch has work, no PR yet)', async () => {
    const { provider, calls } = fakeProvider({
      // Branch exists and has diverged from base; the fix already landed on it.
      branchHeads: { main: 'basesha', 'piwi/heal/9-deadbeef': 'branchsha' },
      existingPr: null,
      files: { 'tests/a.spec.ts': file(FILE.replace(OLD, NEW)) },
    });
    const out = await applyHealAction(provider, action(payload()), null);

    expect(out.status).toBe('opened');
    expect(calls.commitFiles).toHaveLength(0); // nothing new to commit
    expect(calls.createPullRequest).toBe(1); // but the PR still gets opened
  });

  test('drops a truncated file rather than committing a partial overwrite', async () => {
    const { provider, calls } = fakeProvider({
      branchHeads: { main: 'basesha', 'piwi/heal/9-deadbeef': null },
      files: { 'tests/a.spec.ts': { path: 'tests/a.spec.ts', content: FILE, truncated: true } },
    });
    const out = await applyHealAction(provider, action(payload()), null);

    expect(out.status).toBe('skipped');
    expect(calls.commitFiles).toHaveLength(0);
  });

  test('throws when the base branch is missing (recorded + retried by the sweeper)', async () => {
    const { provider } = fakeProvider({ branchHeads: { main: null } });
    await expect(applyHealAction(provider, action(payload()), null)).rejects.toThrow(/base branch/);
  });
});
