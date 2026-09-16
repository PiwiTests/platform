import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, vi, beforeEach } from 'vitest';

// In-memory storage so the whole trace-snapshot path (ZIP read → parse → entry
// read → aria conversion) runs without disk. `vi.hoisted` shares the map.
const { storageFiles } = vi.hoisted(() => ({ storageFiles: new Map<string, Buffer>() }));
vi.mock('../../server/storage', () => ({
  getStorage: () => ({
    readFile: async (path: string) => {
      const bytes = storageFiles.get(path);
      if (!bytes) throw new Error(`ENOENT: ${path}`);
      return bytes;
    },
  }),
}));

import {
  getTraceSnapshotsFromBlob,
  getTraceSnapshotResourceFromBlob,
  getTraceFallbackAriaTextFromBlob,
} from '~~/server/utils/trace-evidence';
import { buildZip } from '~~/server/utils/trace-zip';

const ariaBefore = JSON.stringify([{ role: 'dialog', name: 'Pay', children: [{ role: 'button', name: 'Confirm' }] }]);
const ariaAfter = JSON.stringify([
  { role: 'dialog', name: 'Pay', children: [{ role: 'button', name: 'Confirm', disabled: true }] },
]);

/** A slim trace ZIP: two actions (the second failing), each with before/after aria + screen snapshots. */
function buildSnapshotTrace(): Buffer {
  const events = [
    { type: 'before', callId: 'c1', startTime: 100, class: 'Frame', method: 'goto', pageId: 'p1' },
    { type: 'aria-snapshot', callId: 'c1', phase: 'before', file: 'aria/c1-before.json' },
    { type: 'screenshot', callId: 'c1', phase: 'before', file: 'screenshots/c1-before.png' },
    { type: 'after', callId: 'c1', endTime: 200 },
    { type: 'before', callId: 'c2', startTime: 300, class: 'Frame', method: 'click', pageId: 'p1' },
    { type: 'aria-snapshot', callId: 'c2', phase: 'before', file: 'aria/c2-before.json' },
    { type: 'screenshot', callId: 'c2', phase: 'before', file: 'screenshots/c2-before.png' },
    { type: 'aria-snapshot', callId: 'c2', phase: 'after', file: 'aria/c2-after.json' },
    { type: 'after', callId: 'c2', endTime: 1800, error: { message: 'Timeout 1500ms exceeded.' } },
  ];
  const traceText = events.map((e) => JSON.stringify(e)).join('\n');
  return buildZip([
    { name: 'trace.trace', data: Buffer.from(traceText, 'utf8') },
    { name: 'aria/c1-before.json', data: Buffer.from(JSON.stringify([{ role: 'document' }]), 'utf8') },
    { name: 'aria/c2-before.json', data: Buffer.from(ariaBefore, 'utf8') },
    { name: 'aria/c2-after.json', data: Buffer.from(ariaAfter, 'utf8') },
    { name: 'screenshots/c1-before.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    { name: 'screenshots/c2-before.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]) },
  ]);
}

const BLOB = 'project-1/blobs/snap.zip';

beforeEach(() => {
  storageFiles.clear();
  storageFiles.set(BLOB, buildSnapshotTrace());
});

describe('getTraceSnapshotsFromBlob', () => {
  test('lists per-action aria/screen availability, marks the failing step, and diffs before→failure', async () => {
    const res = await getTraceSnapshotsFromBlob(BLOB);
    expect(res.status).toBe('ok');
    expect(res.failingCallId).toBe('c2');
    expect(res.hasAria).toBe(true);
    expect(res.hasScreen).toBe(true);
    expect(res.steps).toHaveLength(2);

    const [s1, s2] = res.steps;
    expect(s1).toMatchObject({
      callId: 'c1',
      failed: false,
      aria: { before: true, after: false },
      screen: { before: true, after: false },
    });
    expect(s2).toMatchObject({
      callId: 'c2',
      failed: true,
      aria: { before: true, after: true },
      screen: { before: true, after: false },
    });

    // The failing action's dialog button flips to disabled between before and after.
    expect(res.pageDiff?.summary.changed).toBe(1);
    expect(res.pageDiff?.hunks[0]).toMatchObject({ role: 'button', name: 'Confirm' });

    // The failing step's aria tree (after phase preferred) — the page at the failure.
    expect(res.failingAriaText).toBe(['- dialog "Pay"', '  - button "Confirm" [disabled]'].join('\n'));
  });

  test('reports no-trace for a missing blob and no-snapshots when nothing was recorded', async () => {
    expect((await getTraceSnapshotsFromBlob('nope.zip')).status).toBe('no-trace');

    const plain = buildZip([
      { name: 'trace.trace', data: Buffer.from(JSON.stringify({ type: 'before', callId: 'x', startTime: 1 }), 'utf8') },
    ]);
    storageFiles.set('plain.zip', plain);
    expect((await getTraceSnapshotsFromBlob('plain.zip')).status).toBe('no-snapshots');
  });
});

describe('getTraceSnapshotResourceFromBlob', () => {
  test('serves the aria JSON and the PNG for a phase, addressed by callId', async () => {
    const aria = await getTraceSnapshotResourceFromBlob(BLOB, 'c2', 'aria', 'before');
    expect(aria?.contentType).toBe('application/json');
    expect(aria!.bytes.toString('utf8')).toBe(ariaBefore);

    const png = await getTraceSnapshotResourceFromBlob(BLOB, 'c1', 'screen', 'before');
    expect(png?.contentType).toBe('image/png');
    expect([...png!.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test('returns null for a phase that was not captured or an unknown callId', async () => {
    expect(await getTraceSnapshotResourceFromBlob(BLOB, 'c1', 'screen', 'after')).toBeNull();
    expect(await getTraceSnapshotResourceFromBlob(BLOB, 'ghost', 'aria', 'before')).toBeNull();
  });
});

describe('getTraceFallbackAriaTextFromBlob', () => {
  test("renders the failing action's before-phase aria tree as text", async () => {
    const text = await getTraceFallbackAriaTextFromBlob(BLOB);
    expect(text).toBe(['- dialog "Pay"', '  - button "Confirm"'].join('\n'));
  });
});

// An assertion failure keys the error to a runner step that carries no snapshot,
// while the page mutation lives on the preceding click. The diff must still find
// it by walking back from the failure page to the last page that differs.
describe('getTraceSnapshotsFromBlob — assertion failure (mutation on a prior step)', () => {
  const loaded = JSON.stringify([
    {
      role: 'dialog',
      name: 'Pay',
      children: [
        { role: 'button', name: 'Pay now' },
        { role: 'button', name: 'Cancel' },
      ],
    },
  ]);
  const mutated = JSON.stringify([
    { role: 'dialog', name: 'Pay', children: [{ role: 'button', name: 'Pay now', disabled: true }] },
  ]);

  beforeEach(() => {
    const events = [
      { type: 'before', callId: 'g1', startTime: 100, class: 'Frame', method: 'goto' },
      { type: 'aria-snapshot', callId: 'g1', phase: 'before', file: 'aria/g1-before.json' },
      { type: 'aria-snapshot', callId: 'g1', phase: 'after', file: 'aria/g1-after.json' },
      { type: 'after', callId: 'g1', endTime: 150 },
      { type: 'before', callId: 'k1', startTime: 200, class: 'Frame', method: 'click' },
      { type: 'aria-snapshot', callId: 'k1', phase: 'before', file: 'aria/k1-before.json' },
      { type: 'screenshot', callId: 'k1', phase: 'before', file: 'screenshots/k1-before.png' },
      { type: 'aria-snapshot', callId: 'k1', phase: 'after', file: 'aria/k1-after.json' },
      { type: 'screenshot', callId: 'k1', phase: 'after', file: 'screenshots/k1-after.png' },
      { type: 'after', callId: 'k1', endTime: 250 },
      // The assertion fails and carries the error, but no aria/screen snapshot.
      { type: 'before', callId: 'e1', startTime: 300, class: 'Frame', method: 'expect' },
      { type: 'after', callId: 'e1', endTime: 1800, error: { message: 'Timed out' } },
    ];
    const traceText = events.map((e) => JSON.stringify(e)).join('\n');
    storageFiles.set(
      'assert.zip',
      buildZip([
        { name: 'trace.trace', data: Buffer.from(traceText, 'utf8') },
        { name: 'aria/g1-before.json', data: Buffer.from(JSON.stringify([]), 'utf8') },
        { name: 'aria/g1-after.json', data: Buffer.from(loaded, 'utf8') },
        { name: 'aria/k1-before.json', data: Buffer.from(loaded, 'utf8') },
        { name: 'aria/k1-after.json', data: Buffer.from(mutated, 'utf8') },
        { name: 'screenshots/k1-before.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
        { name: 'screenshots/k1-after.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      ]),
    );
  });

  test('marks the last snapshotted step and diffs the mutation the failing assertion revealed', async () => {
    const res = await getTraceSnapshotsFromBlob('assert.zip');
    expect(res.status).toBe('ok');
    // The error is on the assertion (e1), which carries no snapshot, so the last
    // snapshotted step (the click) is the marked failure point.
    expect(res.failingCallId).toBe('k1');
    expect(res.steps.find((s) => s.failed)?.callId).toBe('k1');

    // Cancel removed and Pay disabled between the loaded page and the failure.
    expect(res.pageDiff?.summary).toMatchObject({ removed: 1, changed: 1 });

    // The marked step's after-phase aria is the failing-step page structure.
    expect(res.failingAriaText).toBe(['- dialog "Pay"', '  - button "Pay now" [disabled]'].join('\n'));
  });
});

// A real trace recorded with Playwright 1.63 `snapshots: { dom, aria, screen }`,
// the same fixture the E2E spec ingests. Guards that the recorder's real event
// and file shapes flow through the parser, storage and builders unchanged.
describe('getTraceSnapshotsFromBlob — real 1.63 fixture', () => {
  const FIXTURE = 'project-1/blobs/fixture.zip';

  beforeEach(() => {
    const path = fileURLToPath(new URL('../fixtures/trace-aria-screen-1.63.zip', import.meta.url));
    storageFiles.set(FIXTURE, readFileSync(path));
  });

  test('lists steps, marks the failing step and produces a non-empty page diff', async () => {
    const res = await getTraceSnapshotsFromBlob(FIXTURE);
    expect(res.status).toBe('ok');
    expect(res.hasAria).toBe(true);
    expect(res.hasScreen).toBe(true);
    expect(res.steps.length).toBeGreaterThanOrEqual(3);
    expect(res.steps.some((s) => s.failed)).toBe(true);

    const s = res.pageDiff?.summary;
    expect(s).toBeTruthy();
    expect(s!.added + s!.removed + s!.changed + s!.renamed + s!.moved).toBeGreaterThan(0);
  });

  test('serves an aria JSON and a screen PNG for a step', async () => {
    const res = await getTraceSnapshotsFromBlob(FIXTURE);
    const withScreen = res.steps.find((step) => step.screen.before)!;
    const png = await getTraceSnapshotResourceFromBlob(FIXTURE, withScreen.callId, 'screen', 'before');
    expect(png?.contentType).toBe('image/png');
    expect([...png!.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const withAria = res.steps.find((step) => step.aria.before)!;
    const aria = await getTraceSnapshotResourceFromBlob(FIXTURE, withAria.callId, 'aria', 'before');
    expect(aria?.contentType).toBe('application/json');
    expect(() => JSON.parse(aria!.bytes.toString('utf8'))).not.toThrow();
  });
});
