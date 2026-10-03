import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { DesktopJobs, verdictMessage } from '../src/desktop-jobs';
import { PiwiClient, type BranchFailure } from '../src/piwi-client';
import type { DesktopJobUpdate } from '../src/protocol';

const BAD = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0';
const GOOD = 'a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0';
const FIRST_BAD = { sha: 'c1c1c1c1c1c1', subject: 'Drop the coupon cache', author: 'Ada', date: null };
const TOKEN = 'pd_desktop_token';
const TEAM_KEY = 'pd_team_key';

interface Received {
  method: string;
  url: string;
  key: string | undefined;
  body: unknown;
}

/** A stub server answering from `routes`, recording every request it receives. */
async function stub(
  routes: (req: Received) => { status?: number; body: unknown } | undefined,
): Promise<{ url: string; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const got = {
        method: req.method ?? 'GET',
        url: req.url ?? '',
        key: req.headers['x-api-key'] as string | undefined,
        body: raw ? JSON.parse(raw) : null,
      };
      received.push(got);
      const answer = routes(got) ?? { status: 404, body: { message: 'not found' } };
      res.statusCode = answer.status ?? 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

let team: Awaited<ReturnType<typeof stub>>;
let desktop: Awaited<ReturnType<typeof stub>>;
let discovery = '';
/** What the desktop app answers for the job, as the developer and the run move it along. */
let jobState: { status: string; jobVerdict: unknown } = { status: 'waiting', jobVerdict: null };

const failure: BranchFailure = {
  executionId: 501,
  testCaseId: 9,
  clusterId: 214,
  title: 'applies the coupon',
  file: 'tests/cart.spec.ts',
  line: 12,
  status: 'failed',
  headline: 'Expected 40',
  location: null,
  traces: [],
  screenshot: null,
};

beforeAll(async () => {
  team = await stub((req) => {
    if (req.key !== TEAM_KEY) return { status: 401, body: {} };
    if (req.method === 'GET' && req.url === '/api/test-run-cases/501/reproduce') {
      return {
        body: {
          bisect: { available: true },
          desktop: {
            cases: [{ filePath: 'tests/cart.spec.ts', title: 'applies the coupon', line: 12, projectName: 'chromium' }],
            browserName: 'chromium',
            commit: BAD,
            good: GOOD,
            bad: BAD,
            clusterId: 214,
          },
        },
      };
    }
    if (req.method === 'POST' && req.url === '/api/failure-clusters/214/bisect') {
      return { body: { ok: true, bisectedCommit: { ...(req.body as object), commitUrl: null } } };
    }
    return undefined;
  });
  desktop = await stub((req) => {
    if (req.key !== TOKEN) return { status: 401, body: {} };
    if (req.method === 'POST' && req.url === '/api/desktop/repro-requests') {
      return { status: 201, body: { id: 'f00d', status: 'waiting', windowOpen: true } };
    }
    if (req.method === 'GET' && req.url === '/api/desktop/repro-requests/f00d') {
      return { body: { id: 'f00d', ...jobState } };
    }
    return undefined;
  });
  discovery = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'piwi-desktop-jobs-')), 'desktop.json');
  fs.writeFileSync(discovery, JSON.stringify({ url: desktop.url, token: TOKEN, projects: [] }));
});

afterAll(async () => {
  await team.close();
  await desktop.close();
});

beforeEach(() => {
  team.received.length = 0;
  desktop.received.length = 0;
  jobState = { status: 'waiting', jobVerdict: null };
});

const instance = () => new PiwiClient({ serverUrl: team.url, apiKey: TEAM_KEY, project: 'shop' });

describe('a job passed to the desktop app', () => {
  test('is offered for a failure of a team instance while the app runs, never for the app itself', () => {
    const jobs = new DesktopJobs({ PIWI_DESKTOP_CONFIG: discovery }, () => {});
    expect(jobs.available({ client: instance(), source: 'environment' })).toBe(true);
    expect(jobs.available({ client: instance(), source: 'desktop' })).toBe(false);
    expect(jobs.available({ client: null, source: null })).toBe(false);
    const absent = new DesktopJobs({ PIWI_DESKTOP_CONFIG: path.join(path.dirname(discovery), 'none.json') }, () => {});
    expect(absent.available({ client: instance(), source: 'environment' })).toBe(false);
  });

  test('is a bisect that runs on the desktop app and is shared on the team instance with the editor key', async () => {
    const updates: DesktopJobUpdate[] = [];
    const jobs = new DesktopJobs({ PIWI_DESKTOP_CONFIG: discovery }, (u) => updates.push(u), 60_000);

    const started = await jobs.start({ client: instance() }, failure, 'bisect');
    expect(started).toMatchObject({ ok: true, jobId: 'f00d' });
    expect(started.message).toContain('Confirm the job in the Piwi desktop app');

    // The job names commits and tests, and goes to the app with the app's token only.
    const posted = desktop.received.find((r) => r.method === 'POST')!;
    expect(posted.key).toBe(TOKEN);
    expect(posted.body).toEqual({
      kind: 'bisect',
      commit: BAD,
      good: GOOD,
      tests: [{ filePath: 'tests/cart.spec.ts', title: 'applies the coupon', line: 12, projectName: 'chromium' }],
      browser: 'chromium',
      title: 'applies the coupon',
      instanceUrl: team.url,
      clusterId: 214,
    });
    expect(JSON.stringify(desktop.received)).not.toContain(TEAM_KEY);

    // Nothing to share before the verdict.
    expect(await jobs.share('f00d')).toMatchObject({ ok: false });

    jobState = { status: 'running', jobVerdict: null };
    await jobs.poll();
    jobState = { status: 'done', jobVerdict: { kind: 'first-bad', commit: FIRST_BAD } };
    await jobs.poll();
    expect(updates.map((u) => u.status)).toEqual(['running', 'done']);
    const host = new URL(team.url).host;
    expect(updates[1]).toEqual({
      jobId: 'f00d',
      kind: 'bisect',
      status: 'done',
      message: 'The bisect names c1c1c1c as the first bad commit: Drop the coupon cache.',
      share: { label: `Share on ${host}` },
    });

    // A finished job is no longer polled.
    const reads = desktop.received.length;
    await jobs.poll();
    expect(desktop.received.length).toBe(reads);

    const shared = await jobs.share('f00d');
    expect(shared).toEqual({
      ok: true,
      message: `Shared on ${host}: the failure's fix plan names c1c1c1c as the first bad commit.`,
      url: `${team.url}/failure-clusters/214`,
    });
    const recorded = team.received.find((r) => r.method === 'POST')!;
    expect(recorded.key).toBe(TEAM_KEY);
    expect(recorded.body).toEqual(FIRST_BAD);
    jobs.dispose();
  });

  test('reports a reproduction with nothing to share, and a declined job', async () => {
    const updates: DesktopJobUpdate[] = [];
    const jobs = new DesktopJobs({ PIWI_DESKTOP_CONFIG: discovery }, (u) => updates.push(u), 60_000);
    await jobs.start({ client: instance() }, failure, 'reproduce');
    const posted = desktop.received.find((r) => r.method === 'POST')!.body as { kind: string; good: unknown };
    expect(posted).toMatchObject({ kind: 'reproduce', good: null });
    jobState = { status: 'done', jobVerdict: { kind: 'reproduced' } };
    await jobs.poll();
    expect(updates).toEqual([
      expect.objectContaining({
        status: 'done',
        message: 'Reproduced at b0b0b0b: "applies the coupon" fails on this machine too.',
        share: null,
      }),
    ]);

    await jobs.start({ client: instance() }, failure, 'bisect');
    jobState = { status: 'declined', jobVerdict: null };
    await jobs.poll();
    expect(updates[updates.length - 1]).toMatchObject({ status: 'declined', share: null });
    jobs.dispose();
  });

  test('is refused without the app, and when the team instance refuses the key', async () => {
    const none = new DesktopJobs({ PIWI_DESKTOP_CONFIG: path.join(path.dirname(discovery), 'none.json') }, () => {});
    expect(await none.start({ client: instance() }, failure, 'bisect')).toMatchObject({ ok: false });
    const jobs = new DesktopJobs({ PIWI_DESKTOP_CONFIG: discovery }, () => {});
    const wrongKey = new PiwiClient({ serverUrl: team.url, apiKey: 'pd_other', project: 'shop' });
    expect(await jobs.start({ client: wrongKey }, failure, 'bisect')).toMatchObject({ ok: false });
    expect(desktop.received.filter((r) => r.method === 'POST')).toEqual([]);
  });

  test('reads every verdict as one sentence', () => {
    expect(verdictMessage('reproduce', 't', BAD, { kind: 'not-reproduced' })).toContain('Not reproduced at b0b0b0b');
    expect(verdictMessage('bisect', 't', BAD, { kind: 'error', reason: 'npm ci failed' })).toBe(
      'The desktop app could not bisect "t": npm ci failed',
    );
    expect(verdictMessage('bisect', 't', BAD, { kind: 'stopped' })).toBe(
      'The bisect of "t" was stopped in the desktop app.',
    );
  });
});
