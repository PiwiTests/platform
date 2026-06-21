/**
 * Client-side implementations of AI-related endpoints for demo mode.
 *
 * The demo has no real AI provider. Two clusters (1 and 3) have pre-seeded
 * diagnoses in the demo database so the UI can show the completed diagnosis card.
 * All other clusters return null diagnosis, and the configure/test endpoints
 * return no-op or error responses.
 */

import { CONTEXT_LIMIT_FIELDS, DEFAULT_CONTEXT_LIMITS } from '#shared/ai-context-limits';

/** GET /api/ai/status */
export async function apiGetAiStatus() {
  return { configured: false };
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
    limits: DEFAULT_CONTEXT_LIMITS,
    envManaged: [],
    fields: CONTEXT_LIMIT_FIELDS,
  };
}

/** PUT /api/settings/ai/limits — no-op in demo */
export async function apiPutAiLimits(_body: unknown) {
  return { success: true };
}
