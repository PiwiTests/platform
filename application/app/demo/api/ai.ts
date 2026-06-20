/**
 * Client-side implementations of AI-related endpoints for demo mode.
 *
 * The demo has no real AI provider. Two clusters (1 and 3) have pre-seeded
 * diagnoses in the demo database so the UI can show the completed diagnosis card.
 * All other clusters return null diagnosis, and the configure/test endpoints
 * return no-op or error responses.
 */

import { getDemoDb } from '../db.client';
import { getClusterDiagnosis } from '~~/shared/handlers/failure-clusters';
import { getProjectFlakyTests } from '~~/shared/handlers/projects';

/** GET /api/ai/status */
export async function apiGetAiStatus() {
  return { configured: false };
}

/** GET /api/failure-clusters/:id/diagnosis */
export async function apiGetClusterDiagnosis(clusterId: number) {
  return getClusterDiagnosis(await getDemoDb(), clusterId);
}

/** POST /api/failure-clusters/:id/diagnose — not supported in demo */
export async function apiDiagnoseCluster(_clusterId: number) {
  throw new Error('AI diagnosis not available in demo mode');
}

/** GET /api/settings/ai */
export async function apiGetAiSettings() {
  return {
    provider: null,
    model: null,
    baseUrl: null,
    autoDiagnose: false,
    hasApiKey: false,
    envManaged: false,
    customInstructions: null,
  };
}

/** PUT /api/settings/ai — no-op in demo */
export async function apiPutAiSettings(_body: unknown) {
  return { success: true };
}

/** POST /api/settings/ai/test */
export async function apiTestAiSettings() {
  return { success: false as const, error: 'AI diagnosis is not available in demo mode' };
}

/** GET /api/settings/ai/limits */
export async function apiGetAiLimits() {
  return {
    limits: {
      sampleErrorChars: 3000,
      scmPatchBudget: 4000,
      affectedTests: 15,
      steps: 30,
      consoleEntries: 15,
      consoleEntryChars: 400,
      networkRequests: 15,
      ariaSnapshotChars: 4000,
      testSourceChars: 3000,
      serverLogEntries: 30,
      serverLogEntryChars: 400,
    },
    envManaged: [],
    fields: [
      {
        key: 'sampleErrorChars',
        label: 'Error text characters',
        envVar: 'PIWI_AI_MAX_SAMPLE_ERROR_CHARS',
        description: 'Max characters of raw error text.',
        min: 200,
        max: 50000,
      },
      {
        key: 'scmPatchBudget',
        label: 'SCM patch budget',
        envVar: 'PIWI_AI_MAX_SCM_PATCH_BUDGET',
        description: 'Total characters of diff patches.',
        min: 0,
        max: 50000,
      },
      {
        key: 'affectedTests',
        label: 'Affected tests',
        envVar: 'PIWI_AI_MAX_AFFECTED_TESTS',
        description: 'Max affected tests listed.',
        min: 1,
        max: 200,
      },
      {
        key: 'steps',
        label: 'Test steps',
        envVar: 'PIWI_AI_MAX_STEPS',
        description: 'Max recent test steps.',
        min: 1,
        max: 200,
      },
      {
        key: 'consoleEntries',
        label: 'Console entries',
        envVar: 'PIWI_AI_MAX_CONSOLE_ENTRIES',
        description: 'Max console entries.',
        min: 0,
        max: 200,
      },
      {
        key: 'consoleEntryChars',
        label: 'Console entry chars',
        envVar: 'PIWI_AI_MAX_CONSOLE_ENTRY_CHARS',
        description: 'Max chars per console entry.',
        min: 50,
        max: 5000,
      },
      {
        key: 'networkRequests',
        label: 'Network requests',
        envVar: 'PIWI_AI_MAX_NETWORK_REQUESTS',
        description: 'Max failed network requests.',
        min: 0,
        max: 200,
      },
      {
        key: 'ariaSnapshotChars',
        label: 'ARIA snapshot chars',
        envVar: 'PIWI_AI_MAX_ARIA_SNAPSHOT_CHARS',
        description: 'Max chars of ARIA snapshot.',
        min: 0,
        max: 50000,
      },
      {
        key: 'testSourceChars',
        label: 'Test source chars',
        envVar: 'PIWI_AI_MAX_TEST_SOURCE_CHARS',
        description: 'Max chars of test source.',
        min: 0,
        max: 50000,
      },
      {
        key: 'serverLogEntries',
        label: 'Server log entries',
        envVar: 'PIWI_AI_MAX_SERVER_LOG_ENTRIES',
        description: 'Max server log entries.',
        min: 0,
        max: 200,
      },
      {
        key: 'serverLogEntryChars',
        label: 'Server log entry chars',
        envVar: 'PIWI_AI_MAX_SERVER_LOG_ENTRY_CHARS',
        description: 'Max chars per server log entry.',
        min: 50,
        max: 5000,
      },
    ],
  };
}

/** PUT /api/settings/ai/limits — no-op in demo */
export async function apiPutAiLimits(_body: unknown) {
  return { success: true };
}

/** GET /api/projects/:id/flaky-tests */
export async function apiGetProjectFlakyTests(projectId: number, runsLimit = 50) {
  return getProjectFlakyTests(await getDemoDb(), projectId, runsLimit);
}
