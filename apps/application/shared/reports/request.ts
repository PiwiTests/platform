/**
 * The query of a quality report request (`GET /api/reports/preview`, the demo
 * mirror, the CLI): which dashboard, which format, which language, over which
 * scope. Parsed identically on the server and in the demo.
 */
import { parseAnalyticsScope, type AnalyticsScope } from '../analytics/scope';
import { isBuiltinDashboardKey, type BuiltinDashboardKey } from '../analytics/dashboards';
import { isReportLanguage, type ReportLanguage } from './format';
import { isReportFormat, REPORT_FORMATS, type ReportFormat } from './types';

export class ReportRequestError extends Error {}

export interface ReportRequest {
  dashboard: BuiltinDashboardKey;
  format: ReportFormat;
  language?: ReportLanguage;
  scope: AnalyticsScope;
}

export const DEFAULT_REPORT_DASHBOARD: BuiltinDashboardKey = 'executive';

type QueryLike = URLSearchParams | Record<string, unknown> | undefined | null;

function pick(query: QueryLike, key: string): string | null {
  if (!query) return null;
  const value = query instanceof URLSearchParams ? query.get(key) : (query as Record<string, unknown>)[key];
  if (value == null || value === '') return null;
  return String(Array.isArray(value) ? value[0] : value).trim();
}

export function parseReportRequest(query: QueryLike): ReportRequest {
  const dashboard = pick(query, 'dashboard') ?? DEFAULT_REPORT_DASHBOARD;
  if (!isBuiltinDashboardKey(dashboard)) {
    throw new ReportRequestError(`Unknown dashboard '${dashboard}'. Use overview, executive or engineering.`);
  }
  const format = (pick(query, 'format') ?? 'json').toLowerCase();
  if (!isReportFormat(format)) {
    throw new ReportRequestError(`Unsupported format '${format}'. Use one of: ${REPORT_FORMATS.join(', ')}.`);
  }
  const lang = pick(query, 'lang');
  if (lang !== null && !isReportLanguage(lang))
    throw new ReportRequestError(`Unsupported language '${lang}'. Use en or fr.`);
  return { dashboard, format, ...(lang ? { language: lang } : {}), scope: parseAnalyticsScope(query) };
}
