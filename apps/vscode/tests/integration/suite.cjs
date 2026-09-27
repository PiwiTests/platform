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

  async 'the commands are registered'() {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'piwi.connect',
      'piwi.refresh',
      'piwi.runTestsForFile',
      'piwi.openInDashboard',
      'piwi.openRun',
      'piwi.openTrace',
      'piwi.runTests',
      'piwi.copyMcpConfiguration',
    ]) {
      assert.ok(commands.includes(id), id);
    }
    await vscode.commands.executeCommand('piwi.refresh');
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
