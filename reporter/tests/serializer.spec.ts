import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { resolveOverallStatus, toWireTestCase, serializeRun } from '../src/serializer.js';
import type { RunPayload } from '../src/uploader.js';
import type { CollectedTestCase } from '../src/types.js';

describe('resolveOverallStatus', () => {
  const counters = { failedTests: 0, timedOutTests: 0, totalTests: 5 };

  it('maps Playwright status directly (passed/failed)', () => {
    assert.equal(resolveOverallStatus({ status: 'passed' } as any, counters), 'passed');
    assert.equal(resolveOverallStatus({ status: 'failed' } as any, counters), 'failed');
  });

  it('maps timedout/interrupted to failed', () => {
    assert.equal(resolveOverallStatus({ status: 'timedout' } as any, counters), 'failed');
    assert.equal(resolveOverallStatus({ status: 'interrupted' } as any, counters), 'failed');
  });

  it('falls back to "failed" for unknown status', () => {
    assert.equal(resolveOverallStatus({ status: 'something-weird' } as any, counters), 'failed');
  });

  it('returns "passed" when no status but no failures and totalTests > 0', () => {
    assert.equal(resolveOverallStatus({} as any, counters), 'passed');
  });

  it('returns "failed" when no status and there are failures', () => {
    assert.equal(resolveOverallStatus({} as any, { failedTests: 1, timedOutTests: 0, totalTests: 5 }), 'failed');
  });

  it('returns "failed" when no status and there are timeouts', () => {
    assert.equal(resolveOverallStatus({} as any, { failedTests: 0, timedOutTests: 1, totalTests: 5 }), 'failed');
  });

  it('returns "failed" when no status and totalTests is 0', () => {
    assert.equal(resolveOverallStatus({} as any, { failedTests: 0, timedOutTests: 0, totalTests: 0 }), 'failed');
  });

  it('status takes precedence over counters', () => {
    assert.equal(
      resolveOverallStatus({ status: 'passed' } as any, { failedTests: 5, timedOutTests: 5, totalTests: 10 }),
      'passed',
    );
  });
});

describe('toWireTestCase', () => {
  it('carries the type discriminant through', () => {
    const out = toWireTestCase({ type: 'begin', title: 't', location: 'l' });
    assert.equal(out.type, 'begin');
  });

  it('passes status/duration/error/retries through unchanged (no null default)', () => {
    const out = toWireTestCase({ type: 'begin', title: 't', location: 'l' });
    assert.equal('status' in out, true);
    assert.equal(out.status, undefined);
    assert.equal(out.duration, undefined);
    assert.equal(out.error, undefined);
    assert.equal(out.retries, undefined);
  });

  it('defaults workerIndex/shardIndex/startedAt/suitePath/suiteConfig/testAnnotations to null via ??', () => {
    const out = toWireTestCase({ type: 'begin', title: 't', location: 'l' });
    assert.equal(out.workerIndex, null);
    assert.equal(out.shardIndex, null);
    assert.equal(out.startedAt, null);
    assert.equal(out.suitePath, null);
    assert.equal(out.suiteConfig, null);
    assert.equal(out.testAnnotations, null);
  });

  it('preserves workerIndex=0 (?? null, not || null)', () => {
    const out = toWireTestCase({ type: 'begin', title: 't', location: 'l', workerIndex: 0 });
    assert.equal(out.workerIndex, 0);
  });

  it('preserves startedAt=0', () => {
    const out = toWireTestCase({ type: 'begin', title: 't', location: 'l', startedAt: 0 });
    assert.equal(out.startedAt, 0);
  });

  it('collapses slowestStepDuration=0 to null (|| null quirk)', () => {
    const out = toWireTestCase({
      type: 'complete',
      title: 't',
      location: 'l',
      performanceMetrics: { slowestStep: { title: 's', duration: 0 } },
    });
    assert.equal(out.slowestStepDuration, null);
    assert.equal(out.slowestStep, 's');
  });

  it('preserves empty steps array (|| null does not collapse truthy [])', () => {
    const out = toWireTestCase({
      type: 'complete',
      title: 't',
      location: 'l',
      performanceMetrics: { steps: [] },
    });
    assert.deepEqual(out.steps, []);
  });

  it('exposes steps from performanceMetrics.steps', () => {
    const steps = [{ title: 'x', duration: 1, category: 'action' }];
    const out = toWireTestCase({
      type: 'complete',
      title: 't',
      location: 'l',
      performanceMetrics: { steps },
    });
    assert.equal(out.steps, steps);
  });

  it('exposes stepEvents, networkRequests, webVitals, consoleLogs, ariaSnapshot, testSource when present', () => {
    const out = toWireTestCase({
      type: 'complete',
      title: 't',
      location: 'l',
      stepEvents: [{ t: 1 }],
      networkRequests: [{ url: 'u' }],
      webVitals: { navigation: {} },
      consoleLogs: [{ type: 'error' }],
      ariaSnapshot: 'snapshot',
      testSource: 'src',
    });
    assert.deepEqual(out.stepEvents, [{ t: 1 }]);
    assert.deepEqual(out.networkRequests, [{ url: 'u' }]);
    assert.deepEqual(out.webVitals, { navigation: {} });
    assert.deepEqual(out.consoleLogs, [{ type: 'error' }]);
    assert.equal(out.ariaSnapshot, 'snapshot');
    assert.equal(out.testSource, 'src');
  });

  it('collapses browser=undefined to null', () => {
    const out = toWireTestCase({ type: 'begin', title: 't', location: 'l' });
    assert.equal(out.browser, null);
  });

  it('preserves a populated browser object', () => {
    const browser = { projectName: 'chromium' };
    const out = toWireTestCase({ type: 'begin', title: 't', location: 'l', browser });
    assert.equal(out.browser, browser);
  });

  it('drops unknown/internal fields (only listed fields are emitted)', () => {
    const out = toWireTestCase({
      type: 'complete',
      title: 't',
      location: 'l',
      attachments: [{ name: 'trace' }], // raw attachment � must NOT appear on the wire
      _filesUploaded: true, // bookkeeping � must NOT appear on the wire
    });
    assert.equal('attachments' in out, false);
    assert.equal('_filesUploaded' in out, false);
  });

  it('emits exactly the expected set of keys', () => {
    const out = toWireTestCase({ type: 'complete', title: 't', location: 'l' });
    assert.deepEqual(Object.keys(out).sort(), [
      'ariaSnapshot',
      'browser',
      'consoleLogs',
      'duration',
      'error',
      'location',
      'networkRequests',
      'retries',
      'shardIndex',
      'slowestStep',
      'slowestStepDuration',
      'startedAt',
      'status',
      'stepEvents',
      'steps',
      'suiteConfig',
      'suitePath',
      'testAnnotations',
      'testSource',
      'title',
      'type',
      'webVitals',
      'workerIndex',
    ]);
  });
});

describe('serializeRun', () => {
  function makePayload(testCases: CollectedTestCase[] = []): RunPayload {
    return {
      projectName: 'proj',
      projectDescription: 'desc',
      status: 'passed',
      startTime: '2024-01-01T00:00:00.000Z',
      duration: 1000,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      skippedTests: 0,
      environment: 'staging',
      label: 'v1',
      metadata: { scm: { commit: 'abc' } },
      instanceId: 'inst-1',
      testCases,
      playwrightVersion: '1.50.0',
      shardIndex: 1,
      shardTotal: 3,
    };
  }

  it('includes all run-level fields exactly once', () => {
    const body = serializeRun(makePayload(), { includeTestCases: false });
    assert.deepEqual(Object.keys(body).sort(), [
      'duration',
      'environment',
      'failedTests',
      'filterDetails',
      'instanceId',
      'isFullRun',
      'label',
      'metadata',
      'passedTests',
      'playwrightVersion',
      'projectDescription',
      'projectName',
      'shardIndex',
      'shardTotal',
      'skippedTests',
      'startTime',
      'status',
      'totalTests',
    ]);
  });

  it('omits testCases when includeTestCases is false', () => {
    const body = serializeRun(makePayload([{ type: 'complete', title: 't', location: 'l' } as any]), {
      includeTestCases: false,
    });
    assert.equal('testCases' in body, false);
  });

  it('projects testCases to wire shape when includeTestCases is true', () => {
    const collected: CollectedTestCase = {
      type: 'complete',
      title: 't',
      location: 'l',
      status: 'passed',
      duration: 5,
      attachments: [{ name: 'trace', path: '/tmp/trace.zip' }],
    } as any;
    const body = serializeRun(makePayload([collected]), { includeTestCases: true });
    assert.ok(Array.isArray(body.testCases));
    assert.equal(body.testCases.length, 1);
    // attachments are stripped on the wire
    assert.equal('attachments' in body.testCases[0], false);
    assert.equal(body.testCases[0].title, 't');
  });

  it('coerces environment/label to null when absent', () => {
    const payload = makePayload();
    delete payload.environment;
    delete payload.label;
    const body = serializeRun(payload, { includeTestCases: false });
    assert.equal(body.environment, null);
    assert.equal(body.label, null);
  });

  it('preserves metadata object by reference', () => {
    const payload = makePayload();
    const body = serializeRun(payload, { includeTestCases: false });
    assert.equal(body.metadata, payload.metadata);
  });
});
