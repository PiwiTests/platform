/**
 * The fields Jira requires, against a mock Jira Cloud whose Bug type requires a
 * Severity and a Team, and whose Resolve transition requires a Resolution: the
 * fields endpoint reads the create screen, a create that leaves one empty is
 * refused before Jira is called, the project settings keep a default, the create
 * dialog asks for the rest and files the issue with both, a refusal Jira names
 * is final and creating again replaces it, and the MCP tool names what is
 * missing and takes loosely typed values. Then the fix transition: the settings
 * check it against an open issue and keep its resolution, a verified fix moves
 * the issue with it, and a move with no resolution fails for good without
 * calling Jira. Nothing calls out.
 */
import { test, expect } from './fixtures';
import * as http from 'http';
import * as net from 'net';
import { PROJECT } from '#shared/test-project-names';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

/**
 * Fingerprint-safe letters for this attempt's errors, so a retried serial group
 * lands on fresh failure clusters instead of the issues the last attempt filed.
 * Digits and a–f are left out: the fingerprint masks numbers and hex runs.
 */
function uniqueFailureTag(): string {
  const alphabet = 'ghijklmnopqrstuvwxyz';
  let tag = '';
  for (let i = 0; i < 12; i++) tag += alphabet[Math.floor(Math.random() * alphabet.length)];
  return tag;
}

const SEVERITY = 'customfield_10050';
const TEAM = 'customfield_10001';
const SQUAD = 'customfield_10060';

/** The Bug type's create screen: Severity and Team are required, Components and Squad are not. */
const BUG_SCREEN = [
  { fieldId: 'project', name: 'Project', required: true, schema: { type: 'project', system: 'project' } },
  { fieldId: 'issuetype', name: 'Issue type', required: true, schema: { type: 'issuetype', system: 'issuetype' } },
  { fieldId: 'summary', name: 'Summary', required: true, schema: { type: 'string', system: 'summary' } },
  {
    fieldId: SEVERITY,
    name: 'Severity',
    required: true,
    schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' },
    allowedValues: [
      { id: '10100', value: 'Critical' },
      { id: '10101', value: 'Major' },
      { id: '10102', value: 'Minor' },
    ],
  },
  {
    fieldId: TEAM,
    name: 'Team',
    required: true,
    schema: { type: 'team', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team' },
  },
  {
    fieldId: 'components',
    name: 'Components',
    required: false,
    schema: { type: 'array', items: 'component', system: 'components' },
    allowedValues: [{ id: '10200', name: 'Checkout' }],
  },
  { fieldId: SQUAD, name: 'Squad', required: false, schema: { type: 'string' } },
];

interface MockJira {
  server: http.Server;
  /** The fields of every issue created, in order. */
  creates: Record<string, unknown>[];
  /** A workflow validator the create screen does not show: Squad must be set. */
  requireSquad: boolean;
  /** Every transition made, in order. */
  moves: { key: string; id: string; fields: Record<string, unknown> | null }[];
}

/** An open issue resolves to Done through a screen requiring a Resolution; a done one reopens. */
const OPEN_TRANSITIONS = [
  {
    id: '21',
    name: 'Start progress',
    hasScreen: false,
    to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
    fields: {},
  },
  {
    id: '31',
    name: 'Resolve',
    hasScreen: true,
    to: { name: 'Done', statusCategory: { key: 'done' } },
    fields: {
      resolution: {
        key: 'resolution',
        name: 'Resolution',
        required: true,
        hasDefaultValue: false,
        schema: { type: 'resolution', system: 'resolution' },
        allowedValues: [
          { id: '1', name: 'Fixed' },
          { id: '2', name: "Won't fix" },
        ],
      },
    },
  },
];
const DONE_TRANSITIONS = [
  { id: '11', name: 'Reopen', hasScreen: false, to: { name: 'To Do', statusCategory: { key: 'new' } }, fields: {} },
];

/** A mock Jira Cloud REST v3 that checks the Bug type's required fields the way Jira does. */
function startMockJira(port: number): MockJira {
  const state: MockJira = { server: null as unknown as http.Server, creates: [], requireSquad: false, moves: [] };
  let counter = 300;
  /** Issues created, newest last, with whether each is done. */
  const issues: { key: string; done: boolean }[] = [];
  const readBody = (req: http.IncomingMessage, cb: (raw: string) => void) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => cb(raw));
  };

  state.server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    const send = (body: unknown, status = 200) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    const path = url.pathname;

    if (path === '/rest/api/3/myself') return send({ accountId: 'acct-1', displayName: 'Mock Jira User' });
    if (path === '/rest/api/3/project/search') return send({ values: [{ id: '1', key: 'PROJ', name: 'Project' }] });
    if (path === '/rest/api/3/project/PROJ')
      return send({ id: '1', key: 'PROJ', issueTypes: [{ id: '10004', name: 'Bug' }] });
    if (path === '/rest/api/3/issue/createmeta/PROJ/issuetypes/10004') {
      return send({ startAt: 0, maxResults: 100, total: BUG_SCREEN.length, fields: BUG_SCREEN });
    }
    if (path === '/rest/api/3/user/assignable/search') return send([{ accountId: 'acct-2', displayName: 'Assignee' }]);
    if (req.method === 'POST' && path === '/rest/api/3/search/jql') {
      // The binding's sample-issue lookup names a status category; the create's dedupe search does not.
      return readBody(req, (raw) => {
        const jql = (JSON.parse(raw || '{}') as { jql?: string }).jql ?? '';
        const category = /statusCategory (!?=) Done/.exec(jql);
        const hit = category ? [...issues].reverse().find((i) => i.done === (category[1] === '=')) : undefined;
        if (!hit) return send({ issues: [] });
        const status = hit.done
          ? { name: 'Done', statusCategory: { key: 'done' } }
          : { name: 'To Do', statusCategory: { key: 'new' } };
        send({ issues: [{ id: '1', key: hit.key, fields: { summary: 'Filed by Piwi', status } }] });
      });
    }

    const transitions = /^\/rest\/api\/3\/issue\/(PROJ-\d+)\/transitions$/.exec(path);
    if (transitions) {
      const issue = issues.find((i) => i.key === transitions[1]);
      if (!issue) return send({ errorMessages: ['Issue does not exist'] }, 404);
      if (req.method === 'GET') return send({ transitions: issue.done ? DONE_TRANSITIONS : OPEN_TRANSITIONS });
      return readBody(req, (raw) => {
        const body = JSON.parse(raw || '{}') as { transition?: { id?: string }; fields?: Record<string, unknown> };
        const id = String(body.transition?.id);
        if (id === '31' && !body.fields?.resolution) {
          return send({ errorMessages: [], errors: { resolution: 'Resolution is required.' } }, 400);
        }
        state.moves.push({ key: issue.key, id, fields: body.fields ?? null });
        issue.done = id === '31';
        res.statusCode = 204;
        res.end();
      });
    }

    if (req.method === 'POST' && path === '/rest/api/3/issue') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const fields = (JSON.parse(raw || '{}') as { fields?: Record<string, unknown> }).fields ?? {};
        const errors: Record<string, string> = {};
        if (!fields[SEVERITY]) errors[SEVERITY] = 'Severity is required.';
        if (!fields[TEAM]) errors[TEAM] = 'Team is required.';
        if (state.requireSquad && !fields[SQUAD]) errors[SQUAD] = 'Squad is required.';
        if (Object.keys(errors).length) return send({ errorMessages: [], errors }, 400);
        state.creates.push(fields);
        counter++;
        issues.push({ key: `PROJ-${counter}`, done: false });
        send({ id: String(10000 + counter), key: `PROJ-${counter}` }, 201);
      });
      return;
    }

    const issue = /^\/rest\/api\/3\/issue\/(PROJ-\d+)$/.exec(path);
    if (issue && req.method === 'GET') {
      const done = issues.find((i) => i.key === issue[1])?.done ?? false;
      return send({
        id: String(10000 + Number(issue[1]!.split('-')[1])),
        key: issue[1],
        fields: {
          summary: 'Filed by Piwi',
          status: done
            ? { name: 'Done', statusCategory: { key: 'done' } }
            : { name: 'To Do', statusCategory: { key: 'new' } },
        },
      });
    }

    send({ errorMessages: ['Not found'] }, 404);
  });
  state.server.listen(port, '127.0.0.1');
  return state;
}

/** The failing tests the suite seeds, one cluster each. */
const SEEDED_TESTS = ['refused', 'dialog', 'validator', 'agent'] as const;
type SeededTest = (typeof SEEDED_TESTS)[number];

function locationOf(title: SeededTest): string {
  return `checkout.spec.ts:${SEEDED_TESTS.indexOf(title) + 3}:1`;
}

test.describe.serial('Integrations — the fields Jira requires', () => {
  let mock: MockJira;
  let connectionId = 0;
  let projectId = 0;
  /** One failure cluster per test title, so each create starts from nothing. */
  const clusters: Record<string, number> = {};

  function createBody(entityId: number, fields?: Record<string, { value: unknown; label: string }>) {
    return {
      entityType: 'failure_cluster',
      entityId,
      connectionId,
      title: 'Checkout breaks',
      projectKey: 'PROJ',
      issueType: '10004',
      ...(fields ? { fields } : {}),
    };
  }

  test.beforeAll(async ({ request }) => {
    const port = await getFreePort();
    mock = startMockJira(port);
    const tag = uniqueFailureTag();

    const created = await request.post('/api/integrations/connections', {
      data: {
        provider: 'jira',
        name: 'Mock Jira (required fields)',
        baseUrl: `http://127.0.0.1:${port}`,
        credentials: { email: 'ci@piwi.dev', apiToken: 'mock-token' },
      },
    });
    connectionId = (await created.json()).connection.id;

    // Four distinct failures → four clusters to file against.
    const failures: Record<SeededTest, string> = {
      refused: `TimeoutError: locator.click: Timeout 5000ms exceeded. [${tag}]`,
      dialog: `Error: expect(locator).toBeVisible() failed [${tag}]`,
      validator: `TypeError: Cannot read properties of undefined (reading 'total') [${tag}]`,
      agent: `Error: page.goto: net::ERR_CONNECTION_REFUSED [${tag}]`,
    };
    const submit = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.INTEGRATIONS_REQUIRED_FIELDS,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: 4,
        passedTests: 0,
        failedTests: 4,
        skippedTests: 0,
        testCases: SEEDED_TESTS.map((title) => ({
          title,
          status: 'failed',
          duration: 500,
          location: locationOf(title),
          error: failures[title],
        })),
      },
    });
    const { runId } = await submit.json();
    const cases = (await (await request.get(`/api/test-runs/${runId}`)).json()).testCases as {
      title: string;
      failureClusterId?: number;
    }[];
    for (const c of cases) if (c.failureClusterId) clusters[c.title] = c.failureClusterId;
    expect(Object.keys(clusters).sort()).toEqual([...SEEDED_TESTS].sort());
    projectId = (await (await request.get(`/api/failure-clusters/${clusters.refused}`)).json()).project.id;

    const bound = await request.put(`/api/projects/${projectId}/integrations`, {
      data: { connectionId, projectKey: 'PROJ', issueType: '10004' },
    });
    expect(bound.ok()).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    if (projectId) await request.put(`/api/projects/${projectId}/integrations`, { data: { connectionId: null } });
    if (connectionId) await request.delete(`/api/integrations/connections/${connectionId}`);
    await new Promise<void>((resolve) => mock.server.close(() => resolve()));
  });

  test("the fields endpoint reads the issue type's create screen, by id or name", async ({ request }) => {
    const res = await request.get(`/api/integrations/connections/${connectionId}/projects/PROJ/issue-types/Bug/fields`);
    expect(res.ok()).toBe(true);
    const { fields } = (await res.json()) as {
      fields: { id: string; required: boolean; kind: string; options: { label: string }[] | null; typeName: string }[];
    };
    const severity = fields.find((f) => f.id === SEVERITY);
    expect(severity).toMatchObject({ required: true, kind: 'option' });
    expect(severity?.options?.map((o) => o.label)).toEqual(['Critical', 'Major', 'Minor']);
    expect(fields.find((f) => f.id === TEAM)).toMatchObject({
      required: true,
      kind: 'raw',
      typeName: 'atlassian-team',
    });
  });

  test('a create that leaves a required field empty is refused before Jira is called', async ({ request }) => {
    const res = await request.post('/api/integrations/issues', { data: createBody(clusters.refused!) });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'failed', actionId: null });
    expect(body.missingFields.map((f: { name: string }) => f.name)).toEqual(['Severity', 'Team']);
    expect(body.error).toMatch(/^Jira requires Severity and Team for this issue type/);
    expect(mock.creates).toHaveLength(0);
  });

  test('the project settings keep a default for a required field', async ({ page, request }) => {
    await page.goto(`/projects/${projectId}?tab=settings`);
    const block = page.locator('[data-shot="binding-jira-fields"]');
    // The section loads after the page hydrates, then reads the screen from Jira.
    await expect(block.getByText('Jira requires these fields for this issue type')).toBeVisible({ timeout: 30_000 });

    await block.locator(`[data-field-id="${SEVERITY}"] button`).first().click();
    await page.getByRole('option', { name: 'Major' }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
    await page.locator('[data-shot="project-integration-binding"]').getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(async () => {
        const binding = await (await request.get(`/api/projects/${projectId}/integrations`)).json();
        return binding.fieldDefaults?.[SEVERITY] ?? null;
      })
      .toEqual({ value: { id: '10101' }, label: 'Major' });
  });

  test('the create dialog asks for what is still required and files the issue with it', async ({ page }) => {
    await page.goto(`/failure-clusters/${clusters.dialog}`);
    const open = page.locator('[data-shot="cluster-create-issue"]').first();
    await expect(open).toBeVisible({ timeout: 30_000 });
    await open.click();
    const dialog = page.getByRole('dialog');
    const asked = dialog.locator('[data-shot="create-issue-fields"]');
    await expect(asked).toBeVisible({ timeout: 15_000 });

    // Severity comes from the project default; Team is still empty.
    await expect(asked.locator(`[data-field-id="${SEVERITY}"]`)).toContainText('Major');
    await expect(dialog.getByTestId('create-issue-missing')).toHaveText('Jira still needs Team.');
    const create = dialog.getByRole('button', { name: 'Create', exact: true });
    await expect(create).toBeDisabled();

    await asked.locator(`[data-field-id="${TEAM}"] input`).fill('team-checkout');
    await expect(dialog.getByTestId('create-issue-missing')).toBeHidden();
    await create.click();
    await expect(page.getByText(/PROJ-\d+ created/).first()).toBeVisible();

    expect(mock.creates.at(-1)).toMatchObject({ [SEVERITY]: { id: '10101' }, [TEAM]: 'team-checkout' });
  });

  test('a refusal Jira names is final, and creating again replaces it', async ({ request }) => {
    mock.requireSquad = true;
    try {
      const team = { [TEAM]: { value: 'team-checkout', label: 'team-checkout' } };
      const refused = await (
        await request.post('/api/integrations/issues', { data: createBody(clusters.validator!, team) })
      ).json();
      expect(refused.status).toBe('failed');
      expect(refused.fieldErrors).toEqual([{ id: SQUAD, name: 'Squad', message: 'Squad is required.' }]);

      // Failed for good rather than queued for a retry that would be refused the same way.
      const { actions } = await (await request.get(`/api/integrations/actions?projectId=${projectId}`)).json();
      const action = (actions as { id: number; entityId: number; status: string }[]).find(
        (a) => a.entityId === clusters.validator,
      );
      expect(action?.status).toBe('failed');

      const fixed = await (
        await request.post('/api/integrations/issues', {
          data: createBody(clusters.validator!, { ...team, [SQUAD]: { value: 'Payments', label: 'Payments' } }),
        })
      ).json();
      expect(fixed.status).toBe('done');
      expect(fixed.actionId).toBe(action?.id);
      expect(mock.creates.at(-1)).toMatchObject({ [SQUAD]: 'Payments' });
    } finally {
      mock.requireSquad = false;
    }
  });

  test('MCP create_issue names what is missing and takes loosely typed values', async ({ request }) => {
    async function callCreate(fields?: Record<string, unknown>) {
      const res = await request.post('/mcp', {
        data: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'create_issue',
            arguments: { entityType: 'failure_cluster', entityId: clusters.agent, ...(fields ? { fields } : {}) },
          },
        },
      });
      expect(res.ok()).toBe(true);
      return (await res.json()).result as { isError?: boolean; content: { text: string }[] };
    }

    const refused = await callCreate();
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain(`${TEAM} (Team) takes Jira's API value (type atlassian-team)`);

    // A listed value by its name overrides the project default.
    const filed = await callCreate({ [TEAM]: 'team-agent', [SEVERITY]: 'critical' });
    expect(filed.isError).toBeFalsy();
    expect(JSON.parse(filed.content[0]!.text).key).toMatch(/^PROJ-\d+$/);
    expect(mock.creates.at(-1)).toMatchObject({ [SEVERITY]: { id: '10100' }, [TEAM]: 'team-agent' });
  });

  /** A run in which one seeded test passes: its cluster's fix is verified, firing the fix policies. */
  async function passTest(request: import('@playwright/test').APIRequestContext, title: SeededTest) {
    const res = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.INTEGRATIONS_REQUIRED_FIELDS,
        status: 'passed',
        startTime: new Date().toISOString(),
        duration: 500,
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
        skippedTests: 0,
        testCases: [{ title, status: 'passed', duration: 300, location: locationOf(title) }],
      },
    });
    expect(res.ok()).toBe(true);
  }

  test('the project settings check the fix transition against an open issue and keep its resolution', async ({
    page,
    request,
  }) => {
    await page.goto(`/projects/${projectId}?tab=settings`);
    const binding = page.locator('[data-shot="project-integration-binding"]');
    await expect(binding.getByText('Keep the ticket honest')).toBeVisible({ timeout: 30_000 });
    await binding.getByRole('switch', { name: 'Transition on fix' }).click();

    // With nothing set yet, the transitions an open issue offers are suggested.
    const block = binding.locator('[data-shot="transition-fields-open"]');
    await block.getByRole('button', { name: 'Resolve → Done' }).click({ timeout: 15_000 });
    await expect(binding.getByPlaceholder('transition id or status name (e.g. Done)')).toHaveValue('Done');
    await expect(block.getByTestId('transition-check')).toContainText('moving it to Done requires Resolution');

    await block.locator('[data-field-id="resolution"] button').first().click();
    await page.getByRole('option', { name: 'Fixed' }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
    await binding.getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(async () => {
        const saved = await (await request.get(`/api/projects/${projectId}/integrations`)).json();
        return { transition: saved.policies.fixTransitionId, fields: saved.policies.fixTransitionFields };
      })
      .toEqual({ transition: 'Done', fields: { resolution: { value: { id: '1' }, label: 'Fixed' } } });
  });

  test('a verified fix moves the issue with that resolution', async ({ request }) => {
    await passTest(request, 'dialog');
    await expect
      .poll(() => mock.moves.find((m) => m.id === '31')?.fields ?? null, { timeout: 20_000 })
      .toEqual({ resolution: { id: '1' } });
  });

  test('a move with no resolution fails for good, naming it, without calling Jira', async ({ request }) => {
    const binding = await (await request.get(`/api/projects/${projectId}/integrations`)).json();
    binding.policies.fixTransitionFields = {};
    expect((await request.put(`/api/projects/${projectId}/integrations`, { data: binding })).ok()).toBe(true);
    const movesBefore = mock.moves.length;

    await passTest(request, 'agent');
    await expect
      .poll(
        async () => {
          const { actions } = await (await request.get(`/api/integrations/actions?projectId=${projectId}`)).json();
          const move = (actions as { kind: string; entityId: number; status: string; error: string | null }[]).find(
            (a) => a.kind === 'transition' && a.entityId === clusters.agent,
          );
          return move ? { status: move.status, error: move.error } : null;
        },
        { timeout: 20_000 },
      )
      .toMatchObject({
        status: 'failed',
        error: expect.stringMatching(/^Jira requires Resolution to move PROJ-\d+ to Done\./),
      });
    expect(mock.moves).toHaveLength(movesBefore);
  });
});
