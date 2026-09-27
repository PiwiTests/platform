import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRecordingState,
  startRecording,
  stopRecording,
  discardRecording,
  appendRecordingEvent,
  setRecordIntent,
  getRecordIntent,
  clearRecordIntent,
  decideRecordIntent,
  RECORD_INTENT_TTL_MS,
  type RecordIntent,
} from '../../src/shared/recording-storage.js';
import type { RawCaptureEvent } from '@piwitests/core/recording';

function fakeChromeStorage() {
  const store: Record<string, unknown> = {};
  return {
    storage: {
      session: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(store, values);
        },
        remove: async (key: string) => {
          delete store[key];
        },
      },
    },
  };
}

beforeEach(() => {
  (globalThis as any).chrome = fakeChromeStorage();
});

const clickEvent: RawCaptureEvent = {
  kind: 'click',
  target: null,
  value: null,
  checked: null,
  inputType: null,
  isPasswordField: false,
  pageUrl: 'https://x.test/',
  timestamp: 1,
};

describe('recording state', () => {
  it('starts inactive with no events', async () => {
    const state = await getRecordingState();
    expect(state.active).toBe(false);
    expect(state.events).toEqual([]);
  });

  it('startRecording activates and records the granted origin pattern', async () => {
    const state = await startRecording('https://x.test/*');
    expect(state.active).toBe(true);
    expect(state.grantedOriginPattern).toBe('https://x.test/*');
    expect(state.startedAt).not.toBeNull();
    expect(state.mode).toBe('actions');
    expect(state.bugToken).toBeNull();
  });

  it('a bug recording gets a fresh token each time', async () => {
    const first = await startRecording('https://x.test/*', 'bug');
    const second = await startRecording('https://x.test/*', 'bug');
    expect(first.mode).toBe('bug');
    expect(first.bugToken).toMatch(/^[0-9a-f]{32}$/);
    expect(second.bugToken).not.toBe(first.bugToken);
  });

  it('appendRecordingEvent is a no-op when not recording', async () => {
    const state = await appendRecordingEvent(clickEvent);
    expect(state.events).toEqual([]);
  });

  it('appendRecordingEvent accumulates events once active', async () => {
    await startRecording('https://x.test/*');
    await appendRecordingEvent(clickEvent);
    await appendRecordingEvent({ ...clickEvent, timestamp: 2 });
    const state = await getRecordingState();
    expect(state.events).toHaveLength(2);
  });

  it('concurrent appends all survive, in order', async () => {
    // A slow write is what exposes the race the queue exists to close: with the
    // read and the write unserialized, every caller reads the same array and the
    // last one to finish discards the others' events. Real capture hits this
    // whenever two listeners fire together — a click beside a change, a keydown
    // beside a pending input.
    const chromeApi = fakeChromeStorage();
    const write = chromeApi.storage.session.set;
    chromeApi.storage.session.set = async (values: Record<string, unknown>) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await write(values);
    };
    (globalThis as any).chrome = chromeApi;

    await startRecording('https://x.test/*');
    await Promise.all([
      appendRecordingEvent(clickEvent),
      appendRecordingEvent({ ...clickEvent, timestamp: 2 }),
      appendRecordingEvent({ ...clickEvent, timestamp: 3 }),
    ]);

    const state = await getRecordingState();
    expect(state.events.map((e) => e.timestamp)).toEqual([1, 2, 3]);
  });

  it('a failed write rejects to its caller, and later appends still work', async () => {
    const chromeApi = fakeChromeStorage();
    const write = chromeApi.storage.session.set;
    let failNext = false;
    chromeApi.storage.session.set = async (values: Record<string, unknown>) => {
      if (failNext) {
        failNext = false;
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      await write(values);
    };
    (globalThis as any).chrome = chromeApi;

    await startRecording('https://x.test/*');
    failNext = true;
    // Surfaced rather than swallowed: a silent failure here is a recording that
    // looks healthy and exports short.
    await expect(appendRecordingEvent(clickEvent)).rejects.toThrow(/quota/i);
    // And one bad write must not poison the queue for everything after it.
    await appendRecordingEvent({ ...clickEvent, timestamp: 2 });
    const state = await getRecordingState();
    expect(state.events.map((e) => e.timestamp)).toEqual([2]);
  });

  it('stopRecording flips active to false but keeps events', async () => {
    await startRecording('https://x.test/*');
    await appendRecordingEvent(clickEvent);
    const stopped = await stopRecording();
    expect(stopped.active).toBe(false);
    expect(stopped.events).toHaveLength(1);
  });

  it('discardRecording clears everything', async () => {
    await startRecording('https://x.test/*');
    await appendRecordingEvent(clickEvent);
    await discardRecording();
    const state = await getRecordingState();
    expect(state.active).toBe(false);
    expect(state.events).toEqual([]);
  });
});

describe('record intent', () => {
  it('round-trips the origin pattern and tab, stamping a creation time', async () => {
    const before = Date.now();
    await setRecordIntent({ originPattern: 'https://x.test/*', tabId: 7, mode: 'bug' });
    const intent = await getRecordIntent();
    expect(intent).not.toBeNull();
    expect(intent!.originPattern).toBe('https://x.test/*');
    expect(intent!.tabId).toBe(7);
    expect(intent!.mode).toBe('bug');
    expect(intent!.createdAt).toBeGreaterThanOrEqual(before);
  });

  it('reads back null when nothing is parked', async () => {
    expect(await getRecordIntent()).toBeNull();
  });

  it('reads back null for a malformed intent rather than a half-populated one', async () => {
    (globalThis as any).chrome.storage.session.set({ piwiRecordIntent: { originPattern: 'https://x.test/*' } });
    expect(await getRecordIntent()).toBeNull();
  });

  it('clearRecordIntent removes it', async () => {
    await setRecordIntent({ originPattern: 'https://x.test/*', tabId: 7, mode: 'bug' });
    await clearRecordIntent();
    expect(await getRecordIntent()).toBeNull();
  });
});

describe('decideRecordIntent', () => {
  const intent: RecordIntent = { originPattern: 'https://x.test/*', tabId: 7, mode: 'actions', createdAt: 1_000 };

  it('ignores a grant when nothing is parked', () => {
    expect(decideRecordIntent(null, ['https://x.test/*'], 1_000)).toEqual({ action: 'ignore' });
  });

  it('ignores a grant for some other origin — the options page granting the instance origin fires the same event', () => {
    expect(decideRecordIntent(intent, ['https://piwi.test/*'], 1_000)).toEqual({ action: 'ignore' });
  });

  it('starts the recording when a fresh intent matches the granted origin', () => {
    expect(decideRecordIntent(intent, ['https://x.test/*'], 1_500)).toEqual({
      action: 'start',
      originPattern: 'https://x.test/*',
      tabId: 7,
      mode: 'actions',
    });
  });

  it('starts when the granted set includes the origin among others', () => {
    expect(decideRecordIntent(intent, ['https://other.test/*', 'https://x.test/*'], 1_500).action).toBe('start');
  });

  it('clears a stale intent instead of reviving a recording on a much later grant', () => {
    expect(decideRecordIntent(intent, ['https://x.test/*'], 1_000 + RECORD_INTENT_TTL_MS + 1)).toEqual({
      action: 'clear',
    });
  });

  it('still starts right at the TTL boundary', () => {
    expect(decideRecordIntent(intent, ['https://x.test/*'], 1_000 + RECORD_INTENT_TTL_MS).action).toBe('start');
  });
});
