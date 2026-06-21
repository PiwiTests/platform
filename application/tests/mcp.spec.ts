import { test, expect } from './fixtures';
import { PROJECT } from '../shared/test-project-names';

function rpc(method: string, params?: Record<string, unknown>, id = 1) {
  return { jsonrpc: '2.0', id, method, params: params ?? {} };
}

async function mcp(request: any, method: string, params?: Record<string, unknown>) {
  const res = await request.post('/mcp', { data: rpc(method, params) });
  expect(res.ok(), `${method} should succeed`).toBeTruthy();
  return res.json();
}

test.describe.serial('MCP server', () => {
  let projectId: number;
  let runId: number;

  test.beforeAll(async ({ request }) => {
    const res = await request.post('/api/test-runs/submit', {
      data: {
        projectName: PROJECT.MCP_TEST,
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 5000,
        totalTests: 3,
        passedTests: 1,
        failedTests: 2,
        skippedTests: 0,
        testCases: [
          { title: 'login works', status: 'passed', duration: 1000, location: 'tests/auth.spec.ts:5:1' },
          {
            title: 'checkout fails',
            status: 'failed',
            duration: 2000,
            location: 'tests/checkout.spec.ts:10:1',
            error: 'Expected button to be visible',
            retries: 0,
          },
          {
            title: 'payment fails',
            status: 'failed',
            duration: 2000,
            location: 'tests/payment.spec.ts:15:1',
            error: 'Expected button to be visible',
            retries: 1,
          },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    projectId = data.projectId;
    runId = data.testRunId;
  });

  test('initialize — returns server info and capabilities', async ({ request }) => {
    const body = await mcp(request, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' },
    });
    expect(body.result.protocolVersion).toBe('2024-11-05');
    expect(body.result.serverInfo.name).toBe('piwi-dashboard');
    expect(body.result.capabilities.tools).toBeDefined();
  });

  test('ping — returns empty result', async ({ request }) => {
    const body = await mcp(request, 'ping');
    expect(body.result).toEqual({});
  });

  test('tools/list — returns all 11 tools', async ({ request }) => {
    const body = await mcp(request, 'tools/list');
    const tools: { name: string }[] = body.result.tools;
    expect(tools.length).toBe(11);
    const names = tools.map((t) => t.name);
    expect(names).toContain('list_projects');
    expect(names).toContain('get_run');
    expect(names).toContain('get_cluster_context');
    // Every tool has a description and inputSchema
    for (const t of tools) {
      expect(t).toHaveProperty('description');
      expect(t).toHaveProperty('inputSchema');
    }
  });

  test('tools/call list_projects — returns project list with stats', async ({ request }) => {
    const body = await mcp(request, 'tools/call', { name: 'list_projects', arguments: {} });
    const text = body.result.content[0].text;
    const projects = JSON.parse(text);
    expect(Array.isArray(projects)).toBe(true);
    const project = projects.find((p: any) => p.name === PROJECT.MCP_TEST);
    expect(project).toBeDefined();
    expect(project.id).toBe(projectId);
    expect(project.totalRuns).toBeGreaterThan(0);
  });

  test('tools/call get_project — returns project with runs', async ({ request }) => {
    const body = await mcp(request, 'tools/call', { name: 'get_project', arguments: { id: projectId } });
    const data = JSON.parse(body.result.content[0].text);
    expect(data.id).toBe(projectId);
    expect(data.name).toBe(PROJECT.MCP_TEST);
    expect(Array.isArray(data.runs)).toBe(true);
    expect(data.runs.length).toBeGreaterThan(0);
  });

  test('tools/call list_runs — filters by projectId', async ({ request }) => {
    const body = await mcp(request, 'tools/call', { name: 'list_runs', arguments: { projectId } });
    const runs = JSON.parse(body.result.content[0].text);
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].status).toBe('failed');
  });

  test('tools/call get_run — returns summary and failed cases', async ({ request }) => {
    const body = await mcp(request, 'tools/call', { name: 'get_run', arguments: { id: runId } });
    const run = JSON.parse(body.result.content[0].text);
    expect(run.id).toBe(runId);
    expect(run.status).toBe('failed');
    expect(run.failed).toBe(2);
    expect(run.passed).toBe(1);
    // Default filter is "failed" — should include the 2 failed cases
    expect(run.cases.length).toBe(2);
    expect(run.cases[0]).toHaveProperty('title');
    expect(run.cases[0]).toHaveProperty('status');
    // Null values should be omitted from compact output
    expect(run.cases[0].error).not.toBeNull();
  });

  test('tools/call get_run with status_filter=all — returns all cases', async ({ request }) => {
    const body = await mcp(request, 'tools/call', {
      name: 'get_run',
      arguments: { id: runId, status_filter: 'all' },
    });
    const run = JSON.parse(body.result.content[0].text);
    expect(run.casesTotal).toBe(3);
    expect(run.cases.length).toBe(3);
  });

  test('tools/call list_failed_cases — returns failed cases for project', async ({ request }) => {
    const body = await mcp(request, 'tools/call', {
      name: 'list_failed_cases',
      arguments: { projectId, runId },
    });
    const cases = JSON.parse(body.result.content[0].text);
    expect(Array.isArray(cases)).toBe(true);
    expect(cases.length).toBe(2);
    expect(cases[0]).toHaveProperty('title');
    expect(cases[0]).toHaveProperty('error');
  });

  test('tools/call list_clusters — returns cluster list', async ({ request }) => {
    const body = await mcp(request, 'tools/call', { name: 'list_clusters', arguments: { projectId } });
    const clusters = JSON.parse(body.result.content[0].text);
    expect(Array.isArray(clusters)).toBe(true);
    // Two similar errors should be grouped into at least one cluster
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters[0]).toHaveProperty('id');
    expect(clusters[0]).toHaveProperty('status');
  });

  test('tools/call with unknown tool — returns method error', async ({ request }) => {
    const body = await mcp(request, 'tools/call', { name: 'nonexistent_tool', arguments: {} });
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32602);
  });

  test('unknown method — returns method not found error', async ({ request }) => {
    const body = await mcp(request, 'unknown/method');
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32601);
  });

  test('batch requests — handles array of JSON-RPC messages', async ({ request }) => {
    const res = await request.post('/mcp', {
      data: [rpc('ping', {}, 1), rpc('tools/list', {}, 2)],
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    const ping = body.find((r: any) => r.id === 1);
    const list = body.find((r: any) => r.id === 2);
    expect(ping.result).toEqual({});
    expect(list.result.tools.length).toBe(11);
  });
});
