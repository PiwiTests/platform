/**
 * Client-side quality reports for demo mode: the preview and downloads
 * (`server/api/reports/preview.get.ts`), and the report schedules and
 * snapshots (`server/api/reports/schedules`, `snapshots`), through the same
 * shared handlers and renderers, over the in-browser database.
 */
import { getDemoDb, getDemoDbBaseUrl } from '../db.client';
import { collectReportBundle } from '#shared/reports/collect';
import { buildReport } from '#shared/reports/build';
import { parseReportRequest, ReportRequestError } from '#shared/reports/request';
import type { ProjectAccess } from '#shared/handlers/analytics/common';
import { demoHttpError } from './http-error';
import { apiGetLocale } from './settings';
import { isReportFormat } from '#shared/reports/types';
import { scheduleTimeZone } from '#shared/reports/schedule';
import {
  createReportSchedule,
  createReportSnapshot,
  deleteReportSchedule,
  getReportSchedule,
  getReportSnapshot,
  listReportSchedules,
  listReportSnapshots,
  listScheduleOwners,
  parseScheduleBody,
  reportSchedulePatchSchema,
  reportScheduleInputSchema,
  ReportScheduleError,
  runReportScheduleNow,
  updateReportSchedule,
  type ReportActor,
  type ReportChannel,
} from '#shared/handlers/reports';

/** The demo's own address, for the links back from a report. */
function demoBaseUrl(): string | null {
  try {
    return new URL(getDemoDbBaseUrl() || '.', typeof location !== 'undefined' ? location.href : undefined).href.replace(
      /\/$/,
      '',
    );
  } catch {
    return null;
  }
}

/** GET /api/reports/preview */
export async function apiReportPreview(query: URLSearchParams | undefined, access: ProjectAccess): Promise<unknown> {
  let request;
  try {
    request = parseReportRequest(query);
  } catch (error) {
    if (error instanceof ReportRequestError) throw demoHttpError(400, error.message);
    throw error;
  }
  const bundle = await collectReportBundle(await getDemoDb(), {
    dashboard: request.dashboard,
    scope: request.scope,
    access,
    language: request.language,
    locale: request.scope.locale,
    timeZone: request.scope.timeZone,
    baseUrl: demoBaseUrl(),
    piwiVersion: 'demo',
  });
  if (request.format === 'json') return bundle;
  const built = await buildReport(bundle, request.format);
  return new Response(built.bytes as BufferSource, {
    status: 200,
    headers: {
      'Content-Type': built.contentType,
      'Content-Disposition': `attachment; filename="${built.fileName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

// ── Report schedules and snapshots ───────────────────────────────────────────
// Stored in the in-browser database through the shared handlers. The demo has
// no scheduler and no outbox: a schedule never fires by itself, and *Run now*
// stores the snapshot without delivering it.

/** Everyone is an administrator in the demo, and every schedule is global. */
const DEMO_ACTOR: ReportActor = { id: null, isAdmin: true, authEnabled: false };

async function demoTimeZone(): Promise<string> {
  return scheduleTimeZone((await apiGetLocale()).timeZone);
}

async function demoReport<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ReportScheduleError) throw demoHttpError(error.statusCode, error.message);
    if (error instanceof ReportRequestError) throw demoHttpError(400, error.message);
    throw error;
  }
}

/** GET /api/reports/schedules */
export async function apiListReportSchedules(channels: ReportChannel[], access: ProjectAccess) {
  const db = await getDemoDb();
  return {
    items: await listReportSchedules(db, DEMO_ACTOR, channels),
    timeZone: await demoTimeZone(),
    owners: await listScheduleOwners(db, access),
  };
}

/** POST /api/reports/schedules */
export async function apiCreateReportSchedule(body: unknown, channels: ReportChannel[], access: ProjectAccess) {
  return demoReport(async () =>
    createReportSchedule(await getDemoDb(), parseScheduleBody(reportScheduleInputSchema, body), {
      actor: DEMO_ACTOR,
      channels,
      access,
      timeZone: await demoTimeZone(),
    }),
  );
}

/** GET /api/reports/schedules/:id */
export async function apiGetReportSchedule(id: number, channels: ReportChannel[]) {
  return demoReport(async () => getReportSchedule(await getDemoDb(), id, DEMO_ACTOR, channels));
}

/** PATCH /api/reports/schedules/:id */
export async function apiUpdateReportSchedule(
  id: number,
  body: unknown,
  channels: ReportChannel[],
  access: ProjectAccess,
) {
  return demoReport(async () =>
    updateReportSchedule(await getDemoDb(), id, parseScheduleBody(reportSchedulePatchSchema, body), {
      actor: DEMO_ACTOR,
      channels,
      access,
      timeZone: await demoTimeZone(),
    }),
  );
}

/** DELETE /api/reports/schedules/:id */
export async function apiDeleteReportSchedule(id: number) {
  await demoReport(async () => deleteReportSchedule(await getDemoDb(), id, DEMO_ACTOR));
  return { success: true };
}

/** POST /api/reports/schedules/:id/run */
export async function apiRunReportSchedule(id: number) {
  return demoReport(async () =>
    runReportScheduleNow(await getDemoDb(), id, DEMO_ACTOR, {
      access: 'all',
      timeZone: await demoTimeZone(),
      baseUrl: demoBaseUrl(),
      piwiVersion: 'demo',
      deliver: false,
    }),
  );
}

/** GET /api/reports/snapshots */
export async function apiListReportSnapshots(query: URLSearchParams | undefined, access: ProjectAccess) {
  const limit = Number(query?.get('limit')) || undefined;
  const scheduleId = Number(query?.get('scheduleId')) || undefined;
  return { items: await listReportSnapshots(await getDemoDb(), access, { limit, scheduleId }) };
}

/** POST /api/reports/snapshots */
export async function apiCreateReportSnapshot(body: unknown, access: ProjectAccess) {
  return demoReport(async () => {
    const request = parseReportRequest((body ?? {}) as Record<string, unknown>);
    return createReportSnapshot(
      await getDemoDb(),
      { dashboard: request.dashboard, scope: request.scope, language: request.language },
      {
        access,
        timeZone: request.scope.timeZone ?? (await demoTimeZone()),
        baseUrl: demoBaseUrl(),
        piwiVersion: 'demo',
        createdBy: null,
      },
    );
  });
}

/** GET /api/reports/snapshots/:id */
export async function apiGetReportSnapshot(id: number, access: ProjectAccess) {
  return demoReport(async () => getReportSnapshot(await getDemoDb(), id, access));
}

/** GET /api/reports/snapshots/:id/export */
export async function apiExportReportSnapshot(id: number, query: URLSearchParams | undefined, access: ProjectAccess) {
  const format = (query?.get('format') ?? 'pdf').toLowerCase();
  if (!isReportFormat(format)) throw demoHttpError(400, `Unsupported format '${format}'`);
  const snapshot = await apiGetReportSnapshot(id, access);
  const built = await buildReport(snapshot.bundle, format);
  return new Response(built.bytes as BufferSource, {
    status: 200,
    headers: {
      'Content-Type': built.contentType,
      'Content-Disposition': `attachment; filename="${built.fileName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}
