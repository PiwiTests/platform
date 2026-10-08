/**
 * `run_execution_diagnosis` runs Piwi's AI diagnosis on one failing execution,
 * through the same handler as the failure page's Diagnose, and
 * `get_execution_diagnosis` reads the stored result back.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as schema from '../../server/database/schema.sqlite';
import { openTempDb, type TempDb } from './temp-db';
import type { McpContext } from '../../server/utils/mcp/tools';
import type { User } from '../../server/database/schema';
import type { AiConfig, ResolvedAiRole } from '../../types/api';
import { InstanceRole, ProjectRole, buildAccessSummary } from '#shared/permissions';

// The schema barrel picks the PostgreSQL schema when PIWI_DATABASE_URL is set,
// so clear it before the modules under test load.
delete process.env.PIWI_DATABASE_URL;

const role: ResolvedAiRole = {
  provider: 'openai',
  apiKey: 'k',
  model: 'main-model',
  baseUrl: 'http://localhost:1',
  temperature: null,
};
const config: AiConfig = {
  ...role,
  autoDiagnose: false,
  source: 'settings',
  roles: { diagnosis: role, research: null, embedding: null },
};

const ai = vi.hoisted(() => ({ configured: true, calls: 0 }));
vi.mock('../../server/utils/notifications/emit', () => ({ emitNotification: () => {} }));
vi.mock('../../server/utils/ai-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../server/utils/ai-provider')>()),
  resolveAiConfig: async () => (ai.configured ? config : null),
  callAiProvider: async () => {
    ai.calls += 1;
    return {
      text: JSON.stringify({ summary: `Diagnosis ${ai.calls}`, category: 'test-bug', confidence: 'medium' }),
      model: 'main-model',
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationInputTokens: null,
      cacheReadInputTokens: null,
    };
  },
}));

const { MCP_TOOLS } = await import('../../server/utils/mcp/tools');
const { getAppSetting } = await import('../../server/utils/app-settings');

const tool = (name: string) => {
  const found = MCP_TOOLS.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found.handler;
};

const asUser = (id: number, name: string) =>
  ({ id, role: InstanceRole.MEMBER, name, username: name.toLowerCase() }) as User;
const onProject1 = (projectRole: ProjectRole) =>
  buildAccessSummary(InstanceRole.MEMBER, [{ projectId: 1, role: projectRole }]);
const maintainer: McpContext = {
  user: asUser(2, 'Robin'),
  access: onProject1(ProjectRole.MAINTAINER),
  scope: new Set([1]),
};
const viewer: McpContext = { user: asUser(3, 'Sam'), access: onProject1(ProjectRole.VIEWER), scope: new Set([1]) };

let db: TempDb;
let close: () => Promise<void>;

beforeEach(async () => {
  // A Nitro auto-import the diagnosis reads its instructions with.
  vi.stubGlobal('getAppSetting', getAppSetting);
  ({ db, close } = await openTempDb());
  ai.configured = true;
  ai.calls = 0;
  await db.insert(schema.projects).values({ id: 1, name: 'shop' });
  await db.insert(schema.testCases).values({ id: 1, projectId: 1, filePath: 'tests/cart.spec.ts', title: 'totals' });
  await db.insert(schema.testRuns).values({ id: 1, projectId: 1, status: 'failed', startTime: new Date() });
  await db.insert(schema.failureClusters).values({
    id: 1,
    projectId: 1,
    fingerprint: 'fp-1',
    signature: 'expected 30, got -10',
    errorType: 'assertion',
    firstSeenRunId: 1,
    lastSeenRunId: 1,
    occurrences: 1,
  });
  await db.insert(schema.testRunsCases).values({
    id: 1,
    testRunId: 1,
    testCaseId: 1,
    status: 'failed',
    error: 'Error: expected 30, got -10',
    failureClusterId: 1,
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await close();
});

describe('run_execution_diagnosis', () => {
  test('diagnoses a failure, then returns its completed diagnosis until forced', async () => {
    const first = (await tool('run_execution_diagnosis')(db as never, { executionId: 1 }, maintainer)) as Record<
      string,
      unknown
    >;
    expect(first).toMatchObject({ executionId: 1, status: 'completed', category: 'test-bug', summary: 'Diagnosis 1' });

    const again = await tool('run_execution_diagnosis')(db as never, { executionId: 1 }, maintainer);
    expect(again).toMatchObject({ diagnosisId: first.diagnosisId, summary: 'Diagnosis 1' });
    expect(ai.calls).toBe(1);

    const forced = await tool('run_execution_diagnosis')(db as never, { executionId: 1, force: true }, maintainer);
    expect(forced).toMatchObject({ diagnosisId: first.diagnosisId, summary: 'Diagnosis 2' });
    expect(await db.select().from(schema.failureDiagnosisVersions)).toHaveLength(1);

    const [row] = await db.select().from(schema.failureDiagnoses);
    expect(row).toMatchObject({ scope: 'execution', testRunsCaseId: 1, clusterId: null });
    expect(await tool('get_execution_diagnosis')(db as never, { executionId: 1 }, viewer)).toMatchObject({
      executionId: 1,
      summary: 'Diagnosis 2',
      model: 'main-model',
    });
  });

  test('says to record a diagnosis when no AI provider is configured', async () => {
    ai.configured = false;
    await expect(tool('run_execution_diagnosis')(db as never, { executionId: 1 }, maintainer)).rejects.toThrow(
      'AI diagnosis is not configured on this instance; write the diagnosis and call record_diagnosis',
    );
  });

  test('refuses a read-only key, and returns null for an execution that does not exist', async () => {
    await expect(tool('run_execution_diagnosis')(db as never, { executionId: 1 }, viewer)).rejects.toThrow(
      'This action requires the ai:run permission on project 1',
    );
    expect(await tool('run_execution_diagnosis')(db as never, { executionId: 99 }, maintainer)).toBeNull();
    expect(ai.calls).toBe(0);
  });
});
