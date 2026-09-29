import { describe, test, expect, vi, beforeEach } from 'vitest';

// The finalize side effects are mocked so the helper's routing can be asserted
// without a database or the real background work. Every ingest path (finish,
// upload, submit) shares this helper, so a probe run staying silent here means
// it stays silent on all three.
const computeRegressionSignals = vi.fn(() => Promise.resolve());
const syncAutoMarkersForRun = vi.fn(() => Promise.resolve());
const autoDiagnoseRun = vi.fn(() => Promise.resolve());
const emitRunNotifications = vi.fn(() => Promise.resolve());
const postRunPrFeedbackInBackground = vi.fn(() => Promise.resolve());
const maybeEnqueueHealActionInBackground = vi.fn();
const classifyRunFlakyTests = vi.fn((_db: unknown, _projectId: number, _runId: number) => Promise.resolve());

vi.mock('../../server/utils/compute-regression-signals', () => ({ computeRegressionSignals }));
vi.mock('../../server/utils/ai-diagnosis', () => ({ autoDiagnoseRun }));
vi.mock('../../server/utils/notifications/run-notifications', () => ({ emitRunNotifications }));
vi.mock('../../server/utils/scm/pr-feedback', () => ({ postRunPrFeedbackInBackground }));
vi.mock('../../server/utils/heal/policy', () => ({ maybeEnqueueHealActionInBackground }));
vi.mock('#shared/handlers/markers', () => ({ syncAutoMarkersForRun }));
vi.mock('#shared/handlers/flaky-classify', () => ({ classifyRunFlakyTests }));
const upsertDailyRollup = vi.fn((_db: unknown, _id: number) => Promise.resolve());
vi.mock('#shared/handlers/analytics/rollups', () => ({ upsertDailyRollup }));

const { runFinalizeSideEffects } = await import('../../server/utils/run-finalize-side-effects');
const { runEventBus } = await import('../../server/utils/run-events');

const db = {} as never;

const allEffects = [
  computeRegressionSignals,
  syncAutoMarkersForRun,
  classifyRunFlakyTests,
  autoDiagnoseRun,
  emitRunNotifications,
  postRunPrFeedbackInBackground,
  maybeEnqueueHealActionInBackground,
];

describe('runFinalizeSideEffects', () => {
  beforeEach(() => {
    for (const fn of allEffects) fn.mockClear();
    upsertDailyRollup.mockClear();
  });

  test('a real run fires every finalize side effect', async () => {
    runFinalizeSideEffects(db, 42, { projectId: 1, metadata: { scm: {} } });
    await vi.waitFor(() => expect(maybeEnqueueHealActionInBackground).toHaveBeenCalledTimes(1));
    for (const fn of allEffects) expect(fn).toHaveBeenCalledTimes(1);
  });

  test('the flaky root causes of the run are classified from its id and project', async () => {
    runFinalizeSideEffects(db, 42, { projectId: 7 });
    await vi.waitFor(() => expect(classifyRunFlakyTests).toHaveBeenCalledWith(db, 7, 42));
  });

  test('a failing flaky classification is logged and leaves the other side effects running', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      classifyRunFlakyTests.mockRejectedValueOnce(new Error('classifier down'));
      await expect(runFinalizeSideEffects(db, 42, { projectId: 1 })).resolves.toBeUndefined();
      await vi.waitFor(() => expect(maybeEnqueueHealActionInBackground).toHaveBeenCalledTimes(1));
      expect(errors).toHaveBeenCalledWith('[flaky-classify] classifyRunFlakyTests failed', expect.any(Error));
      for (const fn of allEffects) expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      errors.mockRestore();
    }
  });

  test('auto-heal starts once change coverage stored the run’s locator breaks', async () => {
    let stored!: () => void;
    postRunPrFeedbackInBackground.mockImplementationOnce(() => new Promise<void>((resolve) => (stored = resolve)));
    runFinalizeSideEffects(db, 42, { projectId: 1 });
    await Promise.resolve();
    expect(maybeEnqueueHealActionInBackground).not.toHaveBeenCalled();
    stored();
    await vi.waitFor(() => expect(maybeEnqueueHealActionInBackground).toHaveBeenCalledWith(db, 42));
  });

  test('a probe-stamped run fires none of them', () => {
    runFinalizeSideEffects(db, 42, { projectId: 1, metadata: { piwiProbe: true } });
    for (const fn of allEffects) expect(fn).not.toHaveBeenCalled();
  });

  test('a flake-lab run fires none of them: no rollup, regression signals, notifications or pull-request feedback', () => {
    runFinalizeSideEffects(db, 42, {
      projectId: 1,
      metadata: { piwiFlakeLab: { experimentId: 'exp-1', armId: 'control' } },
    });
    for (const fn of allEffects) expect(fn).not.toHaveBeenCalled();
  });

  test('a run with no metadata still finalizes', async () => {
    runFinalizeSideEffects(db, 42, { projectId: 1 });
    await vi.waitFor(() => expect(maybeEnqueueHealActionInBackground).toHaveBeenCalledTimes(1));
    for (const fn of allEffects) expect(fn).toHaveBeenCalledTimes(1);
  });

  test('rollup-updated follows each write of the rollup, never comes before it', async () => {
    let release!: () => void;
    upsertDailyRollup.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const events: Array<{ type: string; projectId: number }> = [];
    const unsubscribe = runEventBus.subscribeGlobal((e) => events.push({ type: e.type, projectId: e.projectId }));
    try {
      const counted = runFinalizeSideEffects(db, 42, { projectId: 7 });
      await Promise.resolve();
      // The widget cache would re-cache the old numbers if the event went out before the write.
      expect(events).toEqual([]);
      release();
      await counted;
      expect(events).toEqual([{ type: 'rollup-updated', projectId: 7 }]);
      // The second write, once the regression signals are in, is announced too.
      await vi.waitFor(() => expect(events).toHaveLength(2));
      expect(upsertDailyRollup).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });

  test('a probe-stamped run writes no rollup and announces none', async () => {
    const events: string[] = [];
    const unsubscribe = runEventBus.subscribeGlobal((e) => events.push(e.type));
    await runFinalizeSideEffects(db, 42, { projectId: 1, metadata: { piwiProbe: true } });
    unsubscribe();
    expect(upsertDailyRollup).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

describe('every complete-run ingest path routes finalize through the shared helper', () => {
  // Pins the deliberate unification: a batch upload (and submit, and finish) fires
  // the full probe-aware finalize set — regression signals, markers, diagnosis,
  // notifications, PR feedback and heal — not just AI diagnosis. Reverting any
  // path to call an effect directly (bypassing the helper) breaks this.
  const read = async (rel: string) => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    return readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  };
  const paths = [
    '../../server/api/test-runs/upload.post.ts',
    '../../server/api/test-runs/submit.post.ts',
    '../../server/api/test-runs/[id]/finish.post.ts',
  ];
  for (const rel of paths) {
    test(`${rel} calls runFinalizeSideEffects and no side effect directly`, async () => {
      const src = await read(rel);
      expect(src).toContain('runFinalizeSideEffects');
      // The individual effects must only reach these endpoints through the helper.
      expect(src).not.toContain('autoDiagnoseRun(');
      expect(src).not.toContain('emitRunNotifications(');
      expect(src).not.toContain('postRunPrFeedbackInBackground(');
    });
  }
});
