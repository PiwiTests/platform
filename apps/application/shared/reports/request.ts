/**
 * The query of a quality report request (`GET /api/reports/preview`, the demo
 * mirror, the CLI): which dashboard, which format, which language, over which
 * scope. Parsed identically on the server and in the demo.
 */
import { parseAnalyticsScope, type AnalyticsScope } from '../analytics/scope';
import {
  BUILTIN_DASHBOARDS,
  getBuiltinDashboard,
  isBuiltinDashboardKey,
  type BuiltinDashboardKey,
} from '../analytics/dashboards';
import { REPORT_LANGUAGES, isReportLanguage, type ReportLanguage } from './languages';
import { isReportFormat, REPORT_FORMATS, type ReportFormat } from './types';

export class ReportRequestError extends Error {}

export interface ReportRequest {
  /** A built-in dashboard key, or a saved dashboard's id the route loads with the caller's access check. */
  dashboard: BuiltinDashboardKey | `${number}`;
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
  const saved = /^\d+$/.test(dashboard);
  if (!isBuiltinDashboardKey(dashboard) && !saved) {
    const keys = BUILTIN_DASHBOARDS.map((d) => d.key).join(', ');
    throw new ReportRequestError(`Unknown dashboard '${dashboard}'. Use one of: ${keys}, or a saved dashboard id.`);
  }
  const format = (pick(query, 'format') ?? 'json').toLowerCase();
  if (!isReportFormat(format)) {
    throw new ReportRequestError(`Unsupported format '${format}'. Use one of: ${REPORT_FORMATS.join(', ')}.`);
  }
  const lang = pick(query, 'lang');
  if (lang !== null && !isReportLanguage(lang))
    throw new ReportRequestError(`Unsupported language '${lang}'. Use one of: ${REPORT_LANGUAGES.join(', ')}.`);
  const scope = parseAnalyticsScope(query);
  if (isBuiltinDashboardKey(dashboard)) assertDashboardScope(dashboard, scope);
  return { dashboard: dashboard as ReportRequest['dashboard'], format, ...(lang ? { language: lang } : {}), scope };
}

/** The team dashboard reports on one team's tests, so its scope must name an owner. */
export function assertDashboardScope(dashboard: BuiltinDashboardKey, scope: AnalyticsScope): void {
  if (getBuiltinDashboard(dashboard).requires === 'owner' && !scope.tests?.owner?.length) {
    throw new ReportRequestError('The team dashboard needs an owner test filter (owner=<team>).');
  }
}
