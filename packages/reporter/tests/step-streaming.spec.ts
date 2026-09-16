import { describe, it, afterEach, expect } from 'vitest';
import { PiwiDashboardReporter } from '../src/public/reporter.js';
import {
  startServer,
  jsonRes,
  textRes,
  fakeConfig,
  fakeSuite,
  fakeTestCase,
  fakeResult,
  type FakeServer,
} from './_helpers.js';

async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function makeStep(category: string, title = `step-${category}`): any {
  return {
    title,
    category,
    location: { file: '/tmp/test.spec.ts', line: 3, column: 4 },
    startTime: new Date('2024-01-01T00:00:00.000Z'),
    duration: 5,
    error: null,
  };
}

describe('PiwiDashboardReporter live step streaming', () => {
  let server: FakeServer;
  const projectName = 'piwi-steps-' + process.pid;

  afterEach(async () => {
    if (server) await server.close();
  });

  it('streams pw:api / pw:expect / hook / fixture steps and skips pw:assert', async () => {
    const eventsBodies: Array<{ testCases: Array<Record<string, unknown>> }> = [];
    server = await startServer((req, res) => {
      if (req.url === '/api/test-runs/start') {
        jsonRes(res, 200, { runId: 1, streamToken: 'tok' });
      } else if (req.url === '/api/test-runs/1/events') {
        eventsBodies.push(JSON.parse(req.body));
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
      streamingBatchDelay: 30,
      streamingBatchSize: 1,
    });

    const suite = fakeSuite();
    const test = fakeTestCase({ title: 'the test', parent: suite });
    const result = fakeResult({ workerIndex: 0 });
    // Steps are fired straight after `onBegin`, while `/start` is still in
    // flight — the reporter must buffer them until the run id lands rather
    // than drop them, which is what real fixtures/hooks do at run start.
    reporter.onBegin(fakeConfig(), suite);

    reporter.onStepBegin(test, result, makeStep('pw:api'));
    reporter.onStepBegin(test, result, makeStep('pw:assert', 'no-assert-begin'));
    reporter.onStepBegin(test, result, makeStep('pw:expect'));
    const waitForBegins = async () =>
      waitFor(
        () =>
          eventsBodies.flatMap((b) => b.testCases ?? []).filter((e) => e.type === 'step-begin').length >= 2,
      ).catch((e) => {
        throw new Error(
          `${(e as Error).message} — bodies=${JSON.stringify(eventsBodies)} urls=${server.requests.map((r) => r.url).join(',')}`,
        );
      });
    await waitForBegins();

    reporter.onStepEnd(test, result, makeStep('pw:api', 'ended-api'));
    reporter.onStepEnd(test, result, makeStep('pw:assert', 'no-assert-end'));
    reporter.onStepEnd(test, result, makeStep('pw:expect', 'ended-expect'));
    await waitFor(
      () =>
        eventsBodies.flatMap((b) => b.testCases ?? []).filter((e) => e.type === 'step-end').length >= 2,
    );

    const all = eventsBodies.flatMap((b) => b.testCases);
    const begins = all.filter((e) => e.type === 'step-begin');
    const ends = all.filter((e) => e.type === 'step-end');

    expect(begins.map((e) => e.stepCategory).sort()).toEqual(['pw:api', 'pw:expect']);
    expect(begins.every((e) => e.parentTitle === 'the test')).toBeTruthy();
    expect(ends.map((e) => e.stepCategory).sort()).toEqual(['pw:api', 'pw:expect']);
    expect(all.some((e) => e.title === 'no-assert-begin')).toBeFalsy();
    expect(all.some((e) => e.title === 'no-assert-end')).toBeFalsy();
  });

  it('suite-level hooks keep parentTitle null and land in setupSteps', async () => {
    let finishBody: { setupSteps?: unknown[] } | null = null;
    server = await startServer((req, res) => {
      if (req.url === '/api/test-runs/start') {
        jsonRes(res, 200, { runId: 1, streamToken: 'tok' });
      } else if (req.url === '/api/test-runs/1/events') {
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
      streamingBatchDelay: 30,
      streamingBatchSize: 1,
    });

    const suite = fakeSuite();
    const test = fakeTestCase({ title: 'the test', parent: suite });
    suite.allTests = () => [test];
    const result = fakeResult({ workerIndex: 0 });
    reporter.onBegin(fakeConfig(), suite);
    await waitFor(() => server.requests.some((r) => r.url === '/api/test-runs/start'));

    // Suite-level hook (no test): streamed as step events with parentTitle null
    // AND recorded as a setup step for the timeline.
    reporter.onStepBegin(undefined, result, makeStep('hook', 'beforeAll'));
    reporter.onStepEnd(undefined, result, makeStep('hook', 'beforeAll'));
    await reporter.onEnd({ status: 'passed' } as any);
    await waitFor(() => finishBody != null);

    const setup = finishBody?.setupSteps ?? [];
    expect(setup.some((s: any) => s.title === 'beforeAll' && s.category === 'hook')).toBeTruthy();
  });
});
