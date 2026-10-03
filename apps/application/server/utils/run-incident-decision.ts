/**
 * A person's or an agent's decision on a run's environment-incident flag, as
 * the run page and `set_run_incident` make it: the shared write, then, for a
 * cleared run, the regression signals and the daily rollup a flagged run
 * skipped at finalize.
 */
import { setRunIncident } from '#shared/handlers/run-health';
import type { RunIncidentRequest } from '#shared/run-incident';
import { upsertDailyRollup } from '#shared/handlers/analytics/rollups';
import { computeRegressionSignals } from './compute-regression-signals';
import type { DbClient } from '../database';

/** Mark or clear a run's incident flag. Throws `Test run not found` for an unknown run. */
export async function decideRunIncident(db: DbClient, runId: number, input: RunIncidentRequest, by: string | null) {
  const state = await setRunIncident(db, runId, { ...input, by });
  if (!input.incident) {
    computeRegressionSignals(db, runId)
      .then(() => upsertDailyRollup(db, runId))
      .catch((e) => console.error('[run-health] recomputing a cleared run failed', e));
  }
  return state;
}
