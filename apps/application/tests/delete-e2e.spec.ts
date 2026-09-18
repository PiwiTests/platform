import { test, expect, type APIRequestContext } from './fixtures';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PROJECT } from '#shared/test-project-names';

/**
 * End-to-end deletion coverage for runs that carry real evidence (a trace, so a
 * blob + shared resources + a `files` row, and a failing case, so a failure
 * cluster) and for deleting a whole project. The pre-existing delete test only
 * covered a bare run with no files; the paths that touch storage, blob
 * refcounting and cluster recompute went unexercised. Dialect-agnostic — it
 * asserts through the API, so the same spec validates SQLite and PostgreSQL.
 */

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

// A real committed trace with resources — populates trace_blobs AND trace_resources.
const traceZip = readFileSync('public/demo/traces/checkout-pay-timeout.zip');
const traceHash = sha256(traceZip);

async function uploadRunWithEvidence(request: APIRequestContext, projectName: string) {
  const response = await request.post('/api/test-runs/upload', {
    multipart: {
      projectName,
      testRun: JSON.stringify({
        status: 'failed',
        startTime: new Date().toISOString(),
        duration: 5000,
        totalTests: 1,
        passedTests: 0,
        failedTests: 1,
        skippedTests: 0,
      }),
      testCases: JSON.stringify([
        {
          title: 'evidence case that fails',
          status: 'failed',
          duration: 1200,
          location: 'tests/evidence.spec.ts:7:3',
          error: 'Error: expected true to be false\n    at tests/evidence.spec.ts:7:3',
        },
      ]),
      trace_0: { name: 'trace.zip', mimeType: 'application/zip', buffer: traceZip },
      trace_hashes: JSON.stringify({ 0: traceHash }),
    },
  });
  expect(response.ok(), `upload failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
}

test.describe.serial('Delete a run that has evidence', () => {
  let runId: number;
  let projectId: number;
  // The trace is content-addressed and deduped: its stored path is deterministic.
  let blobPath: string;

  test('upload a run with a trace and a failing case', async ({ request }) => {
    const data = await uploadRunWithEvidence(request, PROJECT.DELETE_EVIDENCE);
    runId = data.runId;
    projectId = data.projectId;
    expect(runId).toBeTruthy();
    blobPath = `project-${projectId}/blobs/${traceHash}.zip`;

    // The stored trace is served (reconstructed from the slim blob + resources)
    // before deletion.
    const traceResponse = await request.get(`/api/files/${blobPath}`);
    expect(traceResponse.ok(), `trace downloadable before deletion: ${traceResponse.status()}`).toBeTruthy();
  });

  test('deleting the run removes the run, its cases and its trace', async ({ request }) => {
    const del = await request.delete(`/api/test-runs/${runId}`);
    expect(del.ok(), `delete failed: ${del.status()} ${await del.text()}`).toBeTruthy();
    expect((await del.json()).success).toBe(true);

    // The run itself is gone.
    expect((await request.get(`/api/test-runs/${runId}`)).status()).toBe(404);

    // It no longer appears in the project's run list.
    const project = await (await request.get(`/api/projects/${projectId}`)).json();
    expect(project.testRuns?.some((r: { id: number }) => r.id === runId)).toBeFalsy();

    // The trace evidence is gone from storage (last reference removed).
    expect((await request.get(`/api/files/${blobPath}`)).status()).toBe(404);
  });
});

/** Upload a run whose `caseCount` cases all point at the same shared trace blob. */
async function uploadRunSharingOneTrace(request: APIRequestContext, projectName: string, caseCount: number) {
  const multipart: Record<string, unknown> = {
    projectName,
    testRun: JSON.stringify({
      status: 'failed',
      startTime: new Date().toISOString(),
      duration: 5000,
      totalTests: caseCount,
      passedTests: 0,
      failedTests: caseCount,
      skippedTests: 0,
    }),
    testCases: JSON.stringify(
      Array.from({ length: caseCount }, (_, i) => ({
        title: `shared-trace case ${i}`,
        status: 'failed',
        duration: 1000,
        location: `tests/shared.spec.ts:${i + 1}:1`,
        error: `boom ${i}`,
      })),
    ),
    trace_hashes: JSON.stringify(Object.fromEntries(Array.from({ length: caseCount }, (_, i) => [i, traceHash]))),
  };
  // Same bytes for every case → one deduplicated blob, `caseCount` files rows.
  for (let i = 0; i < caseCount; i++) {
    multipart[`trace_${i}`] = { name: 'trace.zip', mimeType: 'application/zip', buffer: traceZip };
  }
  const response = await request.post('/api/test-runs/upload', { multipart });
  expect(response.ok(), `upload failed: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json();
}

test.describe.serial('Deleting frees a shared trace blob (no leak)', () => {
  test('a run whose cases share one blob frees it on delete', async ({ request }) => {
    const data = await uploadRunSharingOneTrace(request, PROJECT.DELETE_SHARED_BLOB, 2);
    const blobPath = `project-${data.projectId}/blobs/${traceHash}.zip`;
    expect((await request.get(`/api/files/${blobPath}`)).ok()).toBeTruthy();

    expect((await request.delete(`/api/test-runs/${data.runId}`)).ok()).toBeTruthy();

    // The blob must be gone — the two cases were its only references.
    expect((await request.get(`/api/files/${blobPath}`)).status()).toBe(404);
  });

  test('a blob shared across two runs survives deleting one, and is freed with the last', async ({ request }) => {
    const first = await uploadRunSharingOneTrace(request, PROJECT.DELETE_SHARED_BLOB, 1);
    const second = await uploadRunSharingOneTrace(request, PROJECT.DELETE_SHARED_BLOB, 1);
    const blobPath = `project-${first.projectId}/blobs/${traceHash}.zip`;
    expect((await request.get(`/api/files/${blobPath}`)).ok()).toBeTruthy();

    // Deleting the first run must NOT remove a blob the second still references.
    expect((await request.delete(`/api/test-runs/${first.runId}`)).ok()).toBeTruthy();
    expect(
      (await request.get(`/api/files/${blobPath}`)).ok(),
      'blob kept while a run still references it',
    ).toBeTruthy();

    // Deleting the last referencing run frees it.
    expect((await request.delete(`/api/test-runs/${second.runId}`)).ok()).toBeTruthy();
    expect((await request.get(`/api/files/${blobPath}`)).status()).toBe(404);
  });
});

test.describe.serial('Delete a whole project', () => {
  let projectId: number;
  let runId: number;

  test('create a project with an evidence-bearing run', async ({ request }) => {
    const data = await uploadRunWithEvidence(request, PROJECT.DELETE_PROJECT);
    projectId = data.projectId;
    runId = data.runId;
    expect(projectId).toBeTruthy();
    expect((await request.get(`/api/projects/${projectId}`)).ok()).toBeTruthy();
  });

  test('deleting the project removes the project and its runs', async ({ request }) => {
    const del = await request.delete(`/api/projects/${projectId}`);
    expect(del.ok(), `project delete failed: ${del.status()} ${await del.text()}`).toBeTruthy();
    expect((await del.json()).success).toBe(true);

    expect((await request.get(`/api/projects/${projectId}`)).status()).toBe(404);
    expect((await request.get(`/api/test-runs/${runId}`)).status()).toBe(404);
  });
});
