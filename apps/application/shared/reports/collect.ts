/**
 * A dashboard and a scope make a report bundle: every widget of the dashboard
 * is run for the reader's project access and mapped to document blocks, the
 * verdict is built by rules, and the footer gathers the definitions and limits.
 * Shared by the server preview route, the MCP tool and the demo.
 */
import { inArray } from 'drizzle-orm';
import { projects } from '../../server/database/schema';
import type { DrizzleDB } from '../handlers/db';
import { analyticsScopeToQuery, hasTestFilter, type AnalyticsScope } from '../analytics/scope';
import { getMetric, type MetricId } from '../analytics/metrics';
import {
  applyWidgetScope,
  getBuiltinDashboard,
  resolveDashboard,
  type BuiltinDashboardKey,
} from '../analytics/dashboards';
import { getAnalyticsWidget } from '../analytics/registry';
import type { AnalyticsVerdict } from '../analytics/types';
import { runAnalyticsWidget } from '../handlers/analytics';
import { getAnalyticsContext, type AnalyticsContext, type ProjectAccess } from '../handlers/analytics/common';
import { getAnalyticsScopeSummary } from '../handlers/analytics/scope-summary';
import { getAnalyticsVerdict } from '../handlers/analytics/verdict';
import { makeFormatter, type ReportLanguage, type ValueFormatter } from './format';
import { resolveReportLanguage } from './language';
import { sentencesFor, type ReportSentences } from './sentences';
import type { ReportBand, ReportBundle, ReportPeriod } from './types';
import { IDENTITY_WIDGETS, WIDGET_DOCUMENTS, widgetMetrics } from './widget-documents';

export interface CollectReportOptions {
  dashboard: BuiltinDashboardKey;
  /** The scope the reader asked for; the dashboard's default scope when omitted. */
  scope?: AnalyticsScope;
  access?: ProjectAccess;
  /** The report language; the project's ticket language or the instance locale when omitted. */
  language?: ReportLanguage;
  /** BCP-47 locale for numbers and dates; the language's default when omitted. */
  locale?: string;
  /** IANA zone the dates are labeled in; UTC when omitted. */
  timeZone?: string;
  /** Absolute base URL of the dashboard, for links back; null leaves the report unlinked. */
  baseUrl?: string | null;
  piwiVersion?: string | null;
  now?: number;
}

const MAX_NAMED_PROJECTS = 5;

function periodText(
  period: { from: Date; to: Date; label: string },
  f: ValueFormatter,
  timeZone: string,
  language: ReportLanguage,
  lowerFirst = false,
  /** A date range needs no name beside its dates. */
  rangeOnly = false,
): ReportPeriod {
  const last = new Date(Math.max(period.from.getTime(), period.to.getTime() - 1));
  const range =
    language === 'fr'
      ? `du ${f.date(period.from, timeZone)} au ${f.date(last, timeZone)}`
      : `${f.date(period.from, timeZone)} to ${f.date(last, timeZone)}`;
  // A comparison label ("The previous period") reads mid-sentence, so it starts lower case.
  const label = lowerFirst ? period.label.charAt(0).toLowerCase() + period.label.slice(1) : period.label;
  return {
    from: period.from.toISOString(),
    to: period.to.toISOString(),
    label: language === 'en' && !rangeOnly ? `${label} (${range})` : range,
  };
}

async function scopeText(
  db: DrizzleDB,
  ctx: AnalyticsContext,
  scope: AnalyticsScope,
  s: ReportSentences,
): Promise<ReportBundle['scopeText']> {
  let projectsText = s.labels.allProjects;
  if (ctx.allowed !== 'all') {
    const rows: { name: string; label: string | null }[] =
      ctx.allowed.length > 0
        ? await db
            .select({ name: projects.name, label: projects.label })
            .from(projects)
            .where(inArray(projects.id, ctx.allowed))
        : [];
    const names = rows.map((r) => r.label || r.name).sort((a, b) => a.localeCompare(b));
    projectsText =
      names.length === 0
        ? s.projectCount(0)
        : names.length <= MAX_NAMED_PROJECTS
          ? names.join(', ')
          : s.projectCount(names.length);
  }
  const policy = ctx.branchPolicy;
  const branches =
    policy.kind === 'list'
      ? policy.branches.join(', ')
      : policy.kind === 'any'
        ? s.labels.allBranches
        : s.labels.defaultBranch;
  const tests: string[] = [];
  if (scope.selection) tests.push(scope.selection);
  if (scope.tests?.tags?.length) tests.push(scope.tests.tags.map((t) => `@${t}`).join(' '));
  if (scope.tests?.owner?.length) tests.push(scope.tests.owner.join(', '));
  if (scope.browsers?.length) tests.push(scope.browsers.join(', '));
  return {
    projects: projectsText,
    branches,
    runs: scope.fullRunsOnly ? s.labels.fullRunsOnly : s.labels.allRuns,
    tests: hasTestFilter(scope) ? tests.join(' · ') || s.labels.testFilter : null,
  };
}

/** Collect the report bundle of a built-in dashboard over a scope. */
export async function collectReportBundle(db: DrizzleDB, opts: CollectReportOptions): Promise<ReportBundle> {
  const dashboard = getBuiltinDashboard(opts.dashboard);
  const scope = opts.scope ?? dashboard.definition.scope;
  const access = opts.access ?? 'all';
  const ctx = await getAnalyticsContext(db, scope, access, opts.now);
  const language = opts.language ?? (await resolveReportLanguage(db, ctx.allowed));
  const timeZone = opts.timeZone || 'UTC';
  // The viewer's locale formats the numbers only when it speaks the report language (`fr-CA` for French).
  const locale = opts.locale?.toLowerCase().startsWith(language) ? opts.locale : undefined;
  const f = makeFormatter(language, locale);
  const s = sentencesFor(language);
  const baseUrl = opts.baseUrl ? opts.baseUrl.replace(/\/$/, '') : null;

  const summary = await getAnalyticsScopeSummary(db, scope, access);
  const bandsDef = resolveDashboard(dashboard.definition);
  const definitions = new Set<MetricId>();
  const docCtx = { f, s, baseUrl, markers: summary.markers, drawMarkers: true };
  let verdict: AnalyticsVerdict | null = null;
  let identity = false;

  const bands: ReportBand[] = [];
  for (const band of bandsDef) {
    const widgets: ReportBand['widgets'] = [];
    for (const widget of band.widgets) {
      const title = s.title(widget.title);
      if (!widget.available) {
        widgets.push({
          key: widget.key,
          type: null,
          title,
          blocks: [{ kind: 'text' as const, text: s.labels.unavailable }],
          notes: [],
        });
        continue;
      }
      const widgetScope = applyWidgetScope(scope, widget.scope);
      const data = await runAnalyticsWidget(db, widget.type, widgetScope, access, widget.options);
      if (widget.type === 'verdict') verdict = data as AnalyticsVerdict;
      for (const id of widgetMetrics(widget.type, widget.options)) definitions.add(id);
      if (IDENTITY_WIDGETS.has(widget.type)) identity = true;
      const notes: string[] = [];
      if (hasTestFilter(widgetScope) && !getAnalyticsWidget(widget.type).testFilters) {
        notes.push(
          language === 'fr'
            ? `${title} n’est pas restreint par le filtre de tests.`
            : `${title} is not narrowed by the test filter.`,
        );
      }
      const blocks = WIDGET_DOCUMENTS[widget.type](data, docCtx, widget.options);
      // A widget with nothing to show for the scope (the Test Map declined everywhere) is left out.
      if (blocks.length === 0) continue;
      widgets.push({ key: widget.key, type: widget.type, title, blocks, notes });
    }
    if (widgets.length === 0) continue;
    bands.push({
      title: s.title(band.title),
      description: band.description ? s.title(band.description) : null,
      widgets,
    });
  }

  verdict ??= await getAnalyticsVerdict(db, scope, access);
  const rangeOnly = scope.period.kind === 'range';
  const period = periodText(ctx.period, f, timeZone, language, false, rangeOnly);
  const text = await scopeText(db, ctx, scope, s);

  const limits = [...ctx.notes];
  if (hasTestFilter(scope)) limits.push(s.testFilterLimit(summary.dataStartsAt ? f.date(summary.dataStartsAt) : null));
  if (identity) limits.push(s.identityLimit);
  limits.push(s.labels.daysAreUtc);

  const query = new URLSearchParams(analyticsScopeToQuery(scope)).toString();
  return {
    generatedAt: new Date(opts.now ?? Date.now()).toISOString(),
    piwiVersion: opts.piwiVersion ?? null,
    sourceUrl: baseUrl ? `${baseUrl}/analytics${query ? `?${query}` : ''}` : null,
    title: s.reportTitle(text.projects, language === 'en' && !rangeOnly ? ctx.period.label : period.label),
    language,
    locale: f.locale,
    timeZone,
    scope,
    scopeText: text,
    period,
    comparison: ctx.comparison ? periodText(ctx.comparison, f, timeZone, language, true) : null,
    dashboard: { ref: dashboard.key, name: dashboard.name },
    verdict: { tone: verdict.tone, sentence: s.verdict(verdict.facts, f) },
    bands,
    targets: [],
    definitions: [...definitions].map((id) => {
      const def = getMetric(id);
      return { id, label: s.metricLabel(id, def.label), definition: s.metricDefinition(id, def.definition) };
    }),
    limits,
  };
}
