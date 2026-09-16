/**
 * LIVE Jira Cloud E2E — the real integration against the maintainer's Atlassian
 * site, run on demand (`npm run app:test:jira:live`) with PIWI_JIRA_* +
 * PIWI_LIVE_JIRA_PROJECT_KEY set. It files a real issue in French, reads it back
 * through the Jira REST API, exercises a policy comment and one transition, and
 * deletes every issue it created (plus any stray `piwi-live-test` issue) so the
 * free-plan site never fills up.
 *
 * The site's Jira locale is French and its issue-type / status names are French —
 * a live check that Piwi addresses issue types and transitions by id, never by an
 * English name. Reads and deletes go by the issue's stable **id**, not its key:
 * a fresh Cloud issue is retrievable by id immediately but by key only after the
 * search index catches up.
 */
import { test, expect } from '@playwright/test';
import { PROJECT } from '#shared/test-project-names';

const BASE = process.env.PIWI_JIRA_BASE_URL!.replace(/\/$/, '');
const EMAIL = process.env.PIWI_JIRA_EMAIL!;
const TOKEN = process.env.PIWI_JIRA_API_TOKEN!;
const PROJECT_KEY = process.env.PIWI_LIVE_JIRA_PROJECT_KEY!;
const LIVE_LABEL = 'piwi-live-test';

const AUTH = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;

/** A raw Jira REST call with the same Basic credentials the server uses. */
async function jira(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: AUTH, 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
  });
}

/** Every ADF text node's string, recursively — for asserting the description. */
function adfText(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const n = node as { text?: string; content?: unknown[] };
  const here = typeof n.text === 'string' ? [n.text] : [];
  const kids = Array.isArray(n.content) ? n.content.flatMap(adfText) : [];
  return [...here, ...kids];
}

/** Delete a Jira issue by id, ignoring a 404 (already gone). */
async function deleteIssue(id: string): Promise<void> {
  await jira(`/rest/api/3/issue/${encodeURIComponent(id)}?deleteSubtasks=true`, { method: 'DELETE' }).catch(() => null);
}

test.describe.serial('Live Jira integration', () => {
  let connectionId = 0;
  let projectId = 0;
  let clusterId = 0;
  let issueType = '';
  let issueId = '';
  let issueKey = '';
  const createdIds: string[] = [];

  test.afterAll(async () => {
    // Delete by id every issue this run created, then sweep any stray labelled
    // issue by id (a key that never indexed is unreachable by key).
    for (const id of createdIds) await deleteIssue(id);
    const search = await jira(`/rest/api/3/search/jql`, {
      method: 'POST',
      body: JSON.stringify({ jql: `labels = "${LIVE_LABEL}"`, maxResults: 50, fields: ['id'] }),
    });
    if (search.ok) {
      const { issues } = (await search.json()) as { issues?: { id: string }[] };
      for (const issue of issues ?? []) await deleteIssue(issue.id);
    }
  });

  test('the env-managed Jira connection is live', async ({ request }) => {
    // A freshly built dev server compiles API routes on first hit and serves the
    // SPA HTML until then, so poll until the status endpoint answers with JSON.
    let trackers: { id: number }[] = [];
    await expect
      .poll(
        async () => {
          try {
            const res = await request.get('/api/integrations/status');
            trackers = JSON.parse(await res.text()).trackers ?? [];
            return trackers.length;
          } catch {
            // The dev server can reset the connection while it is still booting.
            return 0;
          }
        },
        { timeout: 90_000, intervals: [1500] },
      )
      .toBeGreaterThan(0);
    connectionId = trackers[0]!.id;

    // The issue type is chosen by id from the live project, never by name.
    const types = await request.get(
      `/api/integrations/connections/${connectionId}/projects/${encodeURIComponent(PROJECT_KEY)}/issue-types`,
    );
    const { issueTypes } = await types.json();
    expect(issueTypes.length).toBeGreaterThan(0);
    issueType = issueTypes[0].id;
    expect(issueType).toMatch(/^\d+$/);
  });

  test('a failing run creates a cluster to file against', async ({ request }) => {
    const submit = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.JIRA_LIVE,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 1,
        passedTests: 0,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'checks out',
            status: 'failed',
            duration: 500,
            location: 'checkout.spec.ts:3:1',
            error: 'TimeoutError: locator.click: Timeout 5000ms exceeded.',
          },
        ],
      },
    });
    const { runId } = await submit.json();
    const runDetail = await request.get(`/api/test-runs/${runId}`);
    const cases = (await runDetail.json()).testCases as { failureClusterId?: number }[];
    clusterId = cases.find((c) => c.failureClusterId)!.failureClusterId!;
    projectId = (await (await request.get(`/api/failure-clusters/${clusterId}`)).json()).project.id;
    expect(clusterId).toBeGreaterThan(0);
    // Let the run's background clustering / fix-verification drain before the
    // create-issue transaction, so they do not contend on the fresh WAL DB.
    await new Promise((r) => setTimeout(r, 3000));
  });

  /** The Jira id + key Piwi recorded for the cluster's created issue. */
  async function clusterIssue(request: import('@playwright/test').APIRequestContext) {
    const cluster = await (await request.get(`/api/failure-clusters/${clusterId}`)).json();
    const link = (cluster.links as { provider: string; externalId: string | null; key: string | null }[]).find(
      (l) => l.provider === 'jira',
    );
    return { id: link?.externalId ?? '', key: link?.key ?? '' };
  }

  test('a French binding files a French issue read back through the REST API', async ({ request }) => {
    await request.put(`/api/projects/${projectId}/integrations`, {
      data: { connectionId, projectKey: PROJECT_KEY, issueType, labels: [LIVE_LABEL], locale: 'fr' },
    });

    const body = {
      entityType: 'failure_cluster',
      entityId: clusterId,
      connectionId,
      title: 'Piwi live — checkout timeout',
      projectKey: PROJECT_KEY,
      issueType,
      labels: [LIVE_LABEL],
      locale: 'fr',
    };
    // The dedupe key makes a re-POST safe, so retry through the fresh DB's
    // boot-time migration/backfill window (a transient "Failed query" lock).
    let created: { status?: string; key?: string; error?: string } = {};
    for (let attempt = 0; attempt < 12; attempt++) {
      created = await (await request.post('/api/integrations/issues', { data: body })).json();
      if (created.status === 'done') break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    expect(created.status, JSON.stringify(created)).toBe('done');
    expect(created.key).toBeTruthy();

    ({ id: issueId, key: issueKey } = await clusterIssue(request));
    expect(issueId).toMatch(/^\d+$/);
    createdIds.push(issueId);

    // Read it back straight from Jira, by id (immediate), with the same credentials.
    const read = await jira(`/rest/api/3/issue/${issueId}?fields=summary,description,labels`);
    expect(read.ok, `readback ${read.status}`).toBeTruthy();
    const issue = await read.json();
    const texts = adfText(issue.fields.description).join('\n');
    // French headings from the catalog.
    expect(texts).toContain("Ce qui s'est passé");
    expect(texts).toContain('Preuves');
    // The trailer and labels the ticket carries back.
    expect(texts).toContain(`Piwi-Cluster: ${clusterId}`);
    expect(issue.fields.labels).toContain('piwi');
    expect(issue.fields.labels).toContain(LIVE_LABEL);
    // Data is never translated — the locator is quoted verbatim.
    expect(texts).toContain('locator.click');
  });

  test('a verified fix comments on and transitions the live issue', async ({ request }) => {
    // Pick a real transition by id (the site is French; we never name it).
    const transRes = await jira(`/rest/api/3/issue/${issueId}/transitions`);
    const { transitions } = (await transRes.json()) as {
      transitions: { id: string; to?: { statusCategory?: { key?: string } } }[];
    };
    const target = transitions.find((t) => t.to?.statusCategory?.key === 'done') ?? transitions[0]!;

    await request.put(`/api/projects/${projectId}/integrations`, {
      data: {
        connectionId,
        projectKey: PROJECT_KEY,
        issueType,
        labels: [LIVE_LABEL],
        locale: 'fr',
        policies: { commentOnFix: true, transitionOnFix: true, fixTransitionId: target.id },
      },
    });

    // A passing run of the affected test records the fix, firing the policies.
    await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.JIRA_LIVE,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [{ title: 'checks out', status: 'passed', duration: 300, location: 'checkout.spec.ts:3:1' }],
      },
    });

    // The fix comment lands (in French).
    await expect
      .poll(
        async () => {
          const res = await jira(`/rest/api/3/issue/${issueId}/comment`);
          if (!res.ok) return 0;
          const { comments } = (await res.json()) as { comments: { body: unknown }[] };
          return comments.filter((c) => adfText(c.body).join(' ').includes('Correctif')).length;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    // The transition is applied.
    await expect
      .poll(
        async () => {
          const res = await jira(`/rest/api/3/issue/${issueId}?fields=status`);
          const issue = await res.json();
          return issue.fields?.status?.statusCategory?.key ?? '';
        },
        { timeout: 30_000 },
      )
      .toBe(target.to?.statusCategory?.key ?? 'done');

    console.log(`[live-jira] created and will delete issue ${issueKey} (id ${issueId})`);
  });
});
