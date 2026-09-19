import { describe, test, expect, vi, beforeEach } from 'vitest';

// The finalize side effects are mocked so the helper's routing can be asserted
// without a database or the real background work. Every ingest path (finish,
// upload, submit) shares this helper, so a probe run staying silent here means
// it stays silent on all three.
const computeRegressionSignals = vi.fn(() => Promise.resolve());
const syncAutoMarkersForRun = vi.fn(() => Promise.resolve());
const autoDiagnoseRun = vi.fn(() => Promise.resolve());
const emitRunNotifications = vi.fn(() => Promise.resolve());
const postRunPrFeedbackInBackground = vi.fn();
const maybeEnqueueHealActionInBackground = vi.fn();

vi.mock('../../server/utils/compute-regression-signals', () => ({ computeRegressionSignals }));
vi.mock('../../server/utils/ai-diagnosis', () => ({ autoDiagnoseRun }));
vi.mock('../../server/utils/notifications/run-notifications', () => ({ emitRunNotifications }));
vi.mock('../../server/utils/scm/pr-feedback', () => ({ postRunPrFeedbackInBackground }));
vi.mock('../../server/utils/heal/policy', () => ({ maybeEnqueueHealActionInBackground }));
vi.mock('#shared/handlers/markers', () => ({ syncAutoMarkersForRun }));

const { runFinalizeSideEffects } = await import('../../server/utils/run-finalize-side-effects');

const db = {} as never;

const allEffects = [
  computeRegressionSignals,
  syncAutoMarkersForRun,
  autoDiagnoseRun,
  emitRunNotifications,
  postRunPrFeedbackInBackground,
  maybeEnqueueHealActionInBackground,
];

describe('runFinalizeSideEffects', () => {
  beforeEach(() => {
    for (const fn of allEffects) fn.mockClear();
  });

  test('a real run fires every finalize side effect', () => {
    runFinalizeSideEffects(db, 42, { projectId: 1, metadata: { scm: {} } });
    for (const fn of allEffects) expect(fn).toHaveBeenCalledTimes(1);
  });

  test('a probe-stamped run fires none of them', () => {
    runFinalizeSideEffects(db, 42, { projectId: 1, metadata: { piwiProbe: true } });
    for (const fn of allEffects) expect(fn).not.toHaveBeenCalled();
  });

  test('a run with no metadata still finalizes', () => {
    runFinalizeSideEffects(db, 42, { projectId: 1 });
    for (const fn of allEffects) expect(fn).toHaveBeenCalledTimes(1);
  });
});
