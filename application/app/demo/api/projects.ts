/**
 * Client-side implementations of the /api/projects* endpoints for demo mode.
 *
 * Thin wrappers that delegate to shared handler functions.
 */

import { getDemoDb } from '../db.client';
import {
  listProjects,
  getProject,
  getProjectPerformance,
  getProjectTestCases,
  getProjectSlowTests,
  getProjectFailureClusters,
  updateProject,
  createProject,
  deleteProjectData,
  getProjectMenu,
} from '~~/shared/handlers/projects';
import { listTags, createTag, updateTag, deleteTag } from '~~/shared/handlers/tags';

/** GET /api/projects */
export async function apiGetProjects() {
  return listProjects(await getDemoDb());
}

/** GET /api/projects/:id */
export async function apiGetProject(id: number) {
  return getProject(await getDemoDb(), id);
}

/** GET /api/projects/:id/performance */
export async function apiGetProjectPerformance(id: number, limit = 50) {
  return getProjectPerformance(await getDemoDb(), id, limit);
}

/** GET /api/projects/:id/test-cases */
export async function apiGetProjectTestCases(id: number) {
  return getProjectTestCases(await getDemoDb(), id);
}

/** GET /api/projects/:id/slow-tests */
export async function apiGetProjectSlowTests(id: number, runsCount = 10) {
  return getProjectSlowTests(await getDemoDb(), id, runsCount);
}

/** GET /api/projects/:id/failure-clusters */
export async function apiGetProjectFailureClusters(id: number) {
  return getProjectFailureClusters(await getDemoDb(), id);
}

/** PUT /api/projects/:id — update project */
export async function apiUpdateProject(
  id: number,
  body: {
    label?: string | null;
    description?: string | null;
    diagnosisInstructions?: string | null;
    tagIds?: number[];
  },
) {
  return updateProject(await getDemoDb(), id, body);
}

/** POST /api/projects — create project */
export async function apiCreateProject(body: { name: string; label?: string; description?: string }) {
  return createProject(await getDemoDb(), body.name, body.label, body.description);
}

/** GET /api/tags */
export async function apiGetTags() {
  return listTags(await getDemoDb());
}

/** POST /api/tags */
export async function apiCreateTag(body: { text: string; color?: string }) {
  return createTag(await getDemoDb(), body.text, body.color ?? 'neutral');
}

/** PUT /api/tags/:id */
export async function apiUpdateTag(id: number, body: { text?: string; color?: string }) {
  return updateTag(await getDemoDb(), id, body);
}

/** DELETE /api/tags/:id */
export async function apiDeleteTag(id: number) {
  return deleteTag(await getDemoDb(), id);
}

/** GET /api/projects/menu — slim list for sidebar navigation */
export async function apiGetProjectMenu() {
  return getProjectMenu(await getDemoDb());
}

/** DELETE /api/projects/:id */
export async function apiDeleteProject(id: number) {
  await deleteProjectData(await getDemoDb(), id);
  return { success: true };
}
