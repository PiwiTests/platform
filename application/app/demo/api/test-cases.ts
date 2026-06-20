/**
 * Client-side implementations of the /api/test-run-cases* and /api/test-cases* endpoints for demo mode.
 *
 * Thin wrappers that delegate to shared handler functions.
 */

import { getDemoDb } from '../db.client';
import { getTestCase, getTestRunCase, getTestCaseHistory, getTestRunCaseTraces } from '~~/shared/handlers/test-cases';

/** GET /api/test-cases/:id */
export async function apiGetTestCase(id: number) {
  return getTestCase(await getDemoDb(), id);
}

/** GET /api/test-run-cases/:id */
export async function apiGetTestRunCase(id: number) {
  return getTestRunCase(await getDemoDb(), id);
}

/** GET /api/test-cases/:id/history */
export async function apiGetTestCaseHistory(id: number) {
  return getTestCaseHistory(await getDemoDb(), id);
}

/** GET /api/test-run-cases/:id/traces */
export async function apiGetTestRunCaseTraces(id: number) {
  return getTestRunCaseTraces(await getDemoDb(), id);
}
