/**
 * AI diagnosis token usage over a window, per provider and model. Shared by the
 * settings endpoint and the demo mirror.
 *
 * Every diagnosis version counts once: the current one by its creation time
 * (when it started), and each earlier version by the time it was snapshotted.
 * A rating moves neither, so rating an old diagnosis never brings it back into
 * the window.
 */
import { and, count, gte, isNotNull, ne, sql, sum } from 'drizzle-orm';
import { failureDiagnoses, failureDiagnosisVersions } from '../../server/database/schema';
import type { AiUsageModelRow, AiUsageSummary } from '../../types/api';
import type { DrizzleDB } from './db';

interface UsageRow {
  provider: string | null;
  model: string | null;
  diagnoses: unknown;
  failed: unknown;
  inputTokens: unknown;
  outputTokens: unknown;
  durationTotal: unknown;
  durationCount: unknown;
}

export async function getAiUsageSummary(db: DrizzleDB, days: number, now: Date = new Date()): Promise<AiUsageSummary> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // Plain SQL CASE so the expressions work on both SQLite and PostgreSQL.
  const current: UsageRow[] = await db
    .select({
      provider: failureDiagnoses.provider,
      model: failureDiagnoses.model,
      diagnoses: count(),
      failed: sql<number>`sum(case when ${failureDiagnoses.status} = 'failed' then 1 else 0 end)`,
      inputTokens: sum(failureDiagnoses.inputTokens),
      outputTokens: sum(failureDiagnoses.outputTokens),
      durationTotal: sum(failureDiagnoses.durationMs),
      durationCount: count(failureDiagnoses.durationMs),
    })
    .from(failureDiagnoses)
    .where(and(isNotNull(failureDiagnoses.model), gte(failureDiagnoses.createdAt, since)))
    .groupBy(failureDiagnoses.provider, failureDiagnoses.model);

  // A version snapshotted while still running never finished, so it spent nothing to report.
  const earlier: UsageRow[] = await db
    .select({
      provider: failureDiagnosisVersions.provider,
      model: failureDiagnosisVersions.model,
      diagnoses: count(),
      failed: sql<number>`sum(case when ${failureDiagnosisVersions.status} = 'failed' then 1 else 0 end)`,
      inputTokens: sum(failureDiagnosisVersions.inputTokens),
      outputTokens: sum(failureDiagnosisVersions.outputTokens),
      durationTotal: sum(failureDiagnosisVersions.durationMs),
      durationCount: count(failureDiagnosisVersions.durationMs),
    })
    .from(failureDiagnosisVersions)
    .where(
      and(
        isNotNull(failureDiagnosisVersions.model),
        ne(failureDiagnosisVersions.status, 'running'),
        gte(failureDiagnosisVersions.createdAt, since),
      ),
    )
    .groupBy(failureDiagnosisVersions.provider, failureDiagnosisVersions.model);

  // sum/count come back as string | number | null depending on the driver — normalize to numbers.
  const merged = new Map<string, AiUsageModelRow & { durationTotal: number; durationCount: number }>();
  for (const r of [...current, ...earlier]) {
    const key = `${r.provider ?? ''}\u0000${r.model ?? ''}`;
    const row = merged.get(key) ?? {
      provider: r.provider,
      model: r.model ?? '',
      diagnoses: 0,
      failed: 0,
      inputTokens: 0,
      outputTokens: 0,
      avgDurationMs: null,
      durationTotal: 0,
      durationCount: 0,
    };
    row.diagnoses += Number(r.diagnoses ?? 0);
    row.failed += Number(r.failed ?? 0);
    row.inputTokens += Number(r.inputTokens ?? 0);
    row.outputTokens += Number(r.outputTokens ?? 0);
    row.durationTotal += Number(r.durationTotal ?? 0);
    row.durationCount += Number(r.durationCount ?? 0);
    merged.set(key, row);
  }

  const byModel: AiUsageModelRow[] = [...merged.values()]
    .map(({ durationTotal, durationCount, ...row }) => ({
      ...row,
      avgDurationMs: durationCount > 0 ? Math.round(durationTotal / durationCount) : null,
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
}
