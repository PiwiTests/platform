/**
 * The Piwi extension for VS Code: a thin client of the editor service. The
 * service (bundled beside this file) computes the diagnostics, quick fixes,
 * hover and summary lines; this file starts it, draws the summary lines as
 * CodeLens and the latest run in the status bar, runs the commands those
 * lines name, keeps the API key in the secret store, hands Piwi's MCP
 * server to the editor's agent, and inserts what Piwi Picker sends.
 */
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node';
import {
  FILE_SUMMARY_REQUEST,
  MCP_REQUEST,
  REFRESH_REQUEST,
  RENDER_STEPS_REQUEST,
  RUN_ARGS_REQUEST,
  RUN_STATUS_NOTIFICATION,
  RUN_STATUS_REQUEST,
  DESKTOP_REQUEST,
  RUN_SELECTION_REQUEST,
  SELECTIONS_REQUEST,
  SET_CREDENTIALS_NOTIFICATION,
  STATUS_REQUEST,
  TESTS_FOR_FILE_REQUEST,
  TRACE_REQUEST,
  type DesktopResult,
  type EditorCredentials,
  type FileSummary,
  type McpServersResult,
  type RenderStepsResult,
  type RunCommand,
  type RunCommandArgs,
  type RunStatusResult,
  type RunTestsArgs,
  type SelectionsResult,
  type StatusResult,
  type TestsForFile,
  type TraceParams,
  type TraceResult,
} from '@piwitests/editor/protocol';
import type { EditorSendPayload } from '@piwitests/core/editor-send';
import { formatPairing } from '@piwitests/core/editor-send';
import {
  API_KEY_SECRET_PREFIX,
  InstanceError,
  apiKeySecret,
  listProjects,
  needsKey,
  normalizeServerUrl,
  startSignIn,
  waitForSignIn,
  type ProjectItem,
} from './connect';
import {
  DOCUMENT_PATTERN,
  disconnectQuestion,
  indentBlock,
  mcpConfiguration,
  sourceLabel,
  statusBarView,
} from './glue';
import { startSendListener, type SendListener, type SendResult } from './send-listener';

/** The key every instance shared before keys were kept per instance; removed once. */
const SHARED_SECRET_KEY = 'piwi.apiKey';
const SHARED_KEY_FORGOTTEN = 'piwi.sharedKeyForgotten';
const MCP_OFFERED = 'piwi.mcpOffered';
const SEND_TOKEN = 'piwi.sendToken';
const SEND_PORT = 'piwi.sendPort';

/** The MCP provider API (VS Code 1.101 and later), read at runtime so older editors still load the extension. */
interface McpApi {
  registerMcpServerDefinitionProvider(
    id: string,
    provider: {
      onDidChangeMcpServerDefinitions: vscode.Event<void>;
      provideMcpServerDefinitions(): Promise<unknown[]>;
    },
  ): vscode.Disposable;
}
type McpHttpServerDefinitionClass = new (label: string, uri: vscode.Uri, headers?: Record<string, string>) => unknown;

let client: LanguageClient | null = null;
let sendListener: SendListener | null = null;

/** The connection saved in the editor: the workspace's instance and project, and that instance's key. */
async function credentials(context: vscode.ExtensionContext): Promise<EditorCredentials> {
  const settings = vscode.workspace.getConfiguration('piwi');
  const serverUrl = normalizeServerUrl(settings.get<string>('serverUrl')) ?? null;
  return {
    serverUrl,
    project: settings.get<string>('project') || null,
    apiKey: serverUrl ? ((await context.secrets.get(apiKeySecret(serverUrl))) ?? null) : null,
  };
}

/**
 * Earlier versions kept one key for every instance, which a workspace naming another
 * instance would have sent there. It is removed once: connect again to save it per instance.
 */
async function forgetSharedKey(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get(SHARED_KEY_FORGOTTEN)) return;
  await context.secrets.delete(SHARED_SECRET_KEY);
  await context.globalState.update(SHARED_KEY_FORGOTTEN, true);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await forgetSharedKey(context);
  const serverModule = vscode.Uri.joinPath(context.extensionUri, 'dist', 'piwi-language-server.cjs').fsPath;
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.stdio },
    debug: { module: serverModule, transport: TransportKind.stdio },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', pattern: DOCUMENT_PATTERN }],
    initializationOptions: { credentials: await credentials(context) },
  };
  const lc = new LanguageClient('piwi', 'Piwi', serverOptions, clientOptions);
  client = lc;

  const lensesChanged = new vscode.EventEmitter<void>();
  const mcpChanged = new vscode.EventEmitter<void>();
  const statusItem = vscode.window.createStatusBarItem('piwi.status', vscode.StatusBarAlignment.Left, 50);
  statusItem.name = 'Piwi';
  let statusUrl: string | null = null;
  let lastServers = '';
  context.subscriptions.push(lensesChanged, mcpChanged, statusItem);

  const updateStatus = async (runs?: RunStatusResult) => {
    const status = await lc.sendRequest<StatusResult>(STATUS_REQUEST).catch(() => null);
    const runStatus = runs ?? (await lc.sendRequest<RunStatusResult>(RUN_STATUS_REQUEST).catch(() => null));
    const view = statusBarView(status, runStatus);
    statusItem.text = view.text;
    statusItem.tooltip = view.tooltip;
    statusUrl = view.url;
    statusItem.command =
      view.action === 'open' ? 'piwi.openRun' : view.action === 'connect' ? 'piwi.connect' : undefined;
    statusItem.backgroundColor = view.error ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
    statusItem.show();
    void vscode.commands.executeCommand('setContext', 'piwi.active', !!status?.contexts.some((c) => c.connected));
    lensesChanged.fire();
    const servers = await lc.sendRequest<McpServersResult>(MCP_REQUEST).catch(() => null);
    const serialized = JSON.stringify(servers?.servers ?? []);
    if (serialized !== lastServers) {
      lastServers = serialized;
      mcpChanged.fire();
      if (servers?.servers.length) void offerMcp(context, servers);
    }
  };

  // The terminal of each directory tests run in, reused while it is open.
  const terminals = new Map<string, vscode.Terminal>();
  const runInTerminal = (cwd: string, command: string) => {
    let terminal = terminals.get(cwd);
    if (!terminal || terminal.exitStatus) {
      terminal = vscode.window.createTerminal({ name: 'Piwi', cwd });
      terminals.set(cwd, terminal);
    }
    terminal.show();
    terminal.sendText(command);
  };
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((t) => {
      for (const [cwd, terminal] of terminals) if (terminal === t) terminals.delete(cwd);
    }),
  );

  const runTests = async (args: RunTestsArgs) => {
    const command = await lc.sendRequest<RunCommand | null>(RUN_ARGS_REQUEST, args);
    if (!command) {
      void vscode.window.showWarningMessage('Piwi: no command to run these tests (not connected?).');
      return;
    }
    runInTerminal(command.cwd, command.command);
  };

  const activeUri = () => vscode.window.activeTextEditor?.document.uri.toString() ?? null;

  context.subscriptions.push(
    vscode.commands.registerCommand('piwi.connect', async () => {
      if (await connect(context, lc)) await updateStatus();
    }),
    vscode.commands.registerCommand('piwi.disconnect', async () => {
      if (await disconnect(context, lc)) await updateStatus();
    }),
    vscode.commands.registerCommand('piwi.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:piwitests.piwi'),
    ),
    vscode.commands.registerCommand('piwi.refresh', async () => {
      await lc.sendRequest(REFRESH_REQUEST);
      await updateStatus();
    }),
    vscode.commands.registerCommand('piwi.runTests', (args: RunTestsArgs) => runTests(args)),
    vscode.commands.registerCommand('piwi.runTestsForFile', async (target?: vscode.Uri) => {
      const uri = target?.toString() ?? activeUri();
      if (!uri) return;
      const found = await lc.sendRequest<TestsForFile>(TESTS_FOR_FILE_REQUEST, { uri });
      if (!found.tests.length) {
        void vscode.window.showInformationMessage('Piwi: no test reaches this file yet.');
        return;
      }
      await runTests({ uri, testIds: found.tests.map((t) => t.id) });
    }),
    vscode.commands.registerCommand('piwi.openInDashboard', async (url?: string) => {
      if (typeof url === 'string' && url) {
        await vscode.env.openExternal(vscode.Uri.parse(url));
        return;
      }
      const uri = activeUri();
      const found = uri ? await lc.sendRequest<TestsForFile>(TESTS_FOR_FILE_REQUEST, { uri }) : null;
      if (!found?.tests.length) {
        if (statusUrl) await vscode.env.openExternal(vscode.Uri.parse(statusUrl));
        return;
      }
      const picked =
        found.tests.length === 1
          ? found.tests[0]
          : await vscode.window
              .showQuickPick(
                found.tests.map((t) => ({ label: t.title, description: t.file, detail: t.status ?? undefined, t })),
                { placeHolder: 'Open which test in the dashboard?' },
              )
              .then((p) => p?.t);
      if (picked) await vscode.env.openExternal(vscode.Uri.parse(picked.url));
    }),
    vscode.commands.registerCommand('piwi.runCommand', (args: RunCommandArgs) => runInTerminal(args.cwd, args.command)),
    vscode.commands.registerCommand('piwi.copyText', async (text: string) => {
      await vscode.env.clipboard.writeText(text);
      void vscode.window.showInformationMessage('Piwi: copied. Paste it to your agent.');
    }),
    vscode.commands.registerCommand('piwi.runSelection', async () => {
      const uri = activeUri() ?? vscode.workspace.workspaceFolders?.[0]?.uri.toString() ?? '';
      const { items } = await lc.sendRequest<SelectionsResult>(SELECTIONS_REQUEST, { uri });
      if (!items.length) {
        void vscode.window.showInformationMessage('Piwi: this project has no selection yet.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        items.map((i) => ({
          label: i.name,
          description: `${i.count} ${i.count === 1 ? 'test' : 'tests'}`,
          detail: i.includesFile ? 'Includes a test of this file' : undefined,
          key: i.key,
        })),
        { placeHolder: 'Run which selection?' },
      );
      if (!picked) return;
      const command = await lc.sendRequest<RunCommand | null>(RUN_SELECTION_REQUEST, { uri, key: picked.key });
      if (command) runInTerminal(command.cwd, command.command);
    }),
    vscode.commands.registerCommand('piwi.openRun', async () => {
      if (statusUrl) await vscode.env.openExternal(vscode.Uri.parse(statusUrl));
    }),
    vscode.commands.registerCommand('piwi.openTrace', async (params: TraceParams) => {
      const trace = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Piwi: downloading the trace…' },
        () => lc.sendRequest<TraceResult | null>(TRACE_REQUEST, params),
      );
      if (!trace) {
        void vscode.window.showWarningMessage('Piwi: this failure has no trace to open.');
        return;
      }
      runInTerminal(trace.cwd, trace.command);
    }),
    vscode.commands.registerCommand('piwi.copyMcpConfiguration', async () => {
      const servers = await lc.sendRequest<McpServersResult>(MCP_REQUEST);
      if (!servers.servers.length) {
        void vscode.window.showWarningMessage('Piwi: connect to an instance first.');
        return;
      }
      await vscode.env.clipboard.writeText(mcpConfiguration(servers.servers));
      void vscode.window.showInformationMessage(
        'Piwi: the MCP configuration is on the clipboard. It holds your API key: paste it in your user settings, not in the repository.',
      );
    }),
    vscode.languages.registerCodeLensProvider(
      { scheme: 'file', pattern: DOCUMENT_PATTERN },
      {
        onDidChangeCodeLenses: lensesChanged.event,
        async provideCodeLenses(document) {
          const summary = await lc
            .sendRequest<FileSummary>(FILE_SUMMARY_REQUEST, { uri: document.uri.toString() })
            .catch(() => null);
          if (!summary) return [];
          return [...(summary.file ? [summary.file] : []), ...summary.lines].map((line) => {
            const range = new vscode.Range(line.line, 0, line.line, 0);
            return new vscode.CodeLens(range, {
              title: line.title,
              command: line.command?.command ?? '',
              arguments: line.command?.arguments ?? [],
            });
          });
        },
      },
    ),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('piwi'))
        await lc.sendNotification(SET_CREDENTIALS_NOTIFICATION, await credentials(context));
    }),
    context.secrets.onDidChange(async (e) => {
      if (e.key.startsWith(API_KEY_SECRET_PREFIX))
        await lc.sendNotification(SET_CREDENTIALS_NOTIFICATION, await credentials(context));
    }),
  );

  const lm = (vscode as unknown as { lm?: Partial<McpApi> }).lm;
  const McpHttpServerDefinition = (vscode as unknown as { McpHttpServerDefinition?: McpHttpServerDefinitionClass })
    .McpHttpServerDefinition;
  if (lm?.registerMcpServerDefinitionProvider && McpHttpServerDefinition) {
    context.subscriptions.push(
      lm.registerMcpServerDefinitionProvider('piwi.mcp', {
        onDidChangeMcpServerDefinitions: mcpChanged.event,
        async provideMcpServerDefinitions() {
          const servers = await lc.sendRequest<McpServersResult>(MCP_REQUEST).catch(() => null);
          return (servers?.servers ?? []).map(
            (s) => new McpHttpServerDefinition(s.label, vscode.Uri.parse(s.url), s.headers),
          );
        },
      }),
    );
  }

  // Send to editor: the token lives in the secret store, the port in global state, so a pairing survives restarts.
  let sendToken = (await context.secrets.get(SEND_TOKEN)) ?? '';
  const listen = async (port: number) => {
    sendListener = await startSendListener({
      port,
      token: () => sendToken,
      onPayload: (payload) => insertFromPicker(lc, payload),
    });
    return sendListener;
  };
  const pairedPort = context.globalState.get<number>(SEND_PORT);
  // Another window may hold the port: that window keeps the pairing.
  if (pairedPort && sendToken) await listen(pairedPort).catch(() => null);
  context.subscriptions.push(
    vscode.commands.registerCommand('piwi.pairPicker', async () => {
      if (!sendToken) {
        sendToken = randomBytes(24).toString('base64url');
        await context.secrets.store(SEND_TOKEN, sendToken);
      }
      const listener = sendListener ?? (await listen(pairedPort ?? 0).catch(() => listen(0)));
      await context.globalState.update(SEND_PORT, listener.port);
      await vscode.env.clipboard.writeText(formatPairing({ url: listener.url, token: sendToken }));
      void vscode.window.showInformationMessage(
        "Piwi: the pairing address is on the clipboard. Paste it in Piwi Picker's options, under Send to editor.",
      );
    }),
    { dispose: () => void sendListener?.close() },
  );

  context.subscriptions.push(
    lc.onNotification(RUN_STATUS_NOTIFICATION, (runs: RunStatusResult) => void updateStatus(runs)),
  );
  await lc.start();
  await updateStatus();
}

/** Insert what Piwi Picker sent at the cursor of the active editor, or in a new editor when none is open. */
async function insertFromPicker(lc: LanguageClient, payload: EditorSendPayload): Promise<SendResult> {
  const active = vscode.window.activeTextEditor;
  let text: string;
  if (payload.kind === 'locator') {
    text = payload.text;
  } else {
    const rendered = await lc.sendRequest<RenderStepsResult>(RENDER_STEPS_REQUEST, {
      uri: active?.document.uri.toString() ?? '',
      steps: payload.steps,
    });
    if (!rendered.code) throw new Error(rendered.warnings.join('; ') || 'nothing to insert');
    text = rendered.code;
  }
  if (!active) {
    const document = await vscode.workspace.openTextDocument({ language: 'typescript', content: text });
    await vscode.window.showTextDocument(document);
    return { inserted: true, file: null };
  }
  const line = active.document.lineAt(active.selection.active.line).text;
  const indent = line.slice(0, line.length - line.trimStart().length);
  const inserted = await active.edit((edit) => edit.replace(active.selection, indentBlock(text, indent)));
  if (inserted) {
    void vscode.window.showInformationMessage(
      payload.kind === 'locator'
        ? 'Piwi: inserted the locator from Piwi Picker.'
        : 'Piwi: inserted the recorded steps from Piwi Picker.',
    );
  }
  return { inserted, file: active.document.uri.scheme === 'file' ? active.document.uri.fsPath : null };
}

/** Once per machine: tell where Piwi's MCP server went, or offer its configuration where the editor has no provider API. */
async function offerMcp(context: vscode.ExtensionContext, servers: McpServersResult): Promise<void> {
  if (context.globalState.get(MCP_OFFERED) || !servers.servers.length) return;
  await context.globalState.update(MCP_OFFERED, true);
  const hasApi = !!(vscode as unknown as { lm?: Partial<McpApi> }).lm?.registerMcpServerDefinitionProvider;
  if (hasApi) {
    void vscode.window.showInformationMessage(
      "Piwi's MCP server is listed for the editor's agent: it can read your suite's failures, flaky tests and healings.",
    );
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    "Add Piwi's MCP server to your agent? It can read your suite's failures, flaky tests and healings.",
    'Copy the configuration',
  );
  if (choice) await vscode.commands.executeCommand('piwi.copyMcpConfiguration');
}

/**
 * Piwi: Connect — the instance, a key for it (signed in with the browser, or pasted; kept in
 * the secret store under that instance), and the project. Returns whether it saved a connection.
 */
async function connect(context: vscode.ExtensionContext, lc: LanguageClient): Promise<boolean> {
  const settings = vscode.workspace.getConfiguration('piwi');
  // The desktop app running on this machine needs no address or sign-in: offer it first.
  const desktop = await lc
    .sendRequest<DesktopResult>(DESKTOP_REQUEST)
    .then((d) => (d.url ? d : null))
    .catch(() => null);
  if (desktop) {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: '$(device-desktop) Use the Piwi desktop app',
          description: desktop.url ?? '',
          detail: desktop.linked
            ? `This folder is linked there to the project ${desktop.linked.name}.`
            : 'It runs on this machine; no address or key needed.',
          desktop: true,
        },
        { label: '$(globe) Another instance…', detail: 'A Piwi server, by its address.', desktop: false },
      ],
      { title: 'Piwi: Connect', placeHolder: 'Connect to', ignoreFocusOut: true },
    );
    if (!choice) return false;
    if (choice.desktop) return useDesktop(context, lc, desktop);
  }
  const input = await vscode.window.showInputBox({
    title: 'Piwi: Connect',
    prompt: "The Piwi instance's address",
    value: settings.get<string>('serverUrl') || 'http://localhost:3000',
    ignoreFocusOut: true,
    validateInput: (v) => (normalizeServerUrl(v) ? null : 'An http(s) URL, such as https://piwi.example.com'),
  });
  const base = normalizeServerUrl(input);
  if (!base) return false;
  if (desktop && base === desktop.url) return useDesktop(context, lc, desktop);
  let apiKey: string | null = null;
  let projects: ProjectItem[];
  try {
    const asks = await progress(`Piwi: reaching ${base}…`, () => needsKey(base));
    if (asks) {
      const how = await vscode.window.showQuickPick(
        [
          {
            label: '$(globe) Sign in with the browser',
            detail: 'Allow this editor on the instance; it creates an API key named after it.',
            how: 'browser' as const,
          },
          {
            label: '$(key) Paste an API key',
            detail: "From the dashboard's Settings → API keys.",
            how: 'paste' as const,
          },
        ],
        { title: 'Piwi: Connect', placeHolder: `${base} asks for an API key`, ignoreFocusOut: true },
      );
      if (!how) return false;
      apiKey = how.how === 'browser' ? await signIn(base) : await pasteKey();
      if (!apiKey) return false;
    }
    projects = await progress(`Piwi: listing the projects of ${base}…`, () => listProjects(base, apiKey));
  } catch (e) {
    const reason =
      e instanceof InstanceError && (e.status === 401 || e.status === 403)
        ? `the instance refused the key (${e.status})`
        : (e as Error).message;
    void vscode.window.showErrorMessage(`Piwi: could not connect to ${base}: ${reason}`);
    return false;
  }
  let project = '';
  if (projects.length) {
    const picked = await vscode.window.showQuickPick(
      projects.map((p) => ({ label: p.name, description: `#${p.id}` })),
      { title: 'Piwi: Connect', placeHolder: 'The project this workspace reports to', ignoreFocusOut: true },
    );
    if (!picked) return false;
    project = picked.label;
  }
  await settings.update('serverUrl', base, vscode.ConfigurationTarget.Workspace);
  await settings.update('project', project || undefined, vscode.ConfigurationTarget.Workspace);
  if (apiKey) await context.secrets.store(apiKeySecret(base), apiKey);
  else await context.secrets.delete(apiKeySecret(base));
  await lc.sendNotification(SET_CREDENTIALS_NOTIFICATION, await credentials(context));
  await lc.sendRequest(REFRESH_REQUEST).catch(() => null);
  const status = await lc.sendRequest<StatusResult>(STATUS_REQUEST).catch(() => null);
  // The environment and a workspace `.env` come before the settings.
  const first = status?.contexts.find(
    (c) => (c.source === 'environment' || c.source === 'dotenv') && c.serverUrl !== base,
  );
  if (first) {
    void vscode.window.showWarningMessage(
      `Piwi: saved, but ${sourceLabel(first.source)} names ${first.serverUrl}, which comes before the settings.`,
    );
  } else if (!project) {
    void vscode.window.showInformationMessage(
      `Piwi: ${base} has no project yet. Send a run with the Piwi reporter, then run Piwi: Connect again.`,
    );
  } else {
    void vscode.window.showInformationMessage(`Piwi: connected to ${project} on ${base}.`);
  }
  return true;
}

/**
 * Use the desktop app: no address and no key are saved, so the service reads them from the
 * app while it runs. The project is the one linked there to this folder, else the one picked.
 */
async function useDesktop(
  context: vscode.ExtensionContext,
  lc: LanguageClient,
  desktop: DesktopResult,
): Promise<boolean> {
  const settings = vscode.workspace.getConfiguration('piwi');
  let project: string | undefined;
  if (!desktop.linked && desktop.projects.length) {
    const picked = await vscode.window.showQuickPick(
      desktop.projects.map((p) => ({ label: p.name, description: `#${p.id}` })),
      {
        title: 'Piwi: Connect',
        placeHolder: 'The project this workspace reports to (link this folder in the desktop app to skip this step)',
        ignoreFocusOut: true,
      },
    );
    if (!picked) return false;
    project = picked.label;
  }
  await settings.update('serverUrl', undefined, vscode.ConfigurationTarget.Workspace);
  await settings.update('project', project, vscode.ConfigurationTarget.Workspace);
  await lc.sendNotification(SET_CREDENTIALS_NOTIFICATION, await credentials(context));
  await lc.sendRequest(REFRESH_REQUEST).catch(() => null);
  const name = desktop.linked?.name ?? project;
  void vscode.window.showInformationMessage(
    name
      ? `Piwi: connected to the desktop app, project ${name}${desktop.linked ? ' (linked to this folder)' : ''}.`
      : "Piwi: the desktop app has no project yet. Import or send a run to it, then link this folder on the project's page there.",
  );
  return true;
}

/** Piwi: Disconnect — forget the workspace's instance and project, and the key saved for that instance. */
async function disconnect(context: vscode.ExtensionContext, lc: LanguageClient): Promise<boolean> {
  const settings = vscode.workspace.getConfiguration('piwi');
  const serverUrl = normalizeServerUrl(settings.get<string>('serverUrl'));
  const question = disconnectQuestion(serverUrl, settings.get<string>('project') || null);
  if (!question) {
    void vscode.window.showInformationMessage('Piwi: nothing is saved in the settings.');
    return false;
  }
  const answer = await vscode.window.showWarningMessage(`Piwi: ${question}`, { modal: true }, 'Disconnect');
  if (answer !== 'Disconnect') return false;
  if (serverUrl) await context.secrets.delete(apiKeySecret(serverUrl));
  await settings.update('serverUrl', undefined, vscode.ConfigurationTarget.Workspace);
  await settings.update('project', undefined, vscode.ConfigurationTarget.Workspace);
  await lc.sendNotification(SET_CREDENTIALS_NOTIFICATION, await credentials(context));
  await lc.sendRequest(REFRESH_REQUEST).catch(() => null);
  return true;
}

function progress<T>(title: string, task: () => Promise<T>): Promise<T> {
  return Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task));
}

async function pasteKey(): Promise<string | null> {
  const key = await vscode.window.showInputBox({
    title: 'Piwi: Connect',
    prompt: "An API key (pd_…), from the dashboard's Settings → API keys",
    password: true,
    ignoreFocusOut: true,
  });
  return key?.trim() || null;
}

/** The browser sign-in: the instance's page opens, the user allows this editor, and the key comes back. */
async function signIn(base: string): Promise<string | null> {
  let started;
  try {
    started = await progress('Piwi: starting the sign-in…', () =>
      startSignIn(base, { editor: vscode.env.appName, os: osName() }),
    );
  } catch (e) {
    if (!(e instanceof InstanceError && e.status === 404)) throw e;
    void vscode.window.showInformationMessage('Piwi: this instance predates the browser sign-in; paste an API key.');
    return pasteKey();
  }
  await vscode.env.openExternal(vscode.Uri.parse(started.verificationUrl));
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Piwi: allow the request in your browser. It shows the code ${started.userCode}.`,
      cancellable: true,
    },
    async (_progress, token) => {
      const cancel = new AbortController();
      token.onCancellationRequested(() => cancel.abort());
      return waitForSignIn(base, started, cancel.signal).catch((e: unknown) => {
        if (cancel.signal.aborted) return null;
        throw e;
      });
    },
  );
  if (!result) return null;
  if (result.status === 'approved' && result.apiKey) return result.apiKey;
  void vscode.window.showInformationMessage(
    result.status === 'denied'
      ? 'Piwi: the request was denied in the browser.'
      : 'Piwi: the request expired. Run Piwi: Connect again.',
  );
  return null;
}

function osName(): string {
  return process.platform === 'darwin'
    ? 'macOS'
    : process.platform === 'win32'
      ? 'Windows'
      : process.platform === 'linux'
        ? 'Linux'
        : process.platform;
}

export async function deactivate(): Promise<void> {
  await sendListener?.close();
  sendListener = null;
  await client?.stop();
  client = null;
}
