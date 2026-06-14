import { test, expect, type APIRequestContext } from './fixtures';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PROJECT } from '../shared/test-project-names';
import { buildZip, parseZip } from '../server/utils/trace-zip';

/**
 * Tests for live per-case file uploads during a streaming run:
 *   POST /api/test-runs/:id/case-files — upload a trace + attachments for a
 *   single test case as soon as it finishes, while the run is still running.
 */
test.describe.serial('Live case file uploads', () => {
  let runId: number;
  let streamToken: string;
  let caseWithFilesId: number;
  let dedupCaseId: number;

  const traceContent = Buffer.from('Mock Playwright live trace data');
  const traceHash = createHash('sha256').update(traceContent).digest('hex');
  const screenshotContent = Buffer.from('PNG mock screenshot bytes');

  const caseWithFiles = {
    title: 'live test with files',
    location: 'tests/live.spec.ts:5:3',
    retries: 0,
  };
  const dedupCase = {
    title: 'live test reusing trace',
    location: 'tests/live.spec.ts:15:3',
    retries: 0,
  };

  test('start a streaming run and push test cases', async ({ request }) => {
    const startResponse = await request.post('/api/test-runs/start', {
      data: {
        projectName: PROJECT.CASE_FILES_LIVE,
        startTime: new Date().toISOString(),
      },
    });
    expect(startResponse.ok()).toBeTruthy();
    const startData = await startResponse.json();
    runId = startData.runId;
    streamToken = startData.streamToken;

    const eventsResponse = await request.post(`/api/test-runs/${runId}/events`, {
      data: {
        streamToken,
        testCases: [
          { ...caseWithFiles, status: 'passed', duration: 1200 },
          { ...dedupCase, status: 'passed', duration: 700 },
        ],
      },
    });
    expect(eventsResponse.ok()).toBeTruthy();
  });

  test('uploads a trace and an attachment for a running case', async ({ request }) => {
    const response = await request.post(`/api/test-runs/${runId}/case-files`, {
      multipart: {
        streamToken,
        testCase: JSON.stringify(caseWithFiles),
        trace_hash: traceHash,
        trace: {
          name: 'trace.zip',
          mimeType: 'application/zip',
          buffer: traceContent,
        },
        attach_meta: JSON.stringify([{ name: 'screenshot', contentType: 'image/png', originalName: 'failure.png' }]),
        attach_file: {
          name: 'failure.png',
          mimeType: 'image/png',
          buffer: screenshotContent,
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(typeof data.testRunsCaseId).toBe('number');
    expect(data.traces).toBe(1);
    expect(data.attachments).toBe(1);
    caseWithFilesId = data.testRunsCaseId;
  });

  test('trace and attachment are immediately listed for the case', async ({ request }) => {
    const tracesResponse = await request.get(`/api/test-cases/${caseWithFilesId}/traces`);
    expect(tracesResponse.ok()).toBeTruthy();
    const traces = await tracesResponse.json();
    expect(traces.length).toBe(1);
    expect(traces[0].filePath).toBeDefined();

    const caseResponse = await request.get(`/api/test-cases/${caseWithFilesId}`);
    expect(caseResponse.ok()).toBeTruthy();
    const caseData = await caseResponse.json();
    expect(caseData.attachments.length).toBe(1);
    expect(caseData.attachments[0].name).toBe('screenshot');
    expect(caseData.attachments[0].contentType).toBe('image/png');

    // The run is still running — live uploads must not require finish
    const runResponse = await request.get(`/api/test-runs/${runId}`);
    const runData = await runResponse.json();
    expect(runData.status).toBe('running');
  });

  test('repeated upload for the same case is idempotent', async ({ request }) => {
    const response = await request.post(`/api/test-runs/${runId}/case-files`, {
      multipart: {
        streamToken,
        testCase: JSON.stringify(caseWithFiles),
        trace_hash: traceHash,
        trace: {
          name: 'trace.zip',
          mimeType: 'application/zip',
          buffer: traceContent,
        },
        attach_meta: JSON.stringify([{ name: 'screenshot', contentType: 'image/png', originalName: 'failure.png' }]),
        attach_file: {
          name: 'failure.png',
          mimeType: 'image/png',
          buffer: screenshotContent,
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.traces).toBe(0);
    expect(data.attachments).toBe(0);

    const traces = await (await request.get(`/api/test-cases/${caseWithFilesId}/traces`)).json();
    expect(traces.length).toBe(1);
  });

  test('links an existing trace blob by hash without resending the file', async ({ request }) => {
    const response = await request.post(`/api/test-runs/${runId}/case-files`, {
      multipart: {
        streamToken,
        testCase: JSON.stringify(dedupCase),
        trace_hash: traceHash,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.traces).toBe(1);
    dedupCaseId = data.testRunsCaseId;

    const traces = await (await request.get(`/api/test-cases/${dedupCaseId}/traces`)).json();
    expect(traces.length).toBe(1);
  });

  test('returns 422 for an unknown trace hash without a file', async ({ request }) => {
    const response = await request.post(`/api/test-runs/${runId}/case-files`, {
      multipart: {
        streamToken,
        testCase: JSON.stringify({ title: 'live test with files', location: 'tests/live.spec.ts:5:3', retries: 1 }),
        trace_hash: 'f'.repeat(64),
      },
    });

    // retries: 1 row does not exist either — 404 wins before the blob lookup
    expect(response.status()).toBe(404);

    // Now against an existing case but with an unknown hash: push the row first
    await request.post(`/api/test-runs/${runId}/events`, {
      data: {
        streamToken,
        testCases: [
          {
            title: 'retried live test',
            location: 'tests/live.spec.ts:25:3',
            status: 'passed',
            duration: 100,
            retries: 0,
          },
        ],
      },
    });
    const unknownHashResponse = await request.post(`/api/test-runs/${runId}/case-files`, {
      multipart: {
        streamToken,
        testCase: JSON.stringify({ title: 'retried live test', location: 'tests/live.spec.ts:25:3', retries: 0 }),
        trace_hash: 'f'.repeat(64),
      },
    });
    expect(unknownHashResponse.status()).toBe(422);
  });

  test('rejects wrong or missing stream token', async ({ request }) => {
    const wrongToken = await request.post(`/api/test-runs/${runId}/case-files`, {
      multipart: {
        streamToken: 'wrong-token',
        testCase: JSON.stringify(caseWithFiles),
        trace: { name: 'trace.zip', mimeType: 'application/zip', buffer: traceContent },
      },
    });
    expect(wrongToken.status()).toBe(403);

    const missingToken = await request.post(`/api/test-runs/${runId}/case-files`, {
      multipart: {
        testCase: JSON.stringify(caseWithFiles),
        trace: { name: 'trace.zip', mimeType: 'application/zip', buffer: traceContent },
      },
    });
    expect(missingToken.status()).toBe(401);
  });

  test('returns 404 for a case that was never streamed', async ({ request }) => {
    const response = await request.post(`/api/test-runs/${runId}/case-files`, {
      multipart: {
        streamToken,
        testCase: JSON.stringify({ title: 'ghost test', location: 'tests/ghost.spec.ts:1:1', retries: 0 }),
        trace: { name: 'trace.zip', mimeType: 'application/zip', buffer: traceContent },
      },
    });
    expect(response.status()).toBe(404);
  });

  test('files remain accessible after the run finishes and uploads are rejected', async ({ request }) => {
    const finishResponse = await request.post(`/api/test-runs/${runId}/finish`, {
      data: {
        streamToken,
        status: 'passed',
        duration: 5000,
        totalTests: 3,
        passedTests: 3,
        failedTests: 0,
        skippedTests: 0,
      },
    });
    expect(finishResponse.ok()).toBeTruthy();

    const traces = await (await request.get(`/api/test-cases/${caseWithFilesId}/traces`)).json();
    expect(traces.length).toBe(1);

    // Live uploads require a running run
    const lateUpload = await request.post(`/api/test-runs/${runId}/case-files`, {
      multipart: {
        streamToken,
        testCase: JSON.stringify(caseWithFiles),
        trace: { name: 'trace.zip', mimeType: 'application/zip', buffer: traceContent },
      },
    });
    expect(lateUpload.status()).toBe(409);
  });

  test('uploaded trace is downloadable with CORS headers for the trace viewer', async ({ request }) => {
    const traces = await (await request.get(`/api/test-cases/${caseWithFilesId}/traces`)).json();
    const response = await request.get(`/api/files/${traces[0].filePath}`);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['access-control-allow-origin']).toBe('*');
  });
});

test.describe.serial('Live upload trace resource deduplication', () => {
  let runId: number;
  let streamToken: string;

  /** Build a minimal valid Playwright-like trace ZIP with resources/. */
  function buildTraceZip(resources: Array<{ name: string; data: Buffer }>): Buffer {
    return buildZip([
      { name: 'trace.trace', data: Buffer.from('{"type":"contextOptions","callId":"ctx@1"}\n') },
      { name: 'trace.network', data: Buffer.from('') },
      ...resources.map((r) => ({ name: `resources/${r.name}`, data: r.data })),
    ]);
  }

  const sharedResource = { name: 'shared-resource.dat', data: Buffer.from('shared resource payload for live dedup') };
  const zipA = buildTraceZip([sharedResource, { name: 'only-a.dat', data: Buffer.from('payload A') }]);
  const zipB = buildTraceZip([sharedResource, { name: 'only-b.dat', data: Buffer.from('payload B') }]);
  const hashA = createHash('sha256').update(zipA).digest('hex');
  const hashB = createHash('sha256').update(zipB).digest('hex');

  const caseA = { title: 'live dedup case A', location: 'tests/live-dedup.spec.ts:5:3', retries: 0 };
  const caseB = { title: 'live dedup case B', location: 'tests/live-dedup.spec.ts:15:3', retries: 0 };

  async function uploadTrace(request: APIRequestContext, testCase: object, zip: Buffer, hash: string) {
    return request.post(`/api/test-runs/${runId}/case-files`, {
      multipart: {
        streamToken,
        testCase: JSON.stringify(testCase),
        trace_hash: hash,
        trace: { name: 'trace.zip', mimeType: 'application/zip', buffer: zip },
      },
    });
  }

  async function downloadTraceEntries(request: APIRequestContext, testCase: { title: string }) {
    const runData = await (await request.get(`/api/test-runs/${runId}`)).json();
    const runCase = runData.testCases.find((tc: { title: string }) => tc.title === testCase.title);
    expect(runCase).toBeDefined();
    const traces = await (await request.get(`/api/test-cases/${runCase.id}/traces`)).json();
    expect(traces.length).toBe(1);
    const response = await request.get(`/api/files/${traces[0].filePath}`);
    expect(response.ok()).toBeTruthy();
    return await parseZip(Buffer.from(await response.body()));
  }

  test('start a streaming run and push the cases', async ({ request }) => {
    const startResponse = await request.post('/api/test-runs/start', {
      data: {
        projectName: PROJECT.CASE_FILES_LIVE,
        startTime: new Date().toISOString(),
      },
    });
    expect(startResponse.ok()).toBeTruthy();
    const startData = await startResponse.json();
    runId = startData.runId;
    streamToken = startData.streamToken;

    const eventsResponse = await request.post(`/api/test-runs/${runId}/events`, {
      data: {
        streamToken,
        testCases: [
          { ...caseA, status: 'passed', duration: 1000 },
          { ...caseB, status: 'passed', duration: 1000 },
        ],
      },
    });
    expect(eventsResponse.ok()).toBeTruthy();
  });

  test('both live-uploaded traces are reconstructed with their resources', async ({ request }) => {
    // Upload A first so its resources land in the shared pool, then B whose
    // shared resource should be deduplicated against the pool
    expect((await uploadTrace(request, caseA, zipA, hashA)).ok()).toBeTruthy();
    expect((await uploadTrace(request, caseB, zipB, hashB)).ok()).toBeTruthy();

    const entriesA = await downloadTraceEntries(request, caseA);
    const entriesB = await downloadTraceEntries(request, caseB);

    // Event entries survive the slim-zip rewrite
    expect(entriesA.find((e) => e.name === 'trace.trace')).toBeDefined();
    expect(entriesB.find((e) => e.name === 'trace.trace')).toBeDefined();

    // Each trace keeps its unique resource
    expect(entriesA.find((e) => e.name === 'resources/only-a.dat')).toBeDefined();
    expect(entriesB.find((e) => e.name === 'resources/only-b.dat')).toBeDefined();

    // The shared resource is reconstructed identically in both, served from
    // the shared per-project pool
    const sharedA = entriesA.find((e) => e.name === 'resources/shared-resource.dat');
    const sharedB = entriesB.find((e) => e.name === 'resources/shared-resource.dat');
    expect(sharedA).toBeDefined();
    expect(sharedB).toBeDefined();
    expect(Buffer.compare(sharedA!.data, sharedB!.data)).toBe(0);
    expect(Buffer.compare(sharedA!.data, sharedResource.data)).toBe(0);
  });

  test('finish the dedup run', async ({ request }) => {
    const finishResponse = await request.post(`/api/test-runs/${runId}/finish`, {
      data: {
        streamToken,
        status: 'passed',
        duration: 2000,
        totalTests: 2,
        passedTests: 2,
        failedTests: 0,
        skippedTests: 0,
      },
    });
    expect(finishResponse.ok()).toBeTruthy();
  });
});

/**
 * Run a CommonJS reporter script in a dedicated Node.js subprocess.
 * The reporter package is CommonJS and cannot be imported directly from this
 * ESM test file, so we pipe the script as stdin to `node --input-type=commonjs`.
 */
function runReporterScript(cjsScript: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveP) => {
    const proc = spawn('node', ['--input-type=commonjs'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on('close', (code) => resolveP({ exitCode: code ?? 0, stdout, stderr }));
    proc.stdin!.write(cjsScript);
    proc.stdin!.end();
  });
}

test.describe.serial('Reporter live upload end-to-end', () => {
  test('the real reporter uploads trace and attachment while the run is still running', async ({ request }) => {
    test.setTimeout(60_000);

    const tempDir = join(process.cwd(), '.test-temp', 'live-upload-e2e');
    mkdirSync(tempDir, { recursive: true });
    const tracePath = join(tempDir, 'trace.zip');
    const screenshotPath = join(tempDir, 'screenshot.png');
    // Unique trace content so the blob is uploaded (not deduped from a prior run)
    writeFileSync(tracePath, `live e2e trace data ${Date.now()}`);
    writeFileSync(screenshotPath, 'PNG live e2e screenshot bytes');

    const reporterPath = resolve(process.cwd(), '..', 'reporter', 'dist', 'index.js');
    const testFilePath = join(process.cwd(), 'tests', 'live-e2e.spec.ts');

    const { exitCode, stdout, stderr } = await runReporterScript(`
      const PiwiDashboardReporter = require(${JSON.stringify(reporterPath)});
      const BASE = 'http://localhost:3000';
      const PROJECT_NAME = ${JSON.stringify(PROJECT.REPORTER_LIVE_UPLOAD)};

      const reporter = new PiwiDashboardReporter({
        serverUrl: BASE,
        projectName: PROJECT_NAME,
        streaming: true,
        liveFileUploads: true,
        uploadTraces: true,
        uploadReport: false,
        collectScmInfo: false,
        collectCiInfo: false,
        collectPerformanceMetrics: false,
        verbose: false
      });

      async function getJSON(path) {
        const res = await fetch(BASE + path);
        if (!res.ok) throw new Error(path + ' -> ' + res.status);
        return res.json();
      }

      // Poll the public API until the trace + attachment are visible,
      // capturing the run status at that exact moment.
      async function pollForFiles() {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          try {
            const runs = await getJSON('/api/test-runs/recent');
            const run = runs.find(r => r.projectName === PROJECT_NAME);
            if (run) {
              const detail = await getJSON('/api/test-runs/' + run.id);
              const runCase = (detail.testCases || []).find(tc => tc.title === 'live e2e test');
              if (runCase) {
                const traces = await getJSON('/api/test-cases/' + runCase.id + '/traces');
                const caseData = await getJSON('/api/test-cases/' + runCase.id);
                const attachments = caseData.attachments || [];
                if (traces.length > 0 && attachments.length > 0) {
                  return {
                    runId: run.id,
                    caseId: runCase.id,
                    traces: traces.length,
                    attachments: attachments.length,
                    attachmentName: attachments[0].name,
                    runStatusWhenVisible: detail.status
                  };
                }
              }
            }
          } catch {}
          await new Promise(r => setTimeout(r, 250));
        }
        return null;
      }

      reporter.onBegin(
        { projects: [], workers: 1, timeout: 30000, fullyParallel: false },
        { allTests: () => [] }
      );
      reporter.onTestEnd(
        { title: 'live e2e test', location: { file: ${JSON.stringify(testFilePath)}, line: 5, column: 3 } },
        {
          status: 'passed', duration: 500, error: null, retry: 0, steps: [],
          attachments: [
            { name: 'trace', path: ${JSON.stringify(tracePath)}, contentType: 'application/zip' },
            { name: 'screenshot', path: ${JSON.stringify(screenshotPath)}, contentType: 'image/png' }
          ]
        }
      );

      pollForFiles().then(result => {
        if (!result) {
          console.error('Files never became visible while the run was in progress');
          process.exit(2);
        }
        console.log('E2E_RESULT ' + JSON.stringify(result));
        return reporter.onEnd({ status: 'passed' });
      }).then(() => {
        process.exit(0);
      }).catch(err => {
        console.error((err && err.stack) || String(err));
        process.exit(1);
      });
    `);

    expect(exitCode, `Reporter subprocess failed:\nstdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);

    const markerLine = stdout.split('\n').find((line) => line.startsWith('E2E_RESULT '));
    expect(markerLine, `No E2E_RESULT marker in output:\n${stdout}`).toBeDefined();
    const result = JSON.parse(markerLine!.slice('E2E_RESULT '.length));

    // Files were visible via the API before the run finished
    expect(result.runStatusWhenVisible).toBe('running');
    expect(result.traces).toBe(1);
    expect(result.attachments).toBe(1);
    expect(result.attachmentName).toBe('screenshot');

    // After onEnd, the run is finished and the files persist
    const runData = await (await request.get(`/api/test-runs/${result.runId}`)).json();
    expect(runData.status).toBe('passed');

    const traces = await (await request.get(`/api/test-cases/${result.caseId}/traces`)).json();
    expect(traces.length).toBe(1);
    const caseData = await (await request.get(`/api/test-cases/${result.caseId}`)).json();
    expect(caseData.attachments.length).toBe(1);
  });
});
