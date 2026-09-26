import type { DbClient } from '../database';
import { computeRegressionSignals } from './compute-regression-signals';
import { autoDiagnoseRun } from './ai-diagnosis';
import { emitRunNotifications } from './notifications/run-notifications';
import { postRunPrFeedbackInBackground } from './scm/pr-feedback';
import { maybeEnqueueHealActionInBackground } from './heal/policy';
import { syncAutoMarkersForRun } from '#shared/handlers/markers';
import { isProbeRun } from '#shared/handlers/probes';
import { upsertDailyRollup } from '#shared/handlers/analytics/rollups';

/**
 * The finalize side effects for a finished run: the daily rollup of its cell,
 * regression signals, auto markers, AI diagnosis, notifications, pull-request
 * feedback and auto-heal.
 *
 * Every ingest path (finish, upload, submit) routes its finalization through
 * this one helper so the probe stamp is honored everywhere: a probe run replays
 * a passing test with an injected fault, so it never counts as a real run — none
 * of these fire for it, exactly as imports are silent.
 *
 * The returned promise settles once the run's rollup cell is recomputed, so a
 * caller that awaits it answers only when the analytics already count the run;
 * everything else runs in the background. The cell is recomputed a second time
 * once the regression signals it counts are written.
 */
export function runFinalizeSideEffects(
  db: DbClient,
  id: number,
  run: { projectId: number; metadata?: unknown },
): Promise<void> {
  if (isProbeRun(run.metadata)) return Promise.resolve();
  const rollup = upsertDailyRollup(db, id).catch((e) => console.error('[analytics] upsertDailyRollup failed', e));
  computeRegressionSignals(db, id)
    .catch((e) => console.error('[regression-signals] computeRegressionSignals failed', e))
    .then(() => rollup)
    .then(() => upsertDailyRollup(db, id))
    .catch((e) => console.error('[analytics] upsertDailyRollup failed', e));
  syncAutoMarkersForRun(db, id).catch((e) => console.error('[markers] syncAutoMarkersForRun failed', e));
  autoDiagnoseRun(db, run.projectId, id).catch((e) => console.error('[ai-diagnosis] autoDiagnoseRun failed', e));
  emitRunNotifications(db, id).catch((e) => console.error('[notifications] emitRunNotifications failed', e));
  postRunPrFeedbackInBackground(db, id);
  maybeEnqueueHealActionInBackground(db, id);
  return rollup;
}
