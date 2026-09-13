import type { ConnectionInput, ConnectionSummary, ConnectionTestResult } from '#shared/integrations/types';

/**
 * The demo has no server to reach Jira, so it ships one canned Jira connection
 * and answers the connection endpoints from constants. Nothing calls out.
 */
const DEMO_TIME = '2024-01-01T00:00:00.000Z';

const DEMO_CONNECTION: ConnectionSummary = {
  id: 1,
  provider: 'jira',
  name: 'DEMO',
  baseUrl: 'https://demo.atlassian.net',
  config: { flavor: 'cloud' },
  status: 'ok',
  lastCheckedAt: DEMO_TIME,
  lastError: null,
  managedBy: 'db',
  hasCredentials: true,
  createdAt: DEMO_TIME,
  updatedAt: DEMO_TIME,
};

export function listDemoConnections(): { connections: ConnectionSummary[] } {
  return { connections: [DEMO_CONNECTION] };
}

export function getDemoConnection(id: number): { connection: ConnectionSummary } | null {
  return id === DEMO_CONNECTION.id ? { connection: DEMO_CONNECTION } : null;
}

export function createDemoConnection(body: ConnectionInput): { connection: ConnectionSummary } {
  return {
    connection: {
      ...DEMO_CONNECTION,
      id: 2,
      provider: body.provider,
      name: body.name,
      baseUrl: body.baseUrl,
      config: body.config ?? { flavor: 'cloud' },
      status: 'unverified',
      hasCredentials: !!body.credentials && Object.keys(body.credentials).length > 0,
    },
  };
}

export function updateDemoConnection(id: number, body: Partial<ConnectionInput>): { connection: ConnectionSummary } {
  return {
    connection: {
      ...DEMO_CONNECTION,
      id,
      name: body.name ?? DEMO_CONNECTION.name,
      baseUrl: body.baseUrl ?? DEMO_CONNECTION.baseUrl,
    },
  };
}

export function testDemoConnection(): ConnectionTestResult {
  return { ok: true, account: { id: 'demo-account', displayName: 'Demo User' } };
}
