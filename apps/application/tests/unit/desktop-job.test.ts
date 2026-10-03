import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../server/database/schema.sqlite';
import { parseReproRequest } from '#shared/desktop-repro';
import { createReproRequest, getReproRequest, updateReproRequest } from '../../server/utils/desktop-repro';
import { getProjectLatestRun } from '#shared/handlers/test-runs';
import { desktopJobVerdict, localRunOriginKind, newLocalRunRef, type JobRunOutcome } from '../../app/utils/desktop-job';
import { parseRunOriginRef } from '@piwitests/core/wire';
import { openTempDb, type TempDb } from './temp-db';

delete process.env.PIWI_DATABASE_URL;

const BAD = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0';
const GOOD = 'a0a0a0a';

const bisectJob = {
  kind: 'bisect',
  commit: BAD.toUpperCase(),
  good: GOOD,
  tests: [{ filePath: 'tests\\cart.spec.ts', title: 'applies the coupon', line: 12, projectName: 'chromium' }],
  browser: 'chromium',
  title: 'applies the coupon',
  instanceUrl: 'https://piwi.example.com/',
  clusterId: 214,
};

describe('an editor job request', () => {
  it('reads a bisect: commits lower-cased, paths with forward slashes, the instance without its trailing slash', () => {
    const parsed = parseReproRequest('application/json', bisectJob);
    expect(parsed).toEqual({
      ok: true,
      request: {
        kind: 'bisect',
        job: {
          commit: BAD,
          good: GOOD,
          tests: [{ filePath: 'tests/cart.spec.ts', title: 'applies the coupon', line: 12, projectName: 'chromium' }],
          browser: 'chromium',
          clusterId: 214,
        },
        title: 'applies the coupon',
        instanceUrl: 'https://piwi.example.com',
      },
    });
  });

  it('refuses what is not a commit, a test path that could be a flag or leave the folder, and a bisect with no good end', () => {
    const refused = (patch: Record<string, unknown>) =>
      parseReproRequest('application/json', { ...bisectJob, ...patch });
    expect(refused({ commit: 'HEAD~3' })).toMatchObject({ ok: false, statusCode: 400 });
    expect(refused({ good: null })).toMatchObject({ ok: false, statusCode: 400 });
    expect(refused({ instanceUrl: 'file:///etc' })).toMatchObject({ ok: false, statusCode: 400 });
    expect(refused({ tests: [] })).toMatchObject({ ok: false, statusCode: 400 });
    for (const filePath of ['--config=evil.ts', '/etc/passwd', 'C:\\x.spec.ts', '../outside.spec.ts']) {
      expect(refused({ tests: [{ filePath, title: 't' }] })).toMatchObject({ ok: false, statusCode: 400 });
    }
    expect(
      refused({ tests: [{ filePath: 'a.spec.ts', title: 't', projectName: 'x --config=evil.ts' }] }),
    ).toMatchObject({ ok: false });
    expect(parseReproRequest('text/plain', bisectJob)).toMatchObject({ ok: false, statusCode: 415 });
  });

  it('reads a reproduction without a good commit', () => {
    const parsed = parseReproRequest('application/json', { ...bisectJob, kind: 'reproduce', good: undefined });
    expect(parsed).toMatchObject({ ok: true, request: { kind: 'reproduce', job: { commit: BAD, good: null } } });
  });

  it('waits for the window, then carries the verdict for the editor to read', () => {
    const parsed = parseReproRequest('application/json', bisectJob);
    if (!parsed.ok) throw new Error(parsed.message);
    const request = createReproRequest(parsed.request);
    expect(request).toMatchObject({ kind: 'bisect', status: 'waiting', steps: null, jobVerdict: null });
    expect(updateReproRequest(request.id, { status: 'running', projectId: 3 })?.status).toBe('running');
    const commit = { sha: BAD, subject: 'Drop the coupon cache', author: 'Ada', date: null };
    updateReproRequest(request.id, { status: 'done', jobVerdict: { kind: 'first-bad', commit } });
    expect(getReproRequest(request.id)).toMatchObject({
      status: 'done',
      jobVerdict: { kind: 'first-bad', commit },
      job: { clusterId: 214 },
      instanceUrl: 'https://piwi.example.com',
    });
  });
});

describe('desktopJobVerdict', () => {
  const run = (patch: Partial<JobRunOutcome>): JobRunOutcome => ({
    kind: 'reproduce',
    status: 'failed',
    phase: 'test',
    bisect: null,
    lines: [],
    ...patch,
  });

  it('reads a reproduction from how its tests ended', () => {
    expect(desktopJobVerdict(run({ status: 'failed' }))).toEqual({ kind: 'reproduced' });
    expect(desktopJobVerdict(run({ status: 'passed' }))).toEqual({ kind: 'not-reproduced' });
    expect(desktopJobVerdict(run({ status: 'stopped' }))).toEqual({ kind: 'stopped' });
    expect(desktopJobVerdict(run({ phase: 'install', lines: [{ text: 'npm ci failed', error: true }] }))).toEqual({
      kind: 'error',
      reason: 'npm ci failed',
    });
  });

  it('reads a bisect from the commit it named', () => {
    const firstBad = { sha: BAD, subject: 'Drop the cache', author: null, date: null };
    expect(desktopJobVerdict(run({ kind: 'bisect', phase: 'bisect', bisect: { firstBad } }))).toEqual({
      kind: 'first-bad',
      commit: firstBad,
    });
    expect(desktopJobVerdict(run({ kind: 'bisect', bisect: { firstBad: null } }))).toMatchObject({ kind: 'error' });
  });
});

describe('linking a local run by its origin reference', () => {
  let db: TempDb;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await openTempDb());
    await db.insert(schema.projects).values({ id: 1, name: 'shop' });
  });
  afterEach(async () => {
    await close();
  });

  it('finds the run stamped with the reference, not the newest run of the project', async () => {
    const mine = newLocalRunRef('desktop');
    const theirs = newLocalRunRef('desktop');
    expect(parseRunOriginRef(mine)).toBe(mine);
    expect(mine).not.toBe(theirs);
    const at = (s: number) => new Date(Date.UTC(2026, 9, 3, 10, 0, s));
    await db.insert(schema.testRuns).values([
      {
        id: 10,
        projectId: 1,
        status: 'passed',
        startTime: at(1),
        metadata: { piwiOrigin: { kind: 'desktop', ref: mine } },
      },
      {
        id: 11,
        projectId: 1,
        status: 'failed',
        startTime: at(2),
        metadata: { piwiOrigin: { kind: 'desktop', ref: theirs } },
      },
      {
        id: 12,
        projectId: 1,
        status: 'failed',
        startTime: at(3),
        metadata: { piwiOrigin: { kind: 'reproduce', ref: '7' } },
      },
      {
        id: 13,
        projectId: 1,
        status: 'failed',
        startTime: at(4),
        metadata: { piwiOrigin: { kind: 'bisect', ref: '7' } },
      },
    ]);
    expect(await getProjectLatestRun(db, 1)).toEqual({ id: 13, status: 'failed' });
    expect(await getProjectLatestRun(db, 1, { kind: 'desktop', ref: mine })).toEqual({ id: 10, status: 'passed' });
    expect(await getProjectLatestRun(db, 1, { kind: 'reproduce', ref: '7' })).toEqual({ id: 12, status: 'failed' });
    expect(await getProjectLatestRun(db, 1, { kind: 'desktop', ref: 'desktop:none' })).toBeNull();
    expect(await getProjectLatestRun(db, 1, { kind: 'desktop', ref: '%' })).toBeNull();
  });

  it('stamps a test run as desktop, a reproduction and a repro request as reproduce, and links no lab session', () => {
    expect(localRunOriginKind('tests')).toBe('desktop');
    expect(localRunOriginKind('reproduce')).toBe('reproduce');
    expect(localRunOriginKind('repro')).toBe('reproduce');
    expect(localRunOriginKind('bisect')).toBe('bisect');
    expect(localRunOriginKind('flake')).toBeNull();
  });
});
