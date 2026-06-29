import { describe, it, expect } from 'vitest';
import { resolveOverallStatus, toWireTestCase, serializeRun } from '../src/internal/submit/serializer.js';
import type { RunPayload } from '../src/internal/submit/uploader.js';
import type { CollectedTestCase } from '../src/types.js';

describe('resolveOverallStatus', () => {
  const counters = { failedTests: 0, timedOutTests: 0, totalTests: 5 };

  it('maps Playwright status directly (passed/failed)', () => {
    expect(resolveOverallStatus({ status: 'passed' } as any, counters)).toBe('passed');
    expect(resolveOverallStatus({ status: 'failed' } as any, counters)).toBe('failed');
  });

  it('maps timedout/interrupted to failed', () => {
    expect(resolveOverallStatus({ status: 'timedout' } as any, counters)).toBe('failed');
    expect(resolveOverallStatus({ status: 'interrupted' } as any, counters)).toBe('failed');
  });

  it('falls back to "failed" for unknown status', () => {
    expect(resolveOverallStatus({ status: 'something-weird' } as any, counters)).toBe('failed');
  });

  it('returns "passed" when no status but no failures and totalTests > 0', () => {
    expect(resolveOverallStatus({} as any, counters)).toBe('passed');
  });

  it('returns "failed" when no status and there are failures', () => {
    expect(resolveOverallStatus({} as any, { failedTests: 1, timedOutTests: 0, totalTests: 5 })).toBe('failed');
  });

  it('returns "failed" when no status and there are timeouts', () => {
    expect(resolveOverallStatus({} as any, { failedTests: 0, timedOutTests: 1, totalTests: 5 })).toBe('failed');
  });

  it('returns "failed" when no status and totalTests is 0', () => {
    expect(resolveOverallStatus({} as any, { failedTests: 0, timedOutTests: 0, totalTests: 0 })).toBe('failed');
  });

  it('status takes precedence over counters', () => {
    expect(
      resolveOverallStatus({ status: 'passed' } as any, { failedTests: 5, timedOutTests: 5, totalTests: 10 }),
    ).toBe('passed');
  });
});

describe('toWireTestCase', () => {
  it('carries the type discriminant through', () => {
    const out = toWireTestCase({ type: 'begin', title: 't', location: 'l' });
    expect(out.type).toBe('begin');
  });

  it('passes status/duration/error/retries through unchanged (no null default)', () => {
    const out = toWireTestCase({ type: 'begin', title: 't', location: 'l' });
    expect('status' in out).toBe(true);
    expect(out.status).toBe(undefined);
    expect(out.duration).toBe(undefined);
    expect(out.error).toBe(undefined);
    expect(out.retries).toBe(undefined);
  });

  it('defaults workerIndex/shardIndex/startedAt/suitePath/suiteConfig/testAnnotations to null via ??', () => {
    const out = toWireTestCase({ type: 'begin', title: 't', location: 'l' });
    expect(out.workerIndex).toBe(null);
    expect(out.shardIndex).toBe(null);
    expect(out.startedAt).toBe(null);
    expect(out.suitePath).toBe(null);
    expect(out.suiteConfig).toBe(null);
    expect(out.testAnnotations).toBe(null);
  });

  it('preserves workerIndex=0 (?? null, not || null)', () => {
    const out = toWireTestCase({ type: 'begin', title: 't', location: 'l', workerIndex: 0 });
    expect(out.workerIndex).toBe(0);
  });

  it('preserves startedAt=0', () => {
    const out = toWireTestCase({ type: 'begin', title: 't', location: 'l', startedAt: 0 });
    expect(out.startedAt).toBe(0);
  });

  it('collapses slowestStepDuration=0 to null (|| null quirk)', () => {
    const out = toWireTestCase({
      type: 'complete',
      title: 't',
      location: 'l',
      performanceMetrics: { slowestStep: { title: 's', duration: 0 } },
    });
    expect(out.slowestStepDuration).toBe(null);
    expect(out.slowestStep).toBe('s');
  });

  it('preserves empty steps array (|| null does not collapse truthy [])', () => {
    const out = toWireTestCase({
      type: 'complete',
      title: 't',
      location: 'l',
      performanceMetrics: { steps: [] },
    });
    expect(out.steps).toEqual([]);
  });

  it('exposes steps from performanceMetrics.steps', () => {
    const steps = [{ title: 'x', duration: 1, category: 'action' }];
    const out = toWireTestCase({
      type: 'complete',
      title: 't',
      location: 'l',
      performanceMetrics: { steps },
    });
    expect(out.steps).toBe(steps);
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
    expect(out.stepEvents).toEqual([{ t: 1 }]);
    expect(out.networkRequests).toEqual([{ url: 'u' }]);
    expect(out.webVitals).toEqual({ navigation: {} });
    expect(out.consoleLogs).toEqual([{ type: 'error' }]);
    expect(out.ariaSnapshot).toBe('snapshot');
    expect(out.testSource).toBe('src');
  });

  it('collapses browser=undefined to null', () => {
    const out = toWireTestCase({ type: 'begin', title: 't', location: 'l' });
    expect(out.browser).toBe(null);
  });

  it('preserves a populated browser object', () => {
    const browser = { projectName: 'chromium' };
    const out = toWireTestCase({ type: 'begin', title: 't', location: 'l', browser });
    expect(out.browser).toBe(browser);
  });

  it('drops unknown/internal fields (only listed fields are emitted)', () => {
    const out = toWireTestCase({
      type: 'complete',
      title: 't',
      location: 'l',
      attachments: [{ name: 'trace' }], // raw attachment — must NOT appear on the wire
      _filesUploaded: true, // bookkeeping — must NOT appear on the wire
    });
    expect('attachments' in out).toBe(false);
    expect('_filesUploaded' in out).toBe(false);
  });

  it('emits exactly the expected set of keys', () => {
    const out = toWireTestCase({ type: 'complete', title: 't', location: 'l' });
    expect(Object.keys(out).sort()).toEqual([
      'ariaSnapshot',
      'browser',
      'consoleLogs',
      'duration',
      'error',
      'location',
      'locatorSnapshots',
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
      'wastedTimeMs',
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
    expect(Object.keys(body).sort()).toEqual([
      'didNotRunTests',
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
      'timedOutTests',
      'totalTests',
    ]);
  });

  it('omits testCases when includeTestCases is false', () => {
    const body = serializeRun(makePayload([{ type: 'complete', title: 't', location: 'l' } as any]), {
      includeTestCases: false,
    });
    expect('testCases' in body).toBe(false);
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
    expect(Array.isArray(body.testCases)).toBeTruthy();
    expect(body.testCases.length).toBe(1);
    // attachments are stripped on the wire
    expect('attachments' in body.testCases[0]).toBe(false);
    expect(body.testCases[0].title).toBe('t');
  });

  it('coerces environment/label to null when absent', () => {
    const payload = makePayload();
    delete payload.environment;
    delete payload.label;
    const body = serializeRun(payload, { includeTestCases: false });
    expect(body.environment).toBe(null);
    expect(body.label).toBe(null);
  });

  it('preserves metadata object by reference', () => {
    const payload = makePayload();
    const body = serializeRun(payload, { includeTestCases: false });
    expect(body.metadata).toBe(payload.metadata);
  });
});
