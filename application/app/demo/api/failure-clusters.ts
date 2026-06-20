/**
 * Client-side implementations of the /api/failure-clusters* endpoints for demo mode.
 *
 * Thin wrappers that delegate to shared handler functions.
 */

import { getDemoDb } from '../db.client';
import {
  getFailureCluster,
  patchClusterStatus,
  patchClusterBaseCommit,
  getClusterCommits,
  getClusterCommitDiff,
  getClusterContext,
  getClusterBranches,
  extractClusterCases,
} from '~~/shared/handlers/failure-clusters';

/** GET /api/failure-clusters/:id */
export async function apiGetFailureCluster(id: number) {
  return getFailureCluster(await getDemoDb(), id);
}

/** PATCH /api/failure-clusters/:id/status */
export async function apiPatchClusterStatus(id: number, body: { status?: string; triageNote?: string | null }) {
  return patchClusterStatus(await getDemoDb(), id, body.status ?? '', body.triageNote);
}

/** PATCH /api/failure-clusters/:id/base-commit */
export async function apiPatchClusterBaseCommit(id: number, body: { commit?: string | null }) {
  return patchClusterBaseCommit(await getDemoDb(), id, body.commit);
}

/** GET /api/failure-clusters/:id/commits */
export async function apiGetClusterCommits(id: number) {
  return getClusterCommits(await getDemoDb(), id);
}

/** GET /api/failure-clusters/:id/commit-diff */
export async function apiGetClusterCommitDiff(id: number) {
  return getClusterCommitDiff(await getDemoDb(), id);
}

/** GET /api/failure-clusters/:id/context */
export async function apiGetClusterContext(id: number) {
  return getClusterContext(await getDemoDb(), id);
}

/** GET /api/failure-clusters/:id/branches */
export async function apiGetClusterBranches(id: number) {
  return getClusterBranches(await getDemoDb(), id);
}

/** POST /api/failure-clusters/:id/extract-cases */
export async function apiExtractClusterCases(id: number, body: { testCaseIds: number[]; triageNote?: string }) {
  return extractClusterCases(await getDemoDb(), id, body.testCaseIds, body.triageNote);
}
