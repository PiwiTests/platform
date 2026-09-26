import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsVerdict, VerdictFacts } from '../../analytics/types';
import { verdictTone } from '../../reports/verdict';
import { costOfMinutes } from '../../ci-cost';
import { resolveCiCost } from '../ci-cost';
import { getAnalyticsContext, type ProjectAccess } from './common';
import { computeMetricValues } from './metric-values';

const VERDICT_METRICS = [
  'runs',
  'test-pass-rate',
  'failure-causes-fixed',
  'failure-causes-opened',
  'open-failure-causes',
  'wasted-ci-minutes',
] as const;

/** The facts of the rule-based verdict over the period, and its tone. */
export async function getAnalyticsVerdict(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsVerdict> {
  const ctx = await getAnalyticsContext(db, scope, access);
  const { cost } = await resolveCiCost(db);
  const [current, previous] = await Promise.all([
    computeMetricValues(db, ctx, VERDICT_METRICS, ctx.period.from.getTime(), ctx.period.to.getTime(), { cost }),
    ctx.comparison
      ? computeMetricValues(db, ctx, ['test-pass-rate'], ctx.comparison.from.getTime(), ctx.comparison.to.getTime(), {
          cost,
        })
      : Promise.resolve(null),
  ]);
  const passRate = current.get('test-pass-rate') ?? null;
  const previousPassRate = previous?.get('test-pass-rate') ?? null;
  const wastedMinutes = current.get('wasted-ci-minutes') ?? 0;
  const policy = ctx.branchPolicy;

  const facts: VerdictFacts = {
    runs: current.get('runs') ?? 0,
    passRate,
    previousPassRate,
    passRateDelta:
      passRate !== null && previousPassRate !== null ? Math.round((passRate - previousPassRate) * 10) / 10 : null,
    fixed: current.get('failure-causes-fixed') ?? 0,
    opened: current.get('failure-causes-opened') ?? 0,
    open: current.get('open-failure-causes') ?? 0,
    wastedMinutes,
    wastedCost:
      cost && wastedMinutes > 0 ? { amount: costOfMinutes(wastedMinutes, cost), currency: cost.currency } : null,
    branch:
      policy.kind === 'list'
        ? { kind: 'list', branches: policy.branches }
        : policy.kind === 'default'
          ? { kind: 'default', branches: [...new Set(policy.groups.map((g) => g.branch))] }
          : { kind: 'any', branches: [] },
    comparison: ctx.comparison ? comparisonKind(scope) : 'none',
  };
  return { tone: verdictTone(facts), facts };
}

function comparisonKind(scope: AnalyticsScope): VerdictFacts['comparison'] {
  const kind = scope.comparison.kind;
  if (kind === 'previous' || kind === 'previous-unit' || kind === 'year' || kind === 'none') return kind;
  return 'custom';
}
