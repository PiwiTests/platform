/**
 * Client-side saved dashboards for demo mode: the dashboards CRUD, one
 * widget of a dashboard, the editor's preview and the instance default
 * (`server/api/analytics/dashboards`, `widgets/preview`,
 * `settings/analytics-default-dashboard`), through the same shared handler
 * over the in-browser database. The demo keeps no widget cache: every widget
 * request runs its handler.
 */
import { eq } from 'drizzle-orm';
import { users } from '~~/server/database/schema.sqlite';
import { getDemoDb } from '../db.client';
import { demoHttpError } from './http-error';
import { Role } from '#shared/types';
import type { ProjectAccess } from '#shared/handlers/analytics/common';
import {
  createDashboard,
  dashboardDuplicateSchema,
  dashboardInputSchema,
  dashboardPatchSchema,
  DashboardError,
  deleteDashboard,
  duplicateDashboard,
  getDashboard,
  getDashboardWidgetData,
  listDashboards,
  loadDashboardDefinition,
  parseDashboardBody,
  previewDashboardWidget,
  saveDashboard,
  setInstanceDefaultDashboard,
  viewerScope,
  type DashboardActor,
} from '#shared/handlers/dashboards';

/** The "act as" identity; with nobody acting, authentication is off and everything is shared. */
export async function demoActor(actingUserId: number | null): Promise<DashboardActor> {
  if (!actingUserId) return { id: null, role: null, authEnabled: false };
  const db = await getDemoDb();
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, actingUserId));
  return { id: actingUserId, role: (row?.role as Role | undefined) ?? Role.USER, authEnabled: true };
}

export async function demoDashboard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DashboardError) throw demoHttpError(error.statusCode, error.message);
    throw error;
  }
}

/** GET /api/analytics/dashboards */
export async function apiListDashboards(actingUserId: number | null) {
  return demoDashboard(async () => listDashboards(await getDemoDb(), await demoActor(actingUserId)));
}

/** POST /api/analytics/dashboards */
export async function apiCreateDashboard(body: unknown, actingUserId: number | null) {
  return demoDashboard(async () =>
    createDashboard(await getDemoDb(), parseDashboardBody(dashboardInputSchema, body), await demoActor(actingUserId)),
  );
}

/** GET /api/analytics/dashboards/:id */
export async function apiGetDashboard(
  id: string,
  query: URLSearchParams | undefined,
  actingUserId: number | null,
  access: ProjectAccess,
) {
  return demoDashboard(async () => {
    const db = await getDemoDb();
    const actor = await demoActor(actingUserId);
    const { definition } = await loadDashboardDefinition(db, id, actor);
    return getDashboard(db, id, actor, access, { scope: viewerScope(definition, query), touch: true });
  });
}

/** PATCH /api/analytics/dashboards/:id */
export async function apiSaveDashboard(id: string, body: unknown, actingUserId: number | null, access: ProjectAccess) {
  return demoDashboard(async () =>
    saveDashboard(
      await getDemoDb(),
      id,
      parseDashboardBody(dashboardPatchSchema, body),
      await demoActor(actingUserId),
      access,
    ),
  );
}

/** DELETE /api/analytics/dashboards/:id */
export async function apiDeleteDashboard(id: string, actingUserId: number | null) {
  return demoDashboard(async () => deleteDashboard(await getDemoDb(), id, await demoActor(actingUserId)));
}

/** POST /api/analytics/dashboards/:id/duplicate */
export async function apiDuplicateDashboard(id: string, body: unknown, actingUserId: number | null) {
  return demoDashboard(async () =>
    duplicateDashboard(
      await getDemoDb(),
      id,
      await demoActor(actingUserId),
      parseDashboardBody(dashboardDuplicateSchema, body),
    ),
  );
}

/** GET /api/analytics/dashboards/:id/widgets/:key */
export async function apiGetDashboardWidget(
  id: string,
  key: string,
  query: URLSearchParams | undefined,
  actingUserId: number | null,
  access: ProjectAccess,
) {
  return demoDashboard(async () =>
    getDashboardWidgetData(await getDemoDb(), id, key, query, await demoActor(actingUserId), access),
  );
}

/** POST /api/analytics/widgets/preview */
export async function apiPreviewWidget(body: unknown, access: ProjectAccess) {
  return demoDashboard(async () => previewDashboardWidget(await getDemoDb(), body, access));
}

/** PUT /api/settings/analytics-default-dashboard */
export async function apiSetDefaultDashboard(body: unknown) {
  const value = (body as { dashboard?: unknown } | null)?.dashboard ?? null;
  return demoDashboard(async () => setInstanceDefaultDashboard(await getDemoDb(), value));
}
