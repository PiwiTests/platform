import { and, avg, count, gte, isNotNull, sql, sum } from 'drizzle-orm';
import { optionalIntQuery } from '../../../utils/query-params';
import { getDatabase } from '../../../database';
import { failureDiagnoses } from '../../../database/schema';
import { requireAuth } from '../../../utils/auth';
import type { AiUsageSummary } from '~~/types/api';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get AI token usage',
    description:
      'Aggregates AI diagnosis token usage over the requested period, grouped by provider and model. Requires administrator role.',
    parameters: [{ name: 'days', in: 'query', schema: { type: 'integer', default: 30, minimum: 1, maximum: 365 } }],
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event): Promise<AiUsageSummary> => {
  await requireAuth(event);

  const days = optionalIntQuery(event, 'days', { default: 30, min: 1, max: 365 });
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const db = await getDatabase();
  const rows = await db
    .select({
      provider: failureDiagnoses.provider,
      model: failureDiagnoses.model,
      diagnoses: count(),
      // Plain SQL CASE so the expression works on both SQLite and PostgreSQL.
      failed: sql<number>`sum(case when ${failureDiagnoses.status} = 'failed' then 1 else 0 end)`,
      inputTokens: sum(failureDiagnoses.inputTokens),
      outputTokens: sum(failureDiagnoses.outputTokens),
      avgDurationMs: avg(failureDiagnoses.durationMs),
    })
    .from(failureDiagnoses)
    .where(and(isNotNull(failureDiagnoses.model), gte(failureDiagnoses.updatedAt, since)))
    .groupBy(failureDiagnoses.provider, failureDiagnoses.model);

  // sum/avg come back as string | null depending on the driver — normalize to numbers.
  const byModel = rows
    .map((r) => ({
      provider: r.provider,
      model: r.model ?? '',
      diagnoses: Number(r.diagnoses ?? 0),
      failed: Number(r.failed ?? 0),
      inputTokens: Number(r.inputTokens ?? 0),
      outputTokens: Number(r.outputTokens ?? 0),
      avgDurationMs: r.avgDurationMs === null ? null : Math.round(Number(r.avgDurationMs)),
    }))
    .sort((a, b) => b.inputTokens - a.inputTokens);

  return {
    days,
    totals: {
      diagnoses: byModel.reduce((acc, r) => acc + r.diagnoses, 0),
      inputTokens: byModel.reduce((acc, r) => acc + r.inputTokens, 0),
      outputTokens: byModel.reduce((acc, r) => acc + r.outputTokens, 0),
    },
    byModel,
  };
});
