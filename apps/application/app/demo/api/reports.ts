/**
 * Client-side quality report preview and download for demo mode. Mirrors
 * `server/api/reports/preview.get.ts`: the same request parsing, bundle and
 * renderers from `shared/reports/`, over the in-browser database.
 */
import { getDemoDb, getDemoDbBaseUrl } from '../db.client';
import { collectReportBundle } from '#shared/reports/collect';
import { buildReport } from '#shared/reports/build';
import { parseReportRequest, ReportRequestError } from '#shared/reports/request';
import type { ProjectAccess } from '#shared/handlers/analytics/common';
import { demoHttpError } from './http-error';

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
