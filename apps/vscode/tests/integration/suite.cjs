// Runs inside VS Code's extension host (see run.mjs): each test drives the
// editor through its public commands, as a user's actions would.
const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

const workspace = process.env.PIWI_TEST_WORKSPACE;
const pageObject = vscode.Uri.file(path.join(workspace, 'tests', 'pages', 'checkout.page.ts'));

// Retries through cancellations too: a request made while a document opens can be canceled.
async function waitFor(read, what, ms = 30_000) {
  const start = Date.now();
  for (;;) {
    const value = await Promise.resolve()
      .then(read)
      .catch(() => null);
    if (value) return value;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const tests = {
  async 'the extension activates on a workspace with a Playwright config'() {
    const extension = vscode.extensions.getExtension('piwitests.piwi');
    assert.ok(extension, 'the extension is installed');
    await extension.activate();
    assert.equal(extension.isActive, true);
  },

  async 'the latest run’s failure is in the Problems panel at its failing line'() {
    const failure = await waitFor(
      () => vscode.languages.getDiagnostics(pageObject).find((d) => d.code?.value === 'ci-failure'),
      'the CI failure diagnostic',
    );
    assert.equal(failure.severity, vscode.DiagnosticSeverity.Error);
    assert.equal(failure.range.start.line, 4);
    assert.equal(failure.message, "locator('.cart-row').nth(2) was not found (removes a row, run #41)");
  },

  async 'its quick fixes heal in place and open the evidence'() {
    await vscode.window.showTextDocument(pageObject);
    const failure = vscode.languages.getDiagnostics(pageObject).find((d) => d.code?.value === 'ci-failure');
    const actions = await waitFor(async () => {
      const found = await vscode.commands.executeCommand(
        'vscode.executeCodeActionProvider',
        pageObject,
        failure.range,
        vscode.CodeActionKind.QuickFix.value,
      );
      return found?.some((a) => a.title.startsWith('Heal')) ? found : null;
    }, 'the heal quick fix');
    const titles = actions.map((a) => a.title);
    assert.ok(titles.includes("Heal: use getByRole('row', { name: /Mug/ })"), titles.join(' | '));
    assert.ok(titles.includes('Open the trace'), titles.join(' | '));
    assert.ok(titles.includes('Open the failure in the dashboard'), titles.join(' | '));
    assert.ok(titles.includes('Copy context for agent'), titles.join(' | '));
    const copy = actions.find((a) => a.title === 'Copy context for agent');
    await vscode.commands.executeCommand(copy.command.command, ...copy.command.arguments);
    assert.match(await vscode.env.clipboard.readText(), /^# Failing test: removes a row/);

    const heal = actions.find((a) => a.title.startsWith('Heal'));
    assert.ok(await vscode.workspace.applyEdit(heal.edit));
    const document = await vscode.workspace.openTextDocument(pageObject);
    assert.equal(document.lineAt(4).text, "  row = () => this.page.getByRole('row', { name: /Mug/ });");
    await vscode.commands.executeCommand('undo');
  },

  async 'CodeLens shows the tests behind each locator line'() {
    const lenses = await waitFor(async () => {
      const found = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', pageObject);
      return found?.length ? found : null;
    }, 'the CodeLens');
    const titles = lenses.map((l) => l.command?.title);
    assert.ok(titles.includes('1 test · click'), titles.join(' | '));
    assert.ok(titles.includes('1 test · click · 1 failing'), titles.join(' | '));
  },

  async 'hover shows the failure'() {
    const hovers = await vscode.commands.executeCommand(
      'vscode.executeHoverProvider',
      pageObject,
      new vscode.Position(4, 30),
    );
    const text = hovers
      .flatMap((h) => h.contents)
      .map((c) => (typeof c === 'string' ? c : c.value))
      .join('\n');
    assert.match(text, /\*\*CI failure\*\* · \[removes a row\]/);
  },

  async 'page. completes with the chains the suite uses on this file’s pages'() {
    const spec = vscode.Uri.file(path.join(workspace, 'tests', 'checkout.spec.ts'));
    const editor = await vscode.window.showTextDocument(spec);
    const end = editor.document.lineAt(2).range.end;
    await editor.edit((e) => e.insert(end, '\n  page.'));
    const list = await waitFor(async () => {
      const found = await vscode.commands.executeCommand(
        'vscode.executeCompletionItemProvider',
        spec,
        new vscode.Position(3, '  page.'.length),
        '.',
      );
      return found?.items.some((i) => (typeof i.label === 'string' ? i.label : i.label.label).startsWith('locator('))
        ? found
        : null;
    }, 'the locator completion');
    const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
    assert.ok(labels.includes("locator('.cart-row').nth(2)"), labels.slice(0, 5).join(' | '));
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  },

  async 'Piwi Picker sends a locator and a recorded flow to the cursor'() {
    await vscode.commands.executeCommand('piwi.pairPicker');
    const pairing = await vscode.env.clipboard.readText();
    const [url, token] = pairing.split('#');
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/piwi\/send$/);
    const spec = vscode.Uri.file(path.join(workspace, 'tests', 'checkout.spec.ts'));
    const editor = await vscode.window.showTextDocument(spec);
    const end = editor.document.lineAt(2).range.end;
    editor.selection = new vscode.Selection(end, end);
    await editor.edit((e) => e.insert(end, '\n  '));
    const send = (body) =>
      fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    const locator = await send({ kind: 'locator', text: "page.getByRole('button', { name: 'Pay now' })" });
    assert.equal(locator.status, 200);
    assert.equal((await locator.json()).file, spec.fsPath);
    assert.ok(editor.document.getText().includes("  page.getByRole('button', { name: 'Pay now' })"));

    await editor.edit((e) => e.insert(editor.selection.active, '\n  '));
    const steps = await send({
      kind: 'steps',
      steps: {
        v: 1,
        title: null,
        origin: 'https://shop.test',
        recordedAt: 1000,
        note: null,
        steps: [
          { action: 'goto', target: null, value: '/cart', redacted: false, pageUrl: '/cart', timestamp: 1 },
          {
            action: 'click',
            target: {
              tagName: 'button',
              role: 'button',
              accessibleName: 'Pay now',
              testId: null,
              text: 'Pay now',
              alternatives: [{ locator: "getByRole('button', { name: 'Pay now' })", method: 'getByRole', score: 90 }],
            },
            value: null,
            redacted: false,
            pageUrl: '/cart',
            timestamp: 2,
          },
        ],
      },
    });
    assert.equal(steps.status, 200, await steps.clone().text());
    assert.ok(editor.document.getText().includes("  await page.getByRole('button', { name: 'Pay now' }).click();"));

    const refused = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer nope' }, body: '{}' });
    assert.equal(refused.status, 401);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  },

  async 'the page recorded steps run on is offered from the code around the cursor'() {
    const api = vscode.extensions.getExtension('piwitests.piwi').exports;
    const spec = vscode.Uri.file(path.join(workspace, 'tests', 'admin.spec.ts'));
    await vscode.workspace.openTextDocument(spec);
    const inTest = await waitFor(
      () => api.pageCandidates({ uri: spec.toString(), line: 4, character: 2 }),
      'the page candidates in a test',
    );
    const expressions = inTest.candidates.map((c) => c.expression);
    assert.equal(inTest.context, 'test');
    assert.equal(inTest.default, 'adminPage');
    assert.ok(expressions.includes('adminPage') && expressions.includes('page'), expressions.join(' | '));
    const inClass = await api.pageCandidates({ uri: pageObject.toString(), line: 4, character: 2 });
    assert.equal(inClass.context, 'class');
    assert.equal(inClass.default, 'this.page');
  },

  async 'the commands are registered'() {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'piwi.connect',
      'piwi.disconnect',
      'piwi.openSettings',
      'piwi.refresh',
      'piwi.refreshRun',
      'piwi.runTestsForFile',
      'piwi.openInDashboard',
      'piwi.openRun',
      'piwi.openTrace',
      'piwi.runTests',
      'piwi.copyMcpConfiguration',
      'piwi.pairPicker',
      'piwi.runCommand',
      'piwi.copyText',
      'piwi.runSelection',
      'piwi.record',
      'piwi.recordFile',
      'piwi.stopRecording',
      'piwi.pauseRecording',
      'piwi.resumeRecording',
    ]) {
      assert.ok(commands.includes(id), id);
    }
    await vscode.commands.executeCommand('piwi.refresh');
    await vscode.commands.executeCommand('piwi.refreshRun');
  },
};

exports.run = async function run() {
  const failures = [];
  for (const [name, fn] of Object.entries(tests)) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.log(`  ✗ ${name}\n    ${e && e.stack ? e.stack : e}`);
      failures.push(name);
    }
  }
  if (failures.length) throw new Error(`${failures.length} integration test(s) failed`);
};
