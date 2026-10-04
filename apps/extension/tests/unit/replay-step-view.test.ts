import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleReplayStepView } from '../../src/background/step-views';
import { setConnectionSettings } from '../../src/shared/connection-settings';
import { fetchBugReportStepShot } from '../../src/shared/piwi-client';
import { setReplayState, type ReplayState } from '../../src/shared/replay-storage';
import { memoryLocalStorage } from './memory-secret-area';
import type * as PiwiClient from '../../src/shared/piwi-client';
import type * as StepViews from '../../src/shared/step-views';

// The replay was started with no screenshot of its own: a step's comes from the instance.
vi.mock('../../src/shared/step-views', async (importOriginal) => ({
  ...(await importOriginal<typeof StepViews>()),
  getReplayView: vi.fn(async () => null),
}));
vi.mock('../../src/shared/piwi-client', async (importOriginal) => ({
  ...(await importOriginal<typeof PiwiClient>()),
  fetchBugReportStepShot: vi.fn(async () => ({
    dataUrl: 'data:image/jpeg;base64,/9j/',
    box: { x: 1, y: 2, width: 3, height: 4 },
    viewport: { width: 800, height: 600 },
  })),
}));
vi.mock('../../src/background/cdp-evidence', () => ({ captureThroughDebugger: vi.fn() }));

const fetched = vi.mocked(fetchBugReportStepShot);

function replay(overrides: Partial<ReplayState> = {}): ReplayState {
  return {
    id: 'r1',
    steps: { v: 1, title: 'Coupon', origin: 'https://shop.test', recordedAt: 0, note: null, steps: [] },
    origin: 'https://shop.test',
    position: 3,
    results: [],
    status: 'running',
    stepMode: false,
    cursor: null,
    startedAt: 0,
    bugReportId: 37,
    handOver: { step: 3, reason: 'Nothing matches.' },
    ...overrides,
  };
}

beforeEach(async () => {
  (globalThis as any).chrome = {
    storage: { local: memoryLocalStorage().local, session: memoryLocalStorage().local },
  };
  fetched.mockClear();
  await setConnectionSettings({
    instanceUrl: 'https://piwi.example.com',
    projectMappings: [],
    serverMappings: [],
    serverProjects: [],
    serverSyncedAt: 0,
    connectedAs: '',
  });
});

describe('the screenshot of a handed-over step from the instance', () => {
  it('is fetched for the step the running replay hands over, and no other', async () => {
    await setReplayState(replay());
    expect(await handleReplayStepView({ step: 5 })).toBeNull();
    expect(fetched).not.toHaveBeenCalled();
    expect(await handleReplayStepView({ step: 3 })).toMatchObject({ step: 3, dataUrl: 'data:image/jpeg;base64,/9j/' });
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it('is not fetched for a replay that no longer runs', async () => {
    await setReplayState(replay({ status: 'stopped' }));
    expect(await handleReplayStepView({ step: 3 })).toBeNull();
    expect(fetched).not.toHaveBeenCalled();
  });

  it('is fetched once while the step waits, whatever the pages the person loads meanwhile', async () => {
    await setReplayState(replay({ id: 'r2' }));
    const first = await handleReplayStepView({ step: 3 });
    expect(await handleReplayStepView({ step: 3 })).toEqual(first);
    expect(await handleReplayStepView({ step: 3 })).toEqual(first);
    expect(fetched).toHaveBeenCalledTimes(1);
    // Another replay of the report asks again.
    await setReplayState(replay({ id: 'r3' }));
    await handleReplayStepView({ step: 3 });
    expect(fetched).toHaveBeenCalledTimes(2);
  });
});
