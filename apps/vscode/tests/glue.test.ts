import { describe, expect, test } from 'vitest';
import type { RunStatusResult, StatusResult } from '@piwitests/editor/protocol';
import { disconnectQuestion, mcpConfiguration, sourceLabel, statusBarView } from '../src/glue';

const connected: StatusResult = {
  contexts: [
    {
      root: '/w',
      connected: true,
      serverUrl: 'http://piwi',
      source: 'dotenv',
      projectId: 7,
      projectName: 'Acme',
      branch: 'main',
      locators: 2,
      reachedFiles: 1,
      problem: null,
    },
  ],
};

const run = (over: Partial<NonNullable<RunStatusResult['contexts'][number]['run']>>): RunStatusResult => ({
  contexts: [
    {
      root: '/w',
      branch: 'feature/pay',
      failures: over.failedTests ?? 0,
      run: {
        id: 41,
        status: 'passed',
        startTime: '2026-09-27T10:00:00.000Z',
        totalTests: 120,
        passedTests: 118,
        failedTests: 0,
        flakyTests: 2,
        skippedTests: 0,
        url: 'http://piwi/test-runs/41',
        ...over,
      },
    },
  ],
});

describe('statusBarView', () => {
  test('without a Playwright config, says so', () => {
    expect(statusBarView({ contexts: [] }, null)).toMatchObject({ text: '$(beaker) Piwi', action: 'none' });
  });

  test('when not connected, offers Connect with the reason', () => {
    const view = statusBarView(
      { contexts: [{ ...connected.contexts[0]!, connected: false, problem: 'No project chosen.' }] },
      null,
    );
    expect(view).toMatchObject({ text: '$(plug) Piwi: connect', tooltip: 'No project chosen.', action: 'connect' });
  });

  test('a passing run, with its flaky tests', () => {
    expect(statusBarView(connected, run({}))).toEqual({
      text: '$(pass) Piwi: 118 passed · 2 flaky',
      tooltip:
        'Run #41 of Acme on feature/pay: 118 passed, 0 failed, 2 flaky, 0 skipped\nhttp://piwi, from the workspace .env',
      action: 'open',
      url: 'http://piwi/test-runs/41',
      error: false,
    });
  });

  test('a failing run is an error', () => {
    expect(statusBarView(connected, run({ status: 'failed', failedTests: 3, passedTests: 115 }))).toMatchObject({
      text: '$(error) Piwi: 3 failing · 2 flaky',
      error: true,
    });
  });

  test('a running run shows its progress', () => {
    expect(
      statusBarView(connected, run({ status: 'running', passedTests: 40, failedTests: 1, flakyTests: 0 })),
    ).toMatchObject({ text: '$(sync~spin) Piwi: 41/120 · 1 failing', action: 'open' });
  });

  test('an interrupted run names its status', () => {
    expect(statusBarView(connected, run({ status: 'interrupted' })).text).toBe('$(warning) Piwi: interrupted');
  });

  test('a branch without a run', () => {
    const view = statusBarView(connected, { contexts: [{ root: '/w', branch: 'wip', run: null, failures: 0 }] });
    expect(view).toMatchObject({
      text: '$(beaker) Piwi: no run',
      tooltip: 'No run of Acme on wip yet\nhttp://piwi, from the workspace .env',
    });
  });
});

describe('mcpConfiguration', () => {
  test('is a VS Code mcp.json with the key in a header', () => {
    expect(
      JSON.parse(
        mcpConfiguration([
          { label: 'Piwi (a)', url: 'https://a/mcp', headers: { Authorization: 'Bearer pd_x' } },
          { label: 'Piwi (b)', url: 'http://b/mcp', headers: {} },
        ]),
      ),
    ).toEqual({
      servers: {
        piwi: { type: 'http', url: 'https://a/mcp', headers: { Authorization: 'Bearer pd_x' } },
        'piwi-2': { type: 'http', url: 'http://b/mcp' },
      },
    });
  });
});

describe('Piwi: Disconnect', () => {
  test('asks about what is saved, and nothing when nothing is', () => {
    expect(disconnectQuestion('https://piwi.corp', 'Shop')).toBe(
      'forget https://piwi.corp, the project, and the API key saved for it?',
    );
    expect(disconnectQuestion(null, 'Shop')).toBe('forget the project Shop saved for the desktop app?');
    expect(disconnectQuestion(null, null)).toBeNull();
  });

  test('the desktop app is named as a source', () => {
    expect(sourceLabel('desktop')).toBe('the Piwi desktop app');
  });
});
