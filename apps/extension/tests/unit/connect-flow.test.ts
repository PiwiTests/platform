import { describe, test, expect, vi, afterEach } from 'vitest';
import { waitForApproval, type ConnectPoll } from '../../src/shared/connect-flow';
import { describeClient } from '../../src/shared/client-info';
import { addServerPattern, fetchServerPatterns, pollConnect, startConnect } from '../../src/shared/piwi-client';
import type { ConnectionSettings } from '../../src/shared/connection-settings';

/** A fake clock: `sleep` advances it, so a ten-minute wait runs instantly. */
function clock() {
  let now = 0;
  const slept: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
    slept,
  };
}

function answers(...list: Array<ConnectPoll | Error>) {
  const queue = [...list];
  return vi.fn(async () => {
    const next = queue.shift() ?? { status: 'pending' as const };
    if (next instanceof Error) throw next;
    return next;
  });
}

describe('waitForApproval', () => {
  test('polls every interval until approved', async () => {
    const c = clock();
    const poll = answers(
      { status: 'pending' },
      { status: 'pending' },
      { status: 'approved', apiKey: 'pd_x', user: { name: 'Ada' } },
    );
    const outcome = await waitForApproval({ poll, interval: 5, expiresIn: 600, sleep: c.sleep, now: c.now });
    expect(outcome).toEqual({ status: 'approved', apiKey: 'pd_x', user: { name: 'Ada' } });
    expect(c.slept).toEqual([5000, 5000, 5000]);
  });

  test('slow_down lengthens the interval for the rest of the wait', async () => {
    const c = clock();
    const poll = answers({ status: 'slow_down', interval: 10 }, { status: 'pending' }, { status: 'denied' });
    expect(await waitForApproval({ poll, interval: 5, expiresIn: 600, sleep: c.sleep, now: c.now })).toEqual({
      status: 'denied',
    });
    expect(c.slept).toEqual([5000, 10000, 10000]);
  });

  test('gives up as expired at the deadline, and retries a failed request meanwhile', async () => {
    const c = clock();
    const poll = answers(new Error('offline'));
    expect(await waitForApproval({ poll, interval: 5, expiresIn: 20, sleep: c.sleep, now: c.now })).toEqual({
      status: 'expired',
    });
    expect(poll).toHaveBeenCalledTimes(4);
  });

  test('passes the instance’s own expiry through', async () => {
    const c = clock();
    const poll = answers({ status: 'expired' });
    expect((await waitForApproval({ poll, interval: 5, expiresIn: 600, sleep: c.sleep, now: c.now })).status).toBe(
      'expired',
    );
  });

  test('stops when cancelled', async () => {
    const c = clock();
    const controller = new AbortController();
    const poll = vi.fn(async (): Promise<ConnectPoll> => {
      controller.abort();
      return { status: 'pending' };
    });
    expect(
      await waitForApproval({
        poll,
        interval: 5,
        expiresIn: 600,
        sleep: c.sleep,
        now: c.now,
        signal: controller.signal,
      }),
    ).toEqual({ status: 'cancelled' });
    expect(poll).toHaveBeenCalledTimes(1);
  });
});

describe('describeClient', () => {
  test.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'Chrome',
      'Windows',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
      'Edge',
      'macOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0', 'Firefox', 'Linux'],
    [
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'Chrome',
      'ChromeOS',
    ],
    ['something else', 'a browser', ''],
  ])('%s', (ua, browser, os) => {
    expect(describeClient(ua)).toEqual({ browser, os });
  });
});

function respond(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const settings: ConnectionSettings = {
  instanceUrl: 'https://piwi.test/',
  apiKey: 'pd_key',
  projectMappings: [],
  serverMappings: [],
  serverProjects: [],
  serverSyncedAt: 0,
  connectedAs: '',
};

describe('the connect and pattern requests', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('startConnect posts the client and reads the codes', async () => {
    const fetchMock = vi.fn(async () =>
      respond(200, {
        deviceCode: 'pdc_x',
        userCode: 'BCDF-GHJK',
        verificationUrl: 'https://piwi.test/extension/connect?code=BCDF-GHJK',
        interval: 5,
        expiresIn: 600,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const start = await startConnect('https://piwi.test/', { browser: 'Chrome', os: 'Linux' });
    expect(start.userCode).toBe('BCDF-GHJK');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://piwi.test/api/extension/connect');
    expect(JSON.parse(String(init.body))).toEqual({ browser: 'Chrome', os: 'Linux' });
  });

  test('startConnect names an older instance and a rate limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(404)),
    );
    await expect(startConnect('https://piwi.test', { browser: 'Chrome', os: '' })).rejects.toThrow(/one step/);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(429)),
    );
    await expect(startConnect('https://piwi.test', { browser: 'Chrome', os: '' })).rejects.toThrow(/Too many/);
  });

  test('startConnect refuses a verification page that is not a web page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(200, { deviceCode: 'a', userCode: 'b', verificationUrl: 'javascript:alert(1)' })),
    );
    await expect(startConnect('https://piwi.test', { browser: 'Chrome', os: '' })).rejects.toThrow();
  });

  test('pollConnect reads each status, and a 429 as slow_down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(200, { status: 'approved', apiKey: 'pd_k', user: { name: 'Ada' } })),
    );
    expect(await pollConnect('https://piwi.test', 'pdc_x')).toEqual({
      status: 'approved',
      apiKey: 'pd_k',
      user: { name: 'Ada' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(200, { status: 'pending' })),
    );
    expect(await pollConnect('https://piwi.test', 'pdc_x')).toEqual({ status: 'pending' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(429)),
    );
    expect((await pollConnect('https://piwi.test', 'pdc_x')).status).toBe('slow_down');
  });

  test('fetchServerPatterns sends the key and reads the answer', async () => {
    const fetchMock = vi.fn(async () =>
      respond(200, {
        user: { name: 'Ada' },
        items: [{ projectId: 1, projectLabel: 'Shop', pattern: 'https://a/**' }],
        projects: [],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const answer = await fetchServerPatterns(settings);
    expect(answer.user).toEqual({ name: 'Ada' });
    expect(answer.items).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://piwi.test/api/extension/url-patterns');
    expect(init.headers).toEqual({ 'X-API-Key': 'pd_key' });
  });

  test('addServerPattern explains a refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(403)),
    );
    await expect(addServerPattern(settings, 1, { pattern: 'https://a/**' })).rejects.toThrow(/role/);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(409)),
    );
    await expect(addServerPattern(settings, 1, { pattern: 'https://a/**' })).rejects.toThrow(/already/);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(201, { items: [] })),
    );
    await expect(addServerPattern(settings, 1, { pattern: 'https://a/**' })).resolves.toBeUndefined();
  });
});
