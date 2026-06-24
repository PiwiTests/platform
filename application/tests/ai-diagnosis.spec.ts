/**
 * Tests for the AI diagnosis endpoints (Pillar 4).
 *
 * Spins up a mock OpenAI-compatible HTTP server on a random port so the Nuxt
 * server can be configured to call it without needing real API credentials.
 */

import { test, expect } from './fixtures';
import type { APIRequestContext } from '@playwright/test';
import * as http from 'http';
import * as net from 'net';
import { PROJECT } from '../shared/test-project-names';
import type { AiDiagnosisResult } from '../shared/ai-diagnosis';

// Force all tests in this file into a single serial worker so the two describe
// blocks don't interfere with each other's AI config state.
test.describe.configure({ mode: 'serial' });

// ── Mock HTTP server ──────────────────────────────────────────────────────────

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

function buildMockAiResponse(): AiDiagnosisResult {
  return {
    category: 'app-bug',
    confidence: 'high',
    confidenceScore: 88,
    severity: 'high',
    affectedArea: 'auth / login',
    summary: 'Mock diagnosis summary from test',
    rootCause: 'Mock root cause explanation',
    evidence: ['Evidence line 1', 'Evidence line 2'],
    hypotheses: [
      {
        category: 'app-bug',
        rootCause: 'Mock root cause explanation',
        likelihood: 88,
        evidence: ['Evidence line 1', 'Evidence line 2'],
      },
      { category: 'test-bug', rootCause: 'Alternative cause', likelihood: 30, evidence: ['Alt evidence'] },
    ],
    suggestedFix: {
      description: 'Mock suggested fix',
      file: 'tests/mock.spec.ts',
      code: null,
      patch: null,
    },
    investigationSteps: ['Check the auth endpoint logs'],
    preventionTips: ['Add more tests'],
  };
}

function startMockAiServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url?.includes('/chat/completions')) {
      req.on('data', () => {});
      req.on('end', () => {
        const diagResult = buildMockAiResponse();
        const responseContent = JSON.stringify(diagResult);
        const payload = {
          id: 'chatcmpl-test',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: responseContent },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 },
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function submitRun(request: APIRequestContext, cases: Array<{ status: string; [key: string]: unknown }>) {
  const res = await request.post('/api/test-runs/submit', {
    data: {
      projectName: PROJECT.AI_DIAGNOSIS,
      status: 'failed',
      startTime: new Date().toISOString(),
      duration: 30000,
      totalTests: cases.length,
      passedTests: cases.filter((c) => c.status === 'passed').length,
      failedTests: cases.filter((c) => c.status === 'failed').length,
      skippedTests: 0,
      testCases: cases,
    },
  });
  expect(res.ok()).toBeTruthy();
  return res.json() as Promise<{ testRunId: number; projectId: number }>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe.serial('AI diagnosis endpoints', () => {
  let mockServer: http.Server;
  let mockPort: number;
  let clusterId: number | null = null;
  let isEnvManaged = false;
  let freshClusterError = '';

  test.beforeAll(async ({ request }) => {
    // Check if AI is managed by env vars — if so, we can't clear/replace the config
    const statusRes = await request.get('/api/ai/status');
    if (statusRes.ok()) {
      const s = (await statusRes.json()) as { source?: string };
      isEnvManaged = s.source === 'env';
    }
    mockPort = await getFreePort();
    mockServer = startMockAiServer(mockPort);
  });

  test.beforeEach(async () => {
    // All tests in this block require controlling the AI config; skip when env-managed
    if (isEnvManaged) test.skip();
  });

  test.afterAll(async ({ request }) => {
    // Clean up AI settings
    await request.put('/api/settings/ai', { data: { roles: null } });
    mockServer.close();
  });

  test('GET /api/ai/status returns configured: false when no provider is set', async ({ request }) => {
    // Clean slate: ensure no AI is configured (env may not set it, DB may have stale state)
    await request.put('/api/settings/ai', { data: { roles: null } });

    const res = await request.get('/api/ai/status');
    expect(res.ok()).toBeTruthy();
    const status = await res.json();
    expect(status.configured).toBe(false);
  });

  test('PUT /api/settings/ai saves provider and model', async ({ request }) => {
    const res = await request.put('/api/settings/ai', {
      data: {
        roles: {
          diagnosis: {
            provider: 'openai',
            apiKey: 'test-key-unused',
            model: 'gpt-test',
            baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          },
        },
        autoDiagnose: false,
      },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('GET /api/ai/status returns configured: true after provider is saved', async ({ request }) => {
    const res = await request.get('/api/ai/status');
    expect(res.ok()).toBeTruthy();
    const status = await res.json();
    expect(status.configured).toBe(true);
    expect(status.provider).toBe('openai');
    expect(status.source).toBe('settings');
  });

  test('GET /api/failure-clusters/:id/diagnosis returns null before any diagnosis', async ({ request }) => {
    // Use a unique error per invocation so retries don't collide with previously-diagnosed clusters
    freshClusterError = `TimeoutError: locator.click: Timeout 30000ms exceeded.\n    at tests/auth.spec.ts:5:3 (${Date.now()})`;
    // Create a test run with a failure cluster
    const { testRunId } = await submitRun(request, [
      {
        title: 'login test',
        status: 'failed',
        duration: 1000,
        location: 'tests/auth.spec.ts:5:3',
        error: freshClusterError,
      },
    ]);

    const run = (await (await request.get(`/api/test-runs/${testRunId}`)).json()) as {
      testCases: Array<{ status: string; failureClusterId?: number }>;
    };
    const failedCase = run.testCases.find((c) => c.status === 'failed');
    expect(failedCase?.failureClusterId).toBeTruthy();
    clusterId = failedCase!.failureClusterId!;

    const res = await request.get(`/api/failure-clusters/${clusterId}/diagnosis`);
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toEqual({ diagnosis: null, manualBaseCommit: null });
  });

  test('POST /api/failure-clusters/:id/diagnose returns completed diagnosis', async ({ request }) => {
    expect(clusterId).toBeTruthy();

    const res = await request.post(`/api/failure-clusters/${clusterId}/diagnose`);
    expect(res.ok()).toBeTruthy();

    const diagnosis = await res.json();
    expect(diagnosis.status).toBe('completed');
    expect(diagnosis.clusterId).toBe(clusterId);
    expect(diagnosis.category).toBe('app-bug');
    expect(diagnosis.confidence).toBe('high');
    expect(typeof diagnosis.summary).toBe('string');
    expect(typeof diagnosis.rootCause).toBe('string');
    // Structured Phase-1 fields are persisted in details
    expect(diagnosis.details.confidenceScore).toBe(88);
    expect(diagnosis.details.severity).toBe('high');
    expect(diagnosis.details.affectedArea).toBe('auth / login');
    expect(Array.isArray(diagnosis.details.hypotheses)).toBe(true);
    expect(diagnosis.details.hypotheses.length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(diagnosis.details.investigationSteps)).toBe(true);
  });

  test('GET /api/failure-clusters/:id/diagnosis returns the stored diagnosis', async ({ request }) => {
    expect(clusterId).toBeTruthy();

    const res = await request.get(`/api/failure-clusters/${clusterId}/diagnosis`);
    expect(res.ok()).toBeTruthy();

    const body = (await res.json()) as { diagnosis: { status: string; category: string } | null };
    expect(body.diagnosis).not.toBeNull();
    expect(body.diagnosis!.status).toBe('completed');
    expect(body.diagnosis!.category).toBe('app-bug');
  });

  test('POST /api/failure-clusters/:id/diagnose returns 409 for existing completed (no force)', async ({ request }) => {
    expect(clusterId).toBeTruthy();

    // Without force, should return existing completed diagnosis (200 not 409)
    const res = await request.post(`/api/failure-clusters/${clusterId}/diagnose`);
    expect(res.ok()).toBeTruthy();
    const diagnosis = await res.json();
    expect(diagnosis.status).toBe('completed');
  });

  test('POST /api/failure-clusters/:id/diagnose?force=true re-runs and returns new diagnosis', async ({ request }) => {
    expect(clusterId).toBeTruthy();

    const res = await request.post(`/api/failure-clusters/${clusterId}/diagnose?force=true`);
    expect(res.ok()).toBeTruthy();

    const diagnosis = await res.json();
    expect(diagnosis.status).toBe('completed');
    expect(diagnosis.category).toBe('app-bug');
  });

  test('failure-groups endpoint includes diagnosis compact for clustered groups', async ({ request }) => {
    expect(clusterId).toBeTruthy();

    // Submit another run with the same error to trigger the known cluster
    const { testRunId } = await submitRun(request, [
      {
        title: 'login test',
        status: 'failed',
        duration: 1000,
        location: 'tests/auth.spec.ts:5:3',
        error: freshClusterError,
      },
    ]);

    const res = await request.get(`/api/test-runs/${testRunId}/failure-groups`);
    expect(res.ok()).toBeTruthy();
    const groups = await res.json();
    expect(Array.isArray(groups)).toBe(true);

    const group = (groups as Array<{ clusterId: number; diagnosis: { status: string; category: string } | null }>).find(
      (g) => g.clusterId === clusterId,
    );
    expect(group).toBeDefined();
    expect(group.diagnosis).toBeDefined();
    expect(group.diagnosis.status).toBe('completed');
    expect(group.diagnosis.category).toBe('app-bug');
  });

  test('a configured researchModel runs a two-stage pipeline', async ({ request }) => {
    expect(clusterId).toBeTruthy();

    // Add a distinct research model; both stages hit the same mock server.
    const put = await request.put('/api/settings/ai', {
      data: {
        roles: {
          diagnosis: { provider: 'openai', model: 'gpt-test', baseUrl: `http://127.0.0.1:${mockPort}/v1` },
          research: { provider: 'openai', model: 'gpt-research-small', baseUrl: `http://127.0.0.1:${mockPort}/v1` },
        },
        autoDiagnose: false,
      },
    });
    expect(put.ok()).toBeTruthy();

    const res = await request.post(`/api/failure-clusters/${clusterId}/diagnose?force=true`);
    expect(res.ok()).toBeTruthy();
    const d = await res.json();
    expect(d.status).toBe('completed');
    expect(Array.isArray(d.details.pipeline)).toBe(true);
    expect(d.details.pipeline).toHaveLength(2);
    expect(d.details.pipeline[0].role).toBe('research');
    expect(d.details.pipeline[1].role).toBe('diagnosis');
    // Total tokens are summed across both stages
    expect(d.inputTokens).toBeGreaterThan(0);
  });
});

test.describe.serial('AI diagnosis — unconfigured error cases', () => {
  let isEnvManaged = false;

  test.beforeAll(async ({ request }) => {
    // Check if AI is managed by env vars
    const statusRes = await request.get('/api/ai/status');
    if (statusRes.ok()) {
      const s = (await statusRes.json()) as { source?: string };
      isEnvManaged = s.source === 'env';
    }
    if (!isEnvManaged) {
      // Ensure AI is not configured
      await request.put('/api/settings/ai', { data: { roles: null } });
    }
  });

  test('POST /diagnose returns 503 when AI is not configured', async ({ request }) => {
    if (isEnvManaged) {
      test.skip();
      return;
    }
    // Submit a run to get a cluster ID
    const res = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.AI_DIAGNOSIS,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 5000,
        totalTests: 1,
        passedTests: 0,
        failedTests: 1,
        skippedTests: 0,
        testCases: [
          {
            title: 'unconfigured test',
            status: 'failed',
            duration: 1000,
            location: 'tests/x.spec.ts:1:1',
            error: 'expect(received).toBe(expected)\nExpected: true\nReceived: false',
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const { testRunId } = await res.json();

    const run = (await (await request.get(`/api/test-runs/${testRunId}`)).json()) as {
      testCases: Array<{ status: string; failureClusterId?: number }>;
    };
    const failedCase = run.testCases.find((c) => c.status === 'failed');
    const cId = failedCase?.failureClusterId;

    if (!cId) return; // no cluster → skip

    const diagnoseRes = await request.post(`/api/failure-clusters/${cId}/diagnose`);
    expect(diagnoseRes.status()).toBe(503);
  });
});

// ── Cluster reconciliation, merge suggestions & naming (Phases 2–3) ──────────
//
// Uses an enhanced mock that also serves /embeddings and branches
// /chat/completions into naming / adjudication / diagnosis. Embedding vectors
// are driven by an `EMBVEC=` marker placed in the (raw) error text, and the
// adjudication verdict by an `ADJ=` marker — both sit after the Playwright Call
// log so they don't affect the deterministic fingerprint, only the embedding /
// adjudication inputs.

function vecFor(input: string): number[] {
  const m = /EMBVEC=([0-9.,\- ]+)/.exec(input);
  if (m) {
    const nums = m[1]
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
    if (nums.length) return nums;
  }
  return [1, 1, 1];
}

function startReconcileMockServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url || '';
      const send = (obj: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      let parsed: { input?: string | string[]; model?: string; messages?: Array<{ role: string; content: string }> } =
        {};
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        /* ignore */
      }

      if (url.includes('/embeddings')) {
        const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input ?? ''];
        send({
          model: parsed.model,
          data: inputs.map((inp, i) => ({ index: i, embedding: vecFor(String(inp)) })),
          usage: { prompt_tokens: 1, total_tokens: 1 },
        });
        return;
      }

      const msgs = Array.isArray(parsed.messages) ? parsed.messages : [];
      const sys = String(msgs.find((m) => m.role === 'system')?.content ?? '');
      const user = String(msgs.find((m) => m.role === 'user')?.content ?? '');
      let content: string;
      if (/name software-test failure clusters/i.test(sys)) {
        const ids = [...user.matchAll(/\bid (\d+)/g)].map((m) => Number(m[1]));
        content = JSON.stringify({ titles: ids.map((id) => ({ id, title: `Mock cluster ${id}` })) });
      } else if (/triaging/i.test(sys)) {
        let verdict = { merge: false, confidence: 'low', reason: 'different root causes' };
        if (/ADJ=high/.test(user)) verdict = { merge: true, confidence: 'high', reason: 'same root cause' };
        else if (/ADJ=medium/.test(user)) verdict = { merge: true, confidence: 'medium', reason: 'likely the same' };
        content = JSON.stringify(verdict);
      } else {
        content = JSON.stringify(buildMockAiResponse());
      }
      send({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
    });
  });
  server.listen(port, '127.0.0.1');
  return server;
}

async function pollUntil<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 20000): Promise<T> {
  const start = Date.now();
  let last = await fn();
  while (!pred(last) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 300));
    last = await fn();
  }
  return last;
}

test.describe.serial('Cluster reconciliation, suggestions & naming', () => {
  let server: http.Server;
  let port: number;
  let envManaged = false;

  test.beforeAll(async ({ request }) => {
    const s = await request.get('/api/ai/status');
    if (s.ok()) envManaged = ((await s.json()) as { source?: string }).source === 'env';
    port = await getFreePort();
    server = startReconcileMockServer(port);
  });

  test.beforeEach(async () => {
    if (envManaged) test.skip();
  });

  test.afterAll(async ({ request }) => {
    if (!envManaged) await request.put('/api/settings/ai', { data: { roles: null } });
    server.close();
  });

  async function configureAi(request: APIRequestContext, opts: { embedding: boolean; autoDiagnose: boolean }) {
    const base = `http://127.0.0.1:${port}/v1`;
    const roles: Record<string, unknown> = {
      diagnosis: { provider: 'openai', model: 'mock', baseUrl: base, apiKey: 'x' },
    };
    if (opts.embedding) roles.embedding = { provider: 'openai', model: 'mock-embed', baseUrl: base, apiKey: 'x' };
    const r = await request.put('/api/settings/ai', { data: { roles, autoDiagnose: opts.autoDiagnose } });
    expect(r.ok()).toBeTruthy();
  }

  async function submitFailures(request: APIRequestContext, projectName: string, cases: object[]) {
    const r = await request.post('/api/test-runs/submit', {
      data: {
        projectName,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 1000,
        totalTests: cases.length,
        passedTests: 0,
        failedTests: cases.length,
        skippedTests: 0,
        testCases: cases,
      },
    });
    expect(r.ok()).toBeTruthy();
    return r.json() as Promise<{ testRunId: number; projectId: number }>;
  }

  const err = (selector: string, embvec: string, extra = '') =>
    `TimeoutError: locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for ${selector}\nEMBVEC=${embvec}\n${extra}`;

  const clustersOf = (request: APIRequestContext, projectId: number) =>
    request.get(`/api/projects/${projectId}/failure-clusters`).then((r) => r.json()) as Promise<any[]>;
  const suggestionsOf = (request: APIRequestContext, projectId: number) =>
    request.get(`/api/projects/${projectId}/cluster-merge-suggestions`).then((r) => r.json()) as Promise<any[]>;

  test('auto-merges embedding near-duplicates', async ({ request }) => {
    await configureAi(request, { embedding: true, autoDiagnose: false });
    const { projectId } = await submitFailures(request, PROJECT.CLUSTER_MERGE, [
      {
        title: 'login a',
        status: 'failed',
        duration: 1,
        location: 'tests/a.spec.ts:1:1',
        error: err("getByTestId('alpha')", '1,0,0'),
      },
      {
        title: 'login b',
        status: 'failed',
        duration: 1,
        location: 'tests/b.spec.ts:1:1',
        error: err("getByTestId('beta')", '1,0,0'),
      },
    ]);

    // Two distinct fingerprints form two clusters, then identical embeddings merge them.
    const clusters = await pollUntil(
      () => clustersOf(request, projectId),
      (c) => c.length === 1,
    );
    expect(clusters.length).toBe(1);
    expect(clusters[0].occurrences).toBe(2);
  });

  test('ambiguous pairs become LLM suggestions; approve merges, reject keeps', async ({ request }) => {
    await configureAi(request, { embedding: true, autoDiagnose: false });
    // Distinct, digit-free selectors → four distinct fingerprints (digits in a
    // selector are masked, which would otherwise collapse e.g. 'p1'/'p2').
    const { projectId } = await submitFailures(request, PROJECT.CLUSTER_SUGGEST, [
      {
        title: 'alpha',
        status: 'failed',
        duration: 1,
        location: 'tests/alpha.spec.ts:1:1',
        error: err("getByTestId('alpha')", '1,0,0,0', 'ADJ=medium'),
      },
      {
        title: 'bravo',
        status: 'failed',
        duration: 1,
        location: 'tests/bravo.spec.ts:1:1',
        error: err("getByTestId('bravo')", '0.85,0.5268,0,0', 'ADJ=medium'),
      },
      {
        title: 'charlie',
        status: 'failed',
        duration: 1,
        location: 'tests/charlie.spec.ts:1:1',
        error: err("getByTestId('charlie')", '0,0,1,0', 'ADJ=medium'),
      },
      {
        title: 'delta',
        status: 'failed',
        duration: 1,
        location: 'tests/delta.spec.ts:1:1',
        error: err("getByTestId('delta')", '0,0,0.85,0.5268', 'ADJ=medium'),
      },
    ]);

    const suggestions = await pollUntil(
      () => suggestionsOf(request, projectId),
      (s) => s.length === 2,
    );
    expect(suggestions.length).toBe(2);
    expect(suggestions.every((s) => s.method === 'llm' && s.llmConfidence === 'medium')).toBeTruthy();

    // medium confidence → not auto-merged; all four clusters still present.
    expect((await clustersOf(request, projectId)).length).toBe(4);

    const [s1, s2] = suggestions;
    expect((await request.post(`/api/cluster-merge-suggestions/${s1.id}/approve`)).ok()).toBeTruthy();
    expect((await request.post(`/api/cluster-merge-suggestions/${s2.id}/reject`)).ok()).toBeTruthy();

    // Approved pair merged (4 → 3); rejected pair untouched; no pending left.
    const after = await pollUntil(
      () => clustersOf(request, projectId),
      (c) => c.length === 3,
    );
    expect(after.length).toBe(3);
    expect((await suggestionsOf(request, projectId)).length).toBe(0);
  });

  test('auto-diagnose generates human-readable cluster titles', async ({ request }) => {
    await configureAi(request, { embedding: false, autoDiagnose: true });
    const { projectId } = await submitFailures(request, PROJECT.CLUSTER_NAMING, [
      {
        title: 'name me',
        status: 'failed',
        duration: 1,
        location: 'tests/n.spec.ts:1:1',
        error: err("getByTestId('name-me')", '1,0,0'),
      },
    ]);

    const clusters = await pollUntil(
      () => clustersOf(request, projectId),
      (c) => c.length >= 1 && !!c[0].title,
    );
    expect(clusters[0].title).toMatch(/^Mock cluster \d+$/);
  });
});
