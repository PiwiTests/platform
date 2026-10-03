import { applyBugReportLifecycle } from '#shared/handlers/bug-reports';
import { followBugReportTickets } from './integrations/bug-reports';
import type { DbClient } from '../database';
import { computeRegressionSignals } from './compute-regression-signals';
import { autoDiagnoseRun } from './ai-diagnosis';
import { emitIncidentNotification, emitRunNotifications } from './notifications/run-notifications';
import { postRunPrFeedbackInBackground } from './scm/pr-feedback';
import { maybeEnqueueHealActionInBackground } from './heal/policy';
import { syncAutoMarkersForRun } from '#shared/handlers/markers';
import { classifyRunFlakyTests } from '#shared/handlers/flaky-classify';
import { isEligibleRun, isIncidentRun } from '#shared/run-eligibility';
import { recordRunHealth } from '#shared/handlers/run-health';
import { upsertDailyRollup } from '#shared/handlers/analytics/rollups';
import { recordRunResourceFindings } from '#shared/handlers/resource-findings';
import { runEventBus } from './run-events';
import { matchCiRerunRun } from './ci-rerun';
import { inferRunOutcomes } from './outcome-inference';

/**
 * The finalize side effects for a finished run: the environment-incident
 * check, the daily rollup of its cell, regression signals, the CI re-run
 * dispatch it answers, auto markers, flaky root causes, the history of its
 * resource findings, AI diagnosis, notifications, pull-request feedback,
 * auto-heal and the hand-back outcomes the run shows.
 *
 * Every ingest path (finish, upload, submit) routes its finalization through
 * this one helper so the run eligibility rule is honored everywhere: none of
 * these fire for a run whose origin the `run-health` use leaves out (a probe
 * run or a flake-lab run replays a test with an injected fault or condition,
 * so it never counts as a real run), exactly as imports are silent. The
 * incident check runs first and is awaited: a run it flags as an environment
 * incident gets its rollup, its CI re-run match, its auto markers and its
 * resource findings, and in place of regression signals, AI diagnosis, the run
 * and cluster notifications, pull-request feedback and auto-heal it sends one
 * `environment.incident` event. Flaky root causes skip runs the `flakiness`
 * use leaves out, and fix verification, auto-heal and the bug-report lifecycle
 * apply their own uses.
 *
 * The returned promise settles once the run's rollup cell is recomputed, so a
 * caller that awaits it answers only when the analytics already count the run
 * and the gate already reads its incident flag; everything else runs in the
 * background. The cell is recomputed a second time once the regression signals
 * it counts are written. Each write is followed by a `rollup-updated` event:
 * the widget cache and the live dashboards wait for it, since `run-finished`
 * and `run-submitted` go out before the rollup counts the run.
 */
export async function runFinalizeSideEffects(
  db: DbClient,
  id: number,
  run: { projectId: number; metadata?: unknown },
): Promise<void> {
  if (!isEligibleRun(run, 'run-health')) return;
  const health = await recordRunHealth(db, id).catch((e) => {
    console.error('[run-health] recordRunHealth failed', e);
    return null;
  });
  const current = { ...run, metadata: health?.metadata ?? run.metadata };
  const incident = isIncidentRun(current.metadata);

  const recompute = () =>
    upsertDailyRollup(db, id).then(() =>
      runEventBus.publishGlobal({ type: 'rollup-updated', runId: id, projectId: run.projectId }),
    );
  const rollup = recompute().catch((e) => console.error('[analytics] upsertDailyRollup failed', e));
  if (!incident) {
    computeRegressionSignals(db, id)
      .catch((e) => console.error('[regression-signals] computeRegressionSignals failed', e))
      .then(() => rollup)
      .then(recompute)
      .catch((e) => console.error('[analytics] upsertDailyRollup failed', e));
  }
  matchCiRerunRun(db, id).catch((e) => console.error('[ci-rerun] matchCiRerunRun failed', e));
  syncAutoMarkersForRun(db, id).catch((e) => console.error('[markers] syncAutoMarkersForRun failed', e));
  if (isEligibleRun(current, 'flakiness')) {
    classifyRunFlakyTests(db, run.projectId, id).catch((e) =>
      console.error('[flaky-classify] classifyRunFlakyTests failed', e),
    );
  }
  recordRunResourceFindings(db, id).catch((e) =>
    console.error('[resource-findings] recordRunResourceFindings failed', e),
  );
  applyBugReportLifecycle(db, id)
    .then((moved) => followBugReportTickets(db, id, moved))
    .catch((e) => console.error('[bug-reports] applyBugReportLifecycle failed', e));
  if (!isEligibleRun(current, 'notifications')) {
    if (health?.flagged) {
      emitIncidentNotification(db, id).catch((e) =>
        console.error('[notifications] emitIncidentNotification failed', e),
      );
    }
    return rollup;
  }
  autoDiagnoseRun(db, run.projectId, id).catch((e) => console.error('[ai-diagnosis] autoDiagnoseRun failed', e));
  emitRunNotifications(db, id).catch((e) => console.error('[notifications] emitRunNotifications failed', e));
  // Healing's diff-rename step reads the locator breaks change coverage stores.
  void postRunPrFeedbackInBackground(db, id).then(() => {
    maybeEnqueueHealActionInBackground(db, id);
    return inferRunOutcomes(db, id).catch((e) => console.error('[outcomes] inferRunOutcomes failed', e));
  });
  return rollup;
}
