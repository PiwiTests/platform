import { describe, expect, test } from 'vitest';
import type { DesktopJobUpdate, DesktopResult, RunStatusResult, StatusResult } from '@piwitests/editor/protocol';
import {
  connectChoices,
  desktopJobNotice,
  disconnectQuestion,
  mcpConfiguration,
  sourceLabel,
  statusBarView,
  testDecorations,
} from '../src/glue';

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
    expect(disconnectQuestion(null, null, true)).toBe('forget the choice of the desktop app?');
    expect(disconnectQuestion('https://piwi.corp', 'Shop', true)).toBe(
      'forget https://piwi.corp, the project, and the API key saved for it, and the choice of the desktop app?',
    );
  });

  test('the desktop app is named as a source', () => {
    expect(sourceLabel('desktop')).toBe('the Piwi desktop app');
  });
});

describe('the desktop app beside another instance', () => {
  const desktop: DesktopResult = {
    url: 'http://127.0.0.1:3000',
    projects: [{ id: 3, name: 'Shop' }],
    linked: { id: 3, name: 'Shop' },
  };
  const team = { ...connected, desktopUrl: 'http://127.0.0.1:3000' };
  team.contexts = [{ ...connected.contexts[0]!, instance: { serverUrl: 'http://piwi', source: 'dotenv' } }];

  test('Connect offers the app, the instance the workspace names, and another one', () => {
    expect(connectChoices(team, desktop, null)).toEqual([
      {
        target: 'desktop',
        label: '$(device-desktop) The Piwi desktop app',
        description: 'http://127.0.0.1:3000',
        detail: 'Runs on this machine; this folder is linked there to the project Shop.',
        serverUrl: null,
      },
      {
        target: 'instance',
        label: '$(server) http://piwi',
        description: 'in use',
        detail: 'From the workspace .env.',
        serverUrl: 'http://piwi',
      },
      {
        target: 'other',
        label: '$(globe) Another instance…',
        description: '',
        detail: 'A Piwi server, by its address.',
        serverUrl: null,
      },
    ]);
  });

  test('with the app in use, Connect still offers the instance to go back to', () => {
    const onDesktop: StatusResult = {
      ...team,
      contexts: [{ ...team.contexts[0]!, serverUrl: 'http://127.0.0.1:3000', source: 'desktop' }],
    };
    const [app, instance] = connectChoices(onDesktop, desktop, null);
    expect(app).toMatchObject({ description: 'http://127.0.0.1:3000 · in use' });
    expect(instance).toMatchObject({ target: 'instance', serverUrl: 'http://piwi', description: '' });
    // Only saved in the settings: offered from there.
    const saved = { ...onDesktop, contexts: [{ ...onDesktop.contexts[0]!, instance: null }] };
    expect(connectChoices(saved, desktop, 'https://piwi.corp')[1]).toMatchObject({
      serverUrl: 'https://piwi.corp',
      detail: 'From the Piwi settings.',
    });
  });

  test('the status bar says when the app runs unused, or was chosen and does not run', () => {
    expect(statusBarView(team, run({})).tooltip).toMatch(/desktop app runs on this machine: Piwi: Connect to use it/);
    expect(statusBarView(connected, run({}), true).tooltip).toMatch(/chosen with Piwi: Connect, is not running/);
    expect(statusBarView(connected, run({})).tooltip).not.toMatch(/desktop/);
  });
});

describe('the tests of a file', () => {
  test('are drawn with their latest result, a failing one over its whole body', () => {
    expect(
      testDecorations([
        { line: 0, title: '2 tests in Piwi' },
        {
          line: 3,
          title: 'passed 1/4 · failed',
          status: 'failed',
          endLine: 6,
          failure: {
            line: 5,
            headline: 'not found',
            message: null,
            executionId: 90,
            url: 'http://piwi/test-run-cases/90',
          },
          command: {
            title: 'Open in dashboard',
            command: 'piwi.openInDashboard',
            arguments: ['http://piwi/test-cases/9'],
          },
        },
        { line: 8, title: 'passed 4/4', status: 'passed', endLine: 10 },
      ]),
    ).toEqual([
      {
        status: 'failed',
        line: 3,
        failingUntil: 6,
        failingLine: 5,
        hover: '**Piwi**: failing · passed 1/4 · failed',
        dashboardUrl: 'http://piwi/test-cases/9',
      },
      {
        status: 'passed',
        line: 8,
        failingUntil: null,
        failingLine: null,
        hover: '**Piwi**: passing · passed 4/4',
        dashboardUrl: null,
      },
    ]);
  });

  test('the status bar says when the checked-out branch has no run yet', () => {
    const onMain: RunStatusResult = {
      contexts: [{ ...run({}).contexts[0]!, branch: 'main', checkedOut: 'feature/cart' }],
    };
    expect(statusBarView(connected, onMain).tooltip).toMatch(
      /^Run #41 of Acme on main \(feature\/cart has no run yet\)/,
    );
    expect(statusBarView(connected, run({})).tooltip).not.toMatch(/no run yet/);
  });
});

describe('desktopJobNotice', () => {
  const update = (patch: Partial<DesktopJobUpdate>): DesktopJobUpdate => ({
    jobId: 'f00d',
    kind: 'bisect',
    status: 'done',
    message: 'The bisect names c1c1c1c as the first bad commit.',
    share: null,
    ...patch,
  });

  test('offers the share button on a verdict that can be shared', () => {
    expect(desktopJobNotice(update({ share: { label: 'Share on piwi.example.com' } }))).toEqual({
      severity: 'information',
      text: 'Piwi: The bisect names c1c1c1c as the first bad commit.',
      actions: ['Share on piwi.example.com'],
    });
  });

  test('warns when the job ended without a verdict', () => {
    expect(desktopJobNotice(update({ status: 'declined', message: 'Declined.' })).severity).toBe('warning');
    expect(desktopJobNotice(update({ message: 'The desktop app could not bisect "t": npm ci failed' })).severity).toBe(
      'warning',
    );
    expect(desktopJobNotice(update({ status: 'running', message: 'Bisecting.' }))).toMatchObject({
      severity: 'information',
      actions: [],
    });
  });

  test("offers to share a Flake Lab run's results, and warns when the lab could not run", () => {
    const lab = { kind: 'flake-lab' as const, share: { label: 'Share on piwi.example.com' } };
    expect(desktopJobNotice(update({ ...lab, message: 'Flake Lab reproduced "t" at b0b0b0b.' }))).toEqual({
      severity: 'information',
      text: 'Piwi: Flake Lab reproduced "t" at b0b0b0b.',
      actions: ['Share on piwi.example.com'],
    });
    expect(
      desktopJobNotice(
        update({ kind: 'flake-lab', message: 'The desktop app could not run Flake Lab on "t": npm ci failed' }),
      ).severity,
    ).toBe('warning');
  });
});
