import { test, expect } from './fixtures';
import { PROJECT } from '#shared/test-project-names';

const CASE_TITLE = 'share link case renders';

test.describe.serial('Share links', () => {
  let executionId: number;
  let clusterId: number | undefined;
  let executionShareUrl: string;
  let executionLinkId: number;

  test('a failing run provides an execution and a cluster to share', async ({ request }) => {
    const submit = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.SHARE_LINKS,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 4000,
        totalTests: 1,
        passedTests: 0,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: CASE_TITLE,
            status: 'failed',
            duration: 1200,
            location: 'tests/share.spec.ts:5:3',
            error:
              "TimeoutError: locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for getByTestId('share-target')",
          },
        ],
      },
    });
    expect(submit.ok()).toBeTruthy();
    const { runId } = await submit.json();

    const run = (await (await request.get(`/api/test-runs/${runId}`)).json()) as {
      testCases: Array<{ executionId: number; status: string; failureClusterId?: number }>;
    };
    const failed = run.testCases.find((c) => c.status === 'failed');
    expect(failed).toBeDefined();
    executionId = failed!.executionId;
    clusterId = failed!.failureClusterId;
  });

  test('the settings probe reports the suite-enabled feature', async ({ request }) => {
    const res = await request.get('/api/share-links/settings');
    expect(res.ok()).toBeTruthy();
    const settings = await res.json();
    expect(settings.enabled).toBe(true);
    expect(settings.maxTtlDays).toBe(30);
  });

  test('minting returns the full token once, capped to the TTL limit', async ({ request }) => {
    const res = await request.post(`/api/test-run-cases/${executionId}/share-links`, { data: { ttlDays: 365 } });
    expect(res.ok()).toBeTruthy();
    const minted = await res.json();
    expect(minted.token).toMatch(/^psl_[0-9a-f]{64}$/);
    expect(minted.url).toContain(`/share/${minted.token}`);
    expect(minted.link.tokenPrefix).toBe(minted.token.slice(4, 12));
    // 365 days is over the cap — the expiry lands at the 30-day maximum.
    const days = (new Date(minted.link.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeLessThanOrEqual(30);
    expect(days).toBeGreaterThan(29);
    executionShareUrl = minted.url;
    executionLinkId = minted.link.id;
  });

  test('the share URL renders the investigation for an anonymous viewer', async ({ request }) => {
    const res = await request.get(executionShareUrl);
    expect(res.status()).toBe(200);
    const headers = res.headers();
    expect(headers['content-type']).toContain('text/html');
    expect(headers['content-security-policy']).toContain('sandbox');
    expect(headers['x-robots-tag']).toContain('noindex');
    expect(headers['cache-control']).toContain('no-store');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(await res.text()).toContain(CASE_TITLE);
  });

  test('the listing shows the view without ever returning the token', async ({ request }) => {
    const res = await request.get(`/api/test-run-cases/${executionId}/share-links`);
    expect(res.ok()).toBeTruthy();
    const { items: shareLinks } = await res.json();
    expect(shareLinks).toHaveLength(1);
    expect(shareLinks[0].viewCount).toBe(1);
    expect(shareLinks[0].tokenPrefix).toHaveLength(8);
    expect(shareLinks[0]).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(shareLinks)).not.toContain(executionShareUrl.split('/share/psl_')[1]);
  });

  test('a cluster share link renders too', async ({ request }) => {
    test.skip(!clusterId, 'failure clustering did not assign a cluster');
    const minted = await (await request.post(`/api/failure-clusters/${clusterId}/share-links`, { data: {} })).json();
    const res = await request.get(minted.url);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain(CASE_TITLE);
  });

  test('a revoked link answers 404 with a human explanation', async ({ request }) => {
    const revoke = await request.delete(`/api/share-links/${executionLinkId}`);
    expect(revoke.ok()).toBeTruthy();
    const res = await request.get(executionShareUrl);
    expect(res.status()).toBe(404);
    expect(await res.text()).toContain('no longer available');
  });

  test('unknown and malformed tokens are a plain 404', async ({ request }) => {
    const unknown = await request.get(`/share/psl_${'0'.repeat(64)}`);
    expect(unknown.status()).toBe(404);
    expect(await unknown.text()).not.toContain('no longer available');
    const malformed = await request.get('/share/not-a-token');
    expect(malformed.status()).toBe(404);
  });
});
