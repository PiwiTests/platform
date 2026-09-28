import { describe, it, expect } from 'vitest';
import { parseReproRequest, reproArgs, withReproResultHook, type ReproRequestInput } from '#shared/desktop-repro';
import {
  createReproRequest,
  getReproRequest,
  subscribeReproRequests,
  updateReproRequest,
  waitingReproRequests,
} from '../../server/utils/desktop-repro';

const steps = {
  v: 1,
  title: 'Coupon not applied',
  origin: 'http://localhost:3000',
  recordedAt: 1,
  note: null,
  steps: [
    {
      action: 'goto',
      target: null,
      value: 'http://localhost:3000/cart',
      redacted: false,
      pageUrl: 'http://localhost:3000/cart',
      timestamp: 1,
    },
  ],
};

function input(): ReproRequestInput {
  const parsed = parseReproRequest('application/json', { steps });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.request;
}

describe('parseReproRequest', () => {
  it('refuses a body that is not JSON, before reading it', () => {
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
      undefined,
    ]) {
      const parsed = parseReproRequest(type, { steps });
      expect(parsed).toMatchObject({ ok: false, statusCode: 415 });
    }
  });

  it('refuses steps parseSteps refuses, naming why', () => {
    const parsed = parseReproRequest('application/json', { steps: { v: 2, steps: 'code()' } });
    expect(parsed).toMatchObject({ ok: false, statusCode: 400, message: 'Invalid steps' });
    expect(parsed.ok ? [] : parsed.errors).not.toHaveLength(0);
    expect(parseReproRequest('application/json', null)).toMatchObject({ ok: false, statusCode: 400 });
  });

  it('refuses options that are not flags a request may set', () => {
    const parsed = parseReproRequest('application/json', { steps, options: { project: 'x --config=evil.ts' } });
    expect(parsed).toMatchObject({ ok: false, statusCode: 400 });
    expect(parseReproRequest('application/json', { steps, options: { repeatEach: 500 } })).toMatchObject({ ok: false });
  });

  it('reads the steps, the options and where the report came from', () => {
    const parsed = parseReproRequest('application/json; charset=utf-8', {
      steps,
      options: { headed: true, project: 'chromium' },
      bugReportId: 37,
      instanceUrl: 'https://piwi.example.com',
    });
    expect(parsed).toMatchObject({
      ok: true,
      request: {
        title: 'Coupon not applied',
        options: { headed: true, trace: false, project: 'chromium', repeatEach: 1 },
        bugReportId: 37,
        instanceUrl: 'https://piwi.example.com',
      },
    });
  });
});

describe('reproArgs', () => {
  it('writes each option as one flag, its value joined by =', () => {
    expect(reproArgs({ headed: true, trace: true, project: 'chromium', repeatEach: 3 })).toEqual([
      '--headed',
      '--trace=on',
      '--project=chromium',
      '--repeat-each=3',
    ]);
    expect(reproArgs({ headed: false, trace: false, project: null, repeatEach: 1 })).toEqual([]);
  });
});

describe('withReproResultHook', () => {
  it('appends the hook after the test, so every step keeps its line', () => {
    const code = "import { test, expect } from '@playwright/test';\n\ntest('x', async ({ page }) => {\n});\n";
    const hooked = withReproResultHook(code);
    expect(hooked.startsWith(code.trimEnd())).toBe(true);
    expect(hooked).toContain('process.env.PIWI_REPRO_RESULT');
  });
});

describe('the repro request store', () => {
  it('tells listening windows of a new request and keeps it waiting', () => {
    const seen: string[] = [];
    const stop = subscribeReproRequests((r) => seen.push(r.id));
    const request = createReproRequest(input());
    stop();
    expect(seen).toEqual([request.id]);
    expect(request.id).toMatch(/^[0-9a-f]{16}$/);
    expect(waitingReproRequests().map((r) => r.id)).toContain(request.id);
  });

  it('moves from waiting to running to done, and refuses steps out of order', () => {
    const request = createReproRequest(input());
    expect(updateReproRequest(request.id, { status: 'done', verdict: { kind: 'not-reproduced' } })).toBeNull();
    expect(updateReproRequest(request.id, { status: 'running', projectId: 4 })).toMatchObject({
      status: 'running',
      projectId: 4,
    });
    expect(updateReproRequest(request.id, { status: 'declined' })).toBeNull();
    const done = updateReproRequest(request.id, {
      status: 'done',
      verdict: { kind: 'reproduced', step: 3, found: '"Total: 40"' },
    });
    expect(done).toMatchObject({ status: 'done', verdict: { kind: 'reproduced', step: 3 } });
    expect(getReproRequest(request.id)?.status).toBe('done');
    expect(waitingReproRequests().map((r) => r.id)).not.toContain(request.id);
  });

  it('answers nothing for an unknown request', () => {
    expect(getReproRequest('ffff')).toBeNull();
    expect(updateReproRequest('ffff', { status: 'running' })).toBeNull();
  });
});
