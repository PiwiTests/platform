import { and, count, eq, gte, inArray, lt } from 'drizzle-orm';
import { projects, scenarioGaps } from '../../../server/database/schema';
import { getFeatureMap } from '../../../server/utils/feature-graph';
import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsNewGaps, AnalyticsScenarioGaps } from '../../analytics/types';
import { gapClassSeverity } from '../../gap-classes';
import { resolveProjectStates } from '../capabilities';
import { DIGEST_PER_PROJECT, selectWeeklyDigest, type DigestGap } from '../gap-digest';
import { listAcceptedUnwritten } from '../scenario-gaps';
import { getAnalyticsContext, type ProjectAccess } from './common';

const TOP_FEATURES = 8;

/**
 * The projects of the scope whose Test Map is active, each checked in its own
 * context, so a report over five projects of which one declined the Test Map
 * has gaps for four.
 */
export async function testMapProjects(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess,
): Promise<{ included: Array<{ id: number; name: string }>; declined: number }> {
  const ctx = await getAnalyticsContext(db, scope, access);
  if (ctx.allowed !== 'all' && ctx.allowed.length === 0) return { included: [], declined: 0 };
  const rows = await db
    .select({ id: projects.id, name: projects.name, label: projects.label })
    .from(projects)
    .where(ctx.allowed === 'all' ? undefined : inArray(projects.id, ctx.allowed));
  const included: Array<{ id: number; name: string }> = [];
  let declined = 0;
  for (const row of rows) {
    const state = (await resolveProjectStates(db, row.id))['test-map'];
    if (state === 'declined' || state === 'not-applicable') declined++;
    else included.push({ id: row.id, name: row.label || row.name });
  }
  return { included, declined };
}

/**
 * Where the scenario gaps stand: open gaps by class and by feature, gaps
 * closed in the period, accepted gaps whose test was never written, and open
 * resilience findings. Gaps carry no environment or branch, so only the
 * project filters narrow the widget.
 */
export async function getAnalyticsScenarioGaps(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsScenarioGaps> {
  const { included, declined } = await testMapProjects(db, scope, access);
  const empty: AnalyticsScenarioGaps = {
    projects: 0,
    declined,
    byClass: [],
    byFeature: [],
    closed: 0,
    acceptedUnwritten: 0,
    findings: 0,
  };
  if (included.length === 0) return empty;
  const ids = included.map((p) => p.id);
  const ctx = await getAnalyticsContext(db, scope, access);

  const classRows = await db
    .select({ kind: scenarioGaps.kind, cls: scenarioGaps.class, n: count() })
    .from(scenarioGaps)
    .where(and(inArray(scenarioGaps.projectId, ids), eq(scenarioGaps.status, 'open')))
    .groupBy(scenarioGaps.kind, scenarioGaps.class);
  const byClass = classRows
    .filter((r) => r.kind === 'gap')
    .map((r) => ({ class: r.cls, count: Number(r.n) }))
    .sort((a, b) => gapClassSeverity(b.class) - gapClassSeverity(a.class) || b.count - a.count);
  const findings = classRows.filter((r) => r.kind === 'finding').reduce((sum, r) => sum + Number(r.n), 0);

  const [closedRow] = await db
    .select({ n: count() })
    .from(scenarioGaps)
    .where(
      and(
        inArray(scenarioGaps.projectId, ids),
        gte(scenarioGaps.closedAt, ctx.period.from),
        lt(scenarioGaps.closedAt, ctx.period.to),
      ),
    );

  const byFeature: AnalyticsScenarioGaps['byFeature'] = [];
  for (const project of included) {
    const map = await getFeatureMap(db, project.id);
    for (const feature of map.features) {
      const total = Object.values(feature.gaps).reduce((sum, n) => sum + n, 0);
      if (total === 0) continue;
      byFeature.push({
        feature: feature.key,
        projectId: project.id,
        projectName: project.name,
        count: total,
        worstClass: feature.worstClass,
      });
    }
  }
  byFeature.sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature));

  const unwritten = await listAcceptedUnwritten(db, ids, new Date(ctx.now));
  return {
    projects: included.length,
    declined,
    byClass,
    byFeature: byFeature.slice(0, TOP_FEATURES),
    closed: Number(closedRow?.n ?? 0),
    acceptedUnwritten: unwritten.length,
    findings,
  };
}

/**
 * The Test Map's weekly digest over the period: the top new open gaps per
 * project created since the period started (`selectWeeklyDigest`).
 */
export async function getAnalyticsNewGaps(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsNewGaps> {
  const { included } = await testMapProjects(db, scope, access);
  if (included.length === 0) return { projects: 0, items: [] };
  const ctx = await getAnalyticsContext(db, scope, access);
  const names = new Map(included.map((p) => [p.id, p.name]));
  const rows = await db
    .select({
      id: scenarioGaps.id,
      projectId: scenarioGaps.projectId,
      title: scenarioGaps.title,
      detector: scenarioGaps.detector,
      cls: scenarioGaps.class,
      score: scenarioGaps.score,
      createdAt: scenarioGaps.createdAt,
    })
    .from(scenarioGaps)
    .where(
      and(
        inArray(
          scenarioGaps.projectId,
          included.map((p) => p.id),
        ),
        eq(scenarioGaps.kind, 'gap'),
        eq(scenarioGaps.status, 'open'),
        gte(scenarioGaps.createdAt, ctx.period.from),
        lt(scenarioGaps.createdAt, ctx.period.to),
      ),
    );
  const gaps: DigestGap[] = rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectName: names.get(r.projectId) ?? '',
    title: r.title,
    detector: r.detector,
    class: r.cls,
    score: r.score ?? null,
    createdAt: new Date(r.createdAt).getTime(),
  }));
  const digest = selectWeeklyDigest(gaps, ctx.period.from.getTime() - 1, DIGEST_PER_PROJECT);
  return {
    projects: included.length,
    items: digest.map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName,
      gaps: p.gaps.map((g) => ({
        id: g.id,
        title: g.title,
        detector: g.detector,
        class: g.class,
        score: g.score,
        createdAt: g.createdAt,
      })),
    })),
  };
}
