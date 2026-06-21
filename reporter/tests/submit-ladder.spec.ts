import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PiwiDashboardReporter } from '../src/reporter.js';
import {
  startServer,
  jsonRes,
  textRes,
  urlsHit,
  fakeConfig,
  fakeSuite,
  fakeTestCase,
  fakeResult,
  type FakeServer,
} from './_helpers.js';

const RECOVERY_PREFIX = 'piwi-dashboard-recovery-';
const STREAM_PREFIX = 'piwi-dashboard-stream-';
const SETUP_PREFIX = 'piwi-dashboard-setup-';

function cleanupProjectArtifacts(projectName: string): void {
  // Recovery and stream-buffer files are keyed by a sha1 of the project name.
  // We don't know the hash here, so sweep tmpdir for piwi-dashboard-* files
  // matching this test run's marker.
  const tmp = os.tmpdir();
  for (const f of fs.readdirSync(tmp)) {
    if (f.startsWith(RECOVERY_PREFIX) || f.startsWith(STREAM_PREFIX) || f.startsWith(SETUP_PREFIX)) {
      if (f.includes(projectName)) {
        try {
          fs.unlinkSync(path.join(tmp, f));
        } catch {
          /* ignore */
        }
      }
    }
  }
}

async function runOneTest(reporter: PiwiDashboardReporter, title: string, status = 'passed'): Promise<void> {
  const suite = fakeSuite();
  const test = fakeTestCase({ title, parent: suite });
  suite.allTests = () => [test];
  reporter.onBegin(fakeConfig(), suite);
  reporter.onTestBegin(test, fakeResult({ workerIndex: 0 }));
  reporter.onTestEnd(test, fakeResult({ status, duration: 5, workerIndex: 0 }));
  await reporter.onEnd({ status: 'passed' } as any);
}

describe('PiwiDashboardReporter submit/fallback ladder', () => {
  let server: FakeServer;
  const projectName = 'piwi-ladder-' + process.pid;

  beforeEach(() => {
    cleanupProjectArtifacts(projectName);
  });

  afterEach(async () => {
    if (server) await server.close();
    cleanupProjectArtifacts(projectName);
  });

  it('streaming success path: /start → /events → /finish', async () => {
    let eventsBody: any;
    let finishBody: any;
    server = await startServer((req, res) => {
      if (req.url === '/api/test-runs/start') {
        jsonRes(res, 200, { runId: 1, streamToken: 'tok-123' });
      } else if (req.url === '/api/test-runs/1/events') {
        eventsBody = JSON.parse(req.body);
        jsonRes(res, 200, {});
      } else if (req.url === '/api/test-runs/1/finish') {
        finishBody = JSON.parse(req.body);
        jsonRes(res, 200, {});
      } else if (req.url === '/api/auth/me') {
        jsonRes(res, 200, {});
      } else {
        textRes(res, 404, 'nope');
      }
    });

    const reporter = new PiwiDashboardReporter({
      serverUrl: server.url,
      projectName,
      streaming: true,
      uploadReport: false,
      uploadTraces: false,
      liveFileUploads: false,
      streamingBatchDelay: 50,
    });
    await runOneTest(reporter, 'streaming-test');

    const urls = urlsHit(server).filter((u) => u !== '/api/auth/me');
    assert.ok(urls.includes('/api/test-runs/start'), `urls: ${urls.join(', ')}`);
    assert.ok(urls.includes('/api/test-runs/1/events'), `urls: ${urls.join(', ')}`);
    assert.ok(urls.includes('/api/test-runs/1/finish'), `urls: ${urls.join(', ')}`);
    assert.ok(!urls.includes('/api/test-runs/submit'));
    assert.ok(!urls.includes('/api/test-runs/upload'));

    // finish body carries the run status + counters
    assert.equal(finishBody.status, 'passed');
    assert.equal(finishBody.streamToken, 'tok-123');
    assert.equal(finishBody.totalTests, 1);
    assert.equal(finishBody.passedTests, 1);
    // events body carries testCases array
    assert.ok(Array.isArray(eventsBody.testCases));
    assert.ok(eventsBody.testCases.length >= 1);
  });

  it('streaming disabled, no files: JSON /submit only', async () => {
    let submitBody: any;
    server = await startServer((req, res) => {
      if (req.url === '/api/test-runs/submit') {
        submitBody = JSON.parse(req.body);
        jsonRes(res, 200, { testRunId: 10, projectId: 20 });
      } else {
        textRes(res, 404, 'nope');
      }
    });

    const reporter = new PiwiDashboardReporter({
      serverUrl: server.url,
      projectName,
      streaming: false,
      uploadReport: false,
      uploadTraces: false,
      liveFileUploads: false,
    });
    await runOneTest(reporter, 'json-test');

    const urls = urlsHit(server);
    assert.ok(urls.includes('/api/test-runs/submit'));
    assert.ok(!urls.includes('/api/test-runs/upload'));
    assert.ok(!urls.some((u) => u.endsWith('/finish')));
    // submit payload has the wire testCases (no `attachments` / `_filesUploaded`)
    assert.equal(submitBody.projectName, projectName);
    assert.equal(submitBody.status, 'passed');
    assert.equal(submitBody.testCases.length, 1);
    assert.equal('attachments' in submitBody.testCases[0], false);
    assert.equal('_filesUploaded' in submitBody.testCases[0], false);
  });

  it('streaming disabled, uploadReport=true: multipart /upload only (no /submit)', async () => {
    server = await startServer((req, res) => {
      if (req.url === '/api/test-runs/upload') {
        jsonRes(res, 200, { testRunId: 11, projectId: 21 });
      } else {
        textRes(res, 404, 'nope');
      }
    });

    const reporter = new PiwiDashboardReporter({
      serverUrl: server.url,
      projectName,
      streaming: false,
      uploadReport: false, // no html report on disk → appendReportsToForm finds nothing
      uploadTraces: false,
      liveFileUploads: false,
      reports: [{ type: 'missing-type', dir: '/nonexistent' }], // forces hasReports=true but no files
    });
    await runOneTest(reporter, 'upload-test');

    const urls = urlsHit(server);
    // hasReports is true (reports array non-empty) so /upload is attempted;
    // it succeeds so /submit is NOT called.
    assert.ok(urls.includes('/api/test-runs/upload'), `urls: ${urls.join(', ')}`);
    assert.ok(!urls.includes('/api/test-runs/submit'));
  });

  it('fallback: /upload fails → /submit succeeds', async () => {
    server = await startServer((req, res) => {
      if (req.url === '/api/test-runs/upload') {
        textRes(res, 500, 'boom');
      } else if (req.url === '/api/test-runs/submit') {
        jsonRes(res, 200, { testRunId: 12, projectId: 22 });
      } else {
        textRes(res, 404, 'nope');
      }
    });

    const reporter = new PiwiDashboardReporter({
      serverUrl: server.url,
      projectName,
      streaming: false,
      uploadReport: false,
      uploadTraces: false,
      liveFileUploads: false,
      reports: [{ type: 'missing-type', dir: '/nonexistent' }],
    });
    await runOneTest(reporter, 'fallback-test');

    const urls = urlsHit(server);
    const uploadIdx = urls.indexOf('/api/test-runs/upload');
    const submitIdx = urls.indexOf('/api/test-runs/submit');
    assert.ok(uploadIdx >= 0, `urls: ${urls.join(', ')}`);
    assert.ok(submitIdx >= 0, `urls: ${urls.join(', ')}`);
    assert.ok(uploadIdx < submitIdx, 'upload must be tried before submit');
  });

  it('all upload methods fail → recovery file is written', async () => {
    server = await startServer((req, res) => {
      if (req.url === '/api/test-runs/submit') {
        textRes(res, 500, 'down');
      } else if (req.url === '/api/test-runs/upload') {
        textRes(res, 500, 'down');
      } else {
        textRes(res, 404, 'nope');
      }
    });

    const reporter = new PiwiDashboardReporter({
      serverUrl: server.url,
      projectName,
      streaming: false,
      uploadReport: false,
      uploadTraces: false,
      liveFileUploads: false,
    });
    // Should not throw — recovery saves the payload instead.
    await runOneTest(reporter, 'recovery-test');

    // A recovery file should now exist in tmpdir for this project.
    const tmp = os.tmpdir();
    const files = fs.readdirSync(tmp).filter((f) => f.startsWith(RECOVERY_PREFIX));
    assert.ok(files.length > 0, 'expected a recovery file to be written');
    const recovered = JSON.parse(fs.readFileSync(path.join(tmp, files[0]), 'utf8'));
    assert.equal(recovered.projectName, projectName);
  });

  it('401 with no auth propagates (does not fall back)', async () => {
    server = await startServer((req, res) => {
      if (req.url === '/api/test-runs/submit') {
        textRes(res, 401, 'unauthorized');
      } else if (req.url === '/api/test-runs/upload') {
        textRes(res, 401, 'unauthorized');
      } else {
        textRes(res, 404, 'nope');
      }
    });

    const reporter = new PiwiDashboardReporter({
      serverUrl: server.url,
      projectName,
      streaming: false,
      uploadReport: false,
      uploadTraces: false,
      liveFileUploads: false,
      reports: [{ type: 'missing-type', dir: '/nonexistent' }],
    });
    await assert.rejects(runOneTest(reporter, 'auth-fail-test'), /401/);
  });
});
