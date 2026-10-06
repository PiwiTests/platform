import { describe, expect, test } from 'vitest';
import type { DesktopJobUpdate, DesktopResult, RunStatusResult, StatusResult } from '@piwitests/editor/protocol';
import {
  configTestDir,
  connectChoices,
  desktopJobNotice,
  disconnectQuestion,
  followBlock,
  importInsertion,
  recordInto,
  mcpConfiguration,
  newTestFileName,
  placedBlock,
  recordedBlockText,
  recordingSummary,
  recordingView,
  sourceLabel,
  statusBarView,
  testDecorations,
  writeBlock,
  type RecordedBlock,
  type TextChange,
  type TextSpan,
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

  test('counts the tests still failing after the local runs, and those they fixed', () => {
    const local = (counts: { failingTests: number; resolved: number; overlays: number }): RunStatusResult => {
      const runs = run({ status: 'failed', failedTests: 3, passedTests: 115, flakyTests: 0 });
      return { contexts: [{ ...runs.contexts[0]!, ...counts }] };
    };
    const view = statusBarView(connected, local({ failingTests: 2, resolved: 1, overlays: 2 }));
    expect(view).toMatchObject({ text: '$(error) Piwi: 2 failing · 1 fixed locally', error: true });
    expect(view.tooltip).toBe(
      'Run #41 of Acme on feature/pay: 115 passed, 3 failed, 0 flaky, 0 skipped\n2 local runs since · 1 test fixed locally\nhttp://piwi, from the workspace .env',
    );
    expect(statusBarView(connected, local({ failingTests: 0, resolved: 3, overlays: 1 }))).toMatchObject({
      text: '$(pass) Piwi: 3 fixed locally',
      error: false,
    });
    expect(statusBarView(connected, local({ failingTests: 1, resolved: 0, overlays: 1 }))).toMatchObject({
      text: '$(error) Piwi: 1 failing',
      tooltip: expect.stringContaining('\n1 local run since · 0 tests fixed locally\n'),
    });
    expect(statusBarView(connected, local({ failingTests: 3, resolved: 0, overlays: 0 })).tooltip).not.toContain(
      'local run',
    );
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

const at = (line: number, character: number) => ({ line, character });
const span = (startLine: number, startCharacter: number, endLine: number, endCharacter: number): TextSpan => ({
  start: at(startLine, startCharacter),
  end: at(endLine, endCharacter),
});
const change = (range: TextSpan, text: string): TextChange => ({ range, text });

/** Applies changes made in one edit to a text, as the editor does: at the same position, in the order given. */
function applied(text: string, changes: TextChange[]): string {
  const lines = text.split('\n');
  const offset = (p: { line: number; character: number }) =>
    lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  return changes
    .map((c, i) => ({ c, i, start: offset(c.range.start), end: offset(c.range.end) }))
    .sort((a, b) => b.start - a.start || b.i - a.i)
    .reduce((out, { c, start, end }) => out.slice(0, start) + c.text + out.slice(end), text);
}

describe('the recorded block', () => {
  test('is the update’s code with every non-empty line indented', () => {
    expect(recordedBlockText("await page.goto('/');\n\nawait page.reload();", '    ')).toBe(
      "    await page.goto('/');\n\n    await page.reload();",
    );
    expect(recordedBlockText('', '  ')).toBe('');
  });

  test('starts at the line its placement names', () => {
    expect(placedBlock({ line: 4, newLine: true, indent: '  ' })).toEqual({ range: span(4, 0, 4, 0), first: 'insert' });
    expect(placedBlock({ line: 2, newLine: false, indent: '' })).toEqual({ range: span(2, 0, 2, 0), first: 'replace' });
  });
});

describe('following the recorded block', () => {
  // Lines 3 to 5, the last one 30 characters long.
  const block = span(3, 0, 5, 30);

  test('lines added or removed above move it', () => {
    expect(followBlock(block, change(span(1, 4, 1, 4), 'x'))).toEqual({ where: 'above', block });
    expect(followBlock(block, change(span(1, 0, 1, 0), 'one\ntwo\n'))).toEqual({
      where: 'above',
      block: span(5, 0, 7, 30),
    });
    // Enter at the end of the line above, and a line deleted with its line break.
    expect(followBlock(block, change(span(2, 12, 2, 12), '\n  ')).block).toEqual(span(4, 0, 6, 30));
    expect(followBlock(block, change(span(2, 0, 3, 0), ''))).toEqual({ where: 'above', block: span(2, 0, 4, 30) });
    // A line pasted at the start of the block's first line goes above it.
    expect(followBlock(block, change(span(3, 0, 3, 0), "await page.goto('/');\n"))).toEqual({
      where: 'above',
      block: span(4, 0, 6, 30),
    });
  });

  test('changes below leave it, Enter at the end of its last line included', () => {
    expect(followBlock(block, change(span(6, 0, 6, 0), 'x'))).toEqual({ where: 'below', block });
    expect(followBlock(block, change(span(5, 30, 5, 30), '\n  '))).toEqual({ where: 'below', block });
    expect(followBlock(block, change(span(5, 30, 5, 30), '\r\n  '))).toEqual({ where: 'below', block });
  });

  test('typing inside it changes it', () => {
    expect(followBlock(block, change(span(4, 6, 4, 6), 'abc'))).toEqual({ where: 'inside', block });
    expect(followBlock(block, change(span(4, 6, 4, 6), 'a\nb')).block).toEqual(span(3, 0, 6, 30));
    expect(followBlock(block, change(span(5, 30, 5, 30), ';'))).toEqual({ where: 'inside', block: span(3, 0, 5, 31) });
    expect(followBlock(block, change(span(3, 0, 3, 0), ' '))).toEqual({ where: 'inside', block: span(3, 0, 5, 30) });
  });

  test('an edit across one of its edges takes in what it wrote', () => {
    // Backspace at the start of its first line joins it to the line above.
    expect(followBlock(block, change(span(2, 9, 3, 0), ''))).toEqual({ where: 'inside', block: span(2, 9, 4, 30) });
    // Delete at the end of its last line joins the next line to it.
    expect(followBlock(block, change(span(5, 30, 6, 0), ''))).toEqual({ where: 'inside', block: span(3, 0, 5, 30) });
    expect(followBlock(block, change(span(1, 0, 4, 2), 'x'))).toEqual({ where: 'inside', block: span(1, 0, 2, 30) });
    // The whole block deleted, with its last line break: nothing left of it but its place.
    expect(followBlock(block, change(span(3, 0, 6, 0), ''))).toEqual({ where: 'inside', block: span(3, 0, 3, 0) });
  });
});

describe('the imports a recorded block needs', () => {
  const spec = [
    "import { test } from '@playwright/test';",
    'import {',
    '  expect,',
    "} from '@playwright/test';",
    '',
    "test('pays', async ({ page }) => {});",
  ];

  test('go after the last top-level import statement', () => {
    expect(importInsertion(spec, ["import { CartPage } from './pages/cart.page';"])).toEqual({
      range: span(4, 0, 4, 0),
      text: "import { CartPage } from './pages/cart.page';\n",
    });
  });

  test('go at the top of a file without imports, or at its end after a last import line', () => {
    expect(importInsertion(["test('a', () => {});"], ["import { a } from './a';"])).toEqual({
      range: span(0, 0, 0, 0),
      text: "import { a } from './a';\n",
    });
    expect(importInsertion(["import { b } from './b';"], ["import { a } from './a';"])).toEqual({
      range: span(0, 24, 0, 24),
      text: "\nimport { a } from './a';",
    });
  });

  test('are left out when the file has them, written another way', () => {
    const lines = [`import {test} from "@playwright/test"`, "import { CartPage } from './pages/cart.page';"];
    expect(
      importInsertion(lines, [
        "import { test } from '@playwright/test';",
        "import { CartPage } from './pages/cart.page'",
      ]),
    ).toBeNull();
    expect(importInsertion(lines, ["import { a } from './a';", "import { a } from './a';"])?.text).toBe(
      "\nimport { a } from './a';",
    );
  });

  test('count what an edit writes, and not the lines it replaces', () => {
    const imports = ["import { a } from './a';"];
    expect(importInsertion(['x', 'y'], imports, { start: 0, end: 0 }, "import { a } from './a';")).toBeNull();
    expect(importInsertion(["import { a } from './a';", 'y'], imports, { start: 0, end: 0 }, 'z')).toEqual({
      range: span(0, 0, 0, 0),
      text: "import { a } from './a';\n",
    });
  });
});

describe('where a recording writes', () => {
  test('outside every test, function and class, a new test; anywhere else, the steps there', () => {
    expect(recordInto('test')).toBe('steps');
    expect(recordInto('function')).toBe('steps');
    expect(recordInto('class')).toBe('steps');
    expect(recordInto('file')).toBe('test');
  });
});

describe('writing the recorded block', () => {
  const spec = [
    "import { test } from '@playwright/test';",
    '',
    "test('pays', async ({ page }) => {",
    "  await page.goto('/cart');",
    '});',
    '',
  ];
  const text = spec.join('\n');
  const steps = recordedBlockText(
    "await page.getByRole('button', { name: 'Pay' }).click();\nawait page.reload();",
    '  ',
  );

  test('the first write puts the block on a new line where the placement says', () => {
    const write = writeBlock(spec, placedBlock({ line: 4, newLine: true, indent: '  ' }), steps, []);
    expect(write.block).toEqual(span(4, 0, 5, 22));
    expect(applied(text, write.changes).split('\n')).toEqual([
      "import { test } from '@playwright/test';",
      '',
      "test('pays', async ({ page }) => {",
      "  await page.goto('/cart');",
      "  await page.getByRole('button', { name: 'Pay' }).click();",
      '  await page.reload();',
      '});',
      '',
    ]);
  });

  test('or in place of the blank line it names, unless something was typed there since', () => {
    const lines = ['a', '   ', 'b'];
    const write = writeBlock(lines, placedBlock({ line: 1, newLine: false, indent: '' }), 'one\ntwo', []);
    expect(applied(lines.join('\n'), write.changes)).toBe('a\none\ntwo\nb');
    expect(write.block).toEqual(span(1, 0, 2, 3));
    const typed = ['a', 'typed', 'b'];
    const kept = writeBlock(typed, placedBlock({ line: 1, newLine: false, indent: '' }), 'one', []);
    expect(applied(typed.join('\n'), kept.changes)).toBe('a\none\ntyped\nb');
  });

  test('a placement past the last line goes after it', () => {
    const write = writeBlock(['a', 'b'], placedBlock({ line: 2, newLine: true, indent: '' }), 'c', []);
    expect(applied('a\nb', write.changes)).toBe('a\nb\nc');
    expect(write.block).toEqual(span(2, 0, 2, 1));
  });

  test('later writes replace the block, and the missing imports go in the same edit', () => {
    const lines = [...spec.slice(0, 4), ...steps.split('\n'), ...spec.slice(4)];
    const block: RecordedBlock = { range: span(4, 0, 5, 22), first: null };
    const next = recordedBlockText('const cartPage = new CartPage(page);\nawait cartPage.pay();', '  ');
    const write = writeBlock(lines, block, next, ["import { CartPage } from './pages/cart.page';"]);
    expect(applied(lines.join('\n'), write.changes).split('\n')).toEqual([
      "import { test } from '@playwright/test';",
      "import { CartPage } from './pages/cart.page';",
      '',
      "test('pays', async ({ page }) => {",
      "  await page.goto('/cart');",
      '  const cartPage = new CartPage(page);',
      '  await cartPage.pay();',
      '});',
      '',
    ]);
    expect(write.block).toEqual(span(5, 0, 6, 23));
  });

  test('a whole file holds its imports itself', () => {
    const file = "import { test } from '@playwright/test';\nimport { CartPage } from './pages/cart.page';\n\ntest();";
    const write = writeBlock([''], placedBlock({ line: 0, newLine: false, indent: '' }), file, [
      "import { CartPage } from './pages/cart.page';",
    ]);
    expect(write.changes).toEqual([change(span(0, 0, 0, 0), file)]);
    expect(write.block).toEqual(span(0, 0, 3, 7));
  });

  test('the block keeps lines of its own when an edit left other code on its first or last line', () => {
    const lines = ['before();', 'x = 1; old();', 'after();'];
    const block: RecordedBlock = { range: span(1, 7, 1, 13), first: null };
    const write = writeBlock(lines, block, 'one();', []);
    expect(applied(lines.join('\n'), write.changes)).toBe('before();\nx = 1; \none();\nafter();');
    expect(write.block).toEqual(span(2, 0, 2, 6));
    const emptied: RecordedBlock = { range: span(1, 0, 1, 0), first: null };
    expect(applied('a\nb', writeBlock(['a', 'b'], emptied, 'one', []).changes)).toBe('a\none\nb');
  });

  test('through a recording: written, moved by an edit above, then written again in its new place', () => {
    let lines = spec;
    let block = placedBlock({ line: 4, newLine: true, indent: '  ' });
    const first = writeBlock(lines, block, recordedBlockText('await page.reload();', '  '), []);
    lines = applied(lines.join('\n'), first.changes).split('\n');
    block = { range: first.block, first: null };
    const above = change(span(1, 0, 1, 0), '// the cart\n');
    lines = applied(lines.join('\n'), [above]).split('\n');
    block = { ...block, range: followBlock(block.range, above).block };
    const second = writeBlock(lines, block, steps, []);
    expect(applied(lines.join('\n'), second.changes).split('\n')).toEqual([
      "import { test } from '@playwright/test';",
      '// the cart',
      '',
      "test('pays', async ({ page }) => {",
      "  await page.goto('/cart');",
      "  await page.getByRole('button', { name: 'Pay' }).click();",
      '  await page.reload();',
      '});',
      '',
    ]);
  });
});

describe('the recording’s controls', () => {
  test('say its state and step count, with Stop and Pause or Resume', () => {
    expect(recordingView('recording', 6, false, 'checkout.spec.ts')).toEqual({
      title: '$(record) Recording · 6 steps',
      actions: [
        { title: 'Stop', command: 'piwi.stopRecording' },
        { title: 'Pause', command: 'piwi.pauseRecording' },
      ],
      status: '$(record) Piwi: recording · 6 steps',
      tooltip: 'Recording into checkout.spec.ts. Click to stop.',
    });
    expect(recordingView('paused', 1, false, 'a.spec.ts')).toMatchObject({
      title: '$(debug-pause) Paused · 1 step',
      actions: [
        { title: 'Stop', command: 'piwi.stopRecording' },
        { title: 'Resume', command: 'piwi.resumeRecording' },
      ],
    });
    expect(recordingView('starting', 0, false, 'a.spec.ts').actions).toEqual([
      { title: 'Stop', command: 'piwi.stopRecording' },
    ]);
  });

  test('an edit in the block pauses it, with Resume and Keep my edits', () => {
    expect(recordingView('recording', 2, true, 'a.spec.ts')).toMatchObject({
      title: '$(debug-pause) Paused while you edit · 2 steps',
      actions: [
        { title: 'Resume', command: 'piwi.resumeRecording' },
        { title: 'Keep my edits', command: 'piwi.stopRecording' },
      ],
    });
  });

  test('once stopped, a notification counts the steps and the warnings', () => {
    const step = { words: 'Click Pay', line: 0, locators: [], chosen: null };
    const warning = { step: 0, line: 0, message: 'Brittle locator' };
    expect(recordingSummary({ steps: [step, step], warnings: [warning], message: null }, false)).toBe(
      'Piwi: recording stopped, 2 steps written, 1 warning to check.',
    );
    expect(recordingSummary({ steps: [step], warnings: [], message: 'The browser was closed' }, false)).toBe(
      'Piwi: The browser was closed. 1 step written.',
    );
    expect(recordingSummary({ steps: [step], warnings: [], message: null }, true)).toBe(
      'Piwi: recording stopped. The recorded block keeps your edits.',
    );
  });
});

describe('a new test file', () => {
  test('goes in the folder the Playwright config tests', () => {
    expect(configTestDir("export default defineConfig({\n  testDir: './e2e',\n  use: {} });")).toBe('./e2e');
    expect(configTestDir('export default defineConfig({ testDir: path.join(__dirname, "e2e") });')).toBeNull();
  });

  test('is named after the test files around it', () => {
    expect(newTestFileName('/w/tests/cart.test.js')).toBe('recorded.test.js');
    expect(newTestFileName('/w/playwright.config.mjs')).toBe('recorded.spec.js');
    expect(newTestFileName('/w/playwright.config.ts')).toBe('recorded.spec.ts');
    expect(newTestFileName(null)).toBe('recorded.spec.ts');
  });
});
