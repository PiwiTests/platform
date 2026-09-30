/**
 * The Piwi language server. VS Code and the JetBrains IDEs both run it, so
 * both show the same answers:
 *
 * - in test files, a warning on each brittle locator the index knows at that
 *   line (a hint for one worth a look), with the stable alternative stored at
 *   that call site as a quick fix, and a hover with its tests;
 * - in application files, a warning on each changed line whose string the
 *   project's locators find elements by, with the rewrite of every call site
 *   as a quick fix, as `piwi preflight` computes it for the unsaved buffer;
 * - the failures of the latest run on the checked-out branch, as errors at
 *   their failing lines in every file (the Problems panel), with the healing's
 *   edit as a quick fix and the trace, the screenshot and the execution page
 *   one action away;
 * - custom requests (`protocol.ts`) for the summary lines each editor draws
 *   natively above a file, a test and a locator line, the run status, a trace
 *   to open, and the MCP server to register.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CodeActionKind,
  CompletionItemKind,
  DiagnosticSeverity,
  InsertTextFormat,
  TextDocuments,
  TextDocumentSyncKind,
  type CodeAction,
  type CompletionItem,
  type Connection,
  type Diagnostic,
  type Hover,
  type InitializeParams,
  type TextEdit,
  type WorkspaceEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { renderSpec } from '@piwitests/core/codegen';
import { diffLines } from '@piwitests/core/line-diff';
import { canonicalLocator } from '@piwitests/core/locator-chain';
import { parseSteps, sessionFromSteps } from '@piwitests/core/steps';
import { locatorCallSiteFiles, sameFilePath, type LocatorBreak } from '@piwitests/core/locator-break';
import { stabilityLabels } from '@piwitests/core/locator-stability';
import type { LocatorIndexTest } from '@piwitests/core/locator-index';
import {
  applyPatchFile,
  breakMessage,
  breaksByAnchor,
  breaksOfChange,
  filePages,
  functionSnippet,
  functionSuggestions,
  locatorRange,
  locatorSuggestions,
  locatorsInFile,
  pageSummary,
  parsePatch,
  reachFrom,
  replaceLocatorOnLine,
  rewriteEdits,
  stabilityFindings,
  stableReplacement,
  testsReaching,
  timeoutEdit,
  timeoutMessage,
  type LineLocator,
} from './analysis.js';
import { PiwiContext, desktopConfigPath, linkedDesktopProject, readDesktopDiscovery } from './context.js';
import { PiwiClient, type BranchFailure, type FixPlan } from './piwi-client.js';
import {
  FAILURES_REQUEST,
  FILE_SUMMARY_REQUEST,
  MCP_REQUEST,
  REFRESH_REQUEST,
  RENDER_STEPS_REQUEST,
  RUN_STATUS_NOTIFICATION,
  RUN_STATUS_REQUEST,
  RUN_SELECTION_REQUEST,
  SELECTIONS_REQUEST,
  TRACE_REQUEST,
  RUN_ARGS_REQUEST,
  SET_CREDENTIALS_NOTIFICATION,
  DESKTOP_REQUEST,
  STATUS_REQUEST,
  TESTS_FOR_FILE_REQUEST,
  type DesktopResult,
  type EditorCredentials,
  type EditorTest,
  type FailuresResult,
  type FileSummary,
  type FileSummaryParams,
  type McpServersResult,
  type RenderStepsParams,
  type RenderStepsResult,
  type RunCommand,
  type RunStatusResult,
  type RunSelectionParams,
  type SelectionsParams,
  type SelectionsResult,
  type RunTestsArgs,
  type StatusResult,
  type SummaryLine,
  type TestsForFile,
  type TestsForFileParams,
  type RunCommandArgs,
  type TraceParams,
  type TraceResult,
} from './protocol.js';
import { findPlaywrightRoots, relativeTo, resolveReportedFile, splitLocation } from './workspace.js';

/** How often every context fetches its indexes again. */
const REFRESH_MS = 5 * 60_000;
/** How often the latest run is read again while it runs, and otherwise. */
const RUN_POLL_ACTIVE_MS = 15_000;
const RUN_POLL_MS = 60_000;
/** How often the desktop app's discovery file is checked. */
const DESKTOP_WATCH_MS = 2_000;
const ACTIVE_RUN = new Set(['running', 'initializing', 'finalizing']);
/** Pause after a keystroke before an application file is compared with `HEAD`. */
const DEBOUNCE_MS = 500;
const SPEC_FILE = /(?:^|\/)[^/]+\.(?:spec|test)\.[cm]?[jt]sx?$/;
const TEST_CALL = /(?<![\w$.])test(?:\.(?:only|skip|fixme|fail|slow))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;

export interface ServerOptions {
  /** The environment the connection is read from; the process's by default. */
  env?: Record<string, string | undefined>;
  refreshMs?: number;
  debounceMs?: number;
  /** How often the latest run is read while none runs; a quarter of it while one runs. */
  runPollMs?: number;
  /** How often the desktop app's discovery file is checked for its start, stop and folder links. */
  desktopWatchMs?: number;
}

/** What the last analysis of an application file found, for its quick fixes and hover. */
interface AppAnalysis {
  context: PiwiContext;
  groups: Array<{ anchor: LocatorBreak['anchor']; breaks: LocatorBreak[] }>;
}

function uriToPath(uri: string): string | null {
  try {
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

/** What a `ci-failure` diagnostic carries, for its quick fixes and hover. */
interface FailureData {
  root: string;
  executionId: number;
}

function toEditorTest(context: PiwiContext, t: LocatorIndexTest): EditorTest {
  return { id: t.id, title: t.title, file: t.file, status: t.status, url: context.client?.testUrl(t.id) ?? '' };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function testCounts(tests: Array<{ status: string | null }>): string {
  const failing = tests.filter((t) => t.status === 'failed').length;
  const flaky = tests.filter((t) => t.status === 'flaky').length;
  return [failing ? `${failing} failing` : null, flaky ? `${flaky} flaky` : null].filter(Boolean).join(' · ');
}

/** Start serving on a connection. Returns a function that stops the refresh timer. */
export function startServer(connection: Connection, options: ServerOptions = {}): () => void {
  const env = options.env ?? process.env;
  const desktopFile = desktopConfigPath(env);
  const onDesktopFile = (now: fs.Stats, before: fs.Stats) => {
    if (now.mtimeMs !== before.mtimeMs || now.size !== before.size) void refreshAll();
  };
  const documents = new TextDocuments(TextDocument);
  const contexts: PiwiContext[] = [];
  let credentials: EditorCredentials = {};
  let folders: string[] = [];
  const appAnalyses = new Map<string, AppAnalysis>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let runTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  /** Diagnostics of the analysis of open documents, and of the latest run's failures, by URI. */
  const analysisDiagnostics = new Map<string, Diagnostic[]>();
  let failureDiagnostics = new Map<string, Diagnostic[]>();
  let lastRunStatus = '';
  /** Whether the client previews an edit whose change annotation asks for confirmation. */
  let previewsEdits = false;

  const publish = (uri: string) =>
    connection.sendDiagnostics({
      uri,
      diagnostics: [...(analysisDiagnostics.get(uri) ?? []), ...(failureDiagnostics.get(uri) ?? [])],
    });

  const readText = (file: string): string | null => {
    const open = documents.get(pathToFileURL(file).href);
    if (open) return open.getText();
    try {
      return fs.readFileSync(file, 'utf-8');
    } catch {
      return null;
    }
  };

  const contextFor = (file: string): PiwiContext | null => {
    const owning = contexts
      .filter((c) => relativeTo(c.root, file) !== null)
      .sort((a, b) => b.root.length - a.root.length)[0];
    return owning ?? contexts.find((c) => relativeTo(c.repoRoot, file) !== null) ?? null;
  };

  /** Whether a file is test code: a spec, or a file the index calls locators from. */
  const isTestCode = (context: PiwiContext, relative: string | null): boolean => {
    if (!relative) return false;
    if (SPEC_FILE.test(relative)) return true;
    if (!context.index) return false;
    return [...locatorCallSiteFiles(context.index)].some((f) => sameFilePath(f, relative));
  };

  const lineOf = (file: string, line: number): string | null => {
    const text = readText(file);
    if (text === null) return null;
    return text.split(/\r?\n/)[line - 1] ?? null;
  };

  /** Where a failure shows: its failing call when that file is in the workspace, else its `test(…)` line. */
  const failureSite = (context: PiwiContext, f: BranchFailure): { file: string; line: number } | null => {
    const roots = [context.root, context.repoRoot];
    const at = f.location ? splitLocation(f.location) : null;
    const located = at ? resolveReportedFile(roots, at.file) : null;
    if (located && at) return { file: located, line: at.line };
    const spec = resolveReportedFile(roots, f.file);
    return spec ? { file: spec, line: f.line ?? 1 } : null;
  };

  /** Rebuild the failure diagnostics of every context, and publish the files whose set changed. */
  const publishFailures = () => {
    const next = new Map<string, Diagnostic[]>();
    for (const context of contexts) {
      for (const f of context.failures?.failures ?? []) {
        const site = failureSite(context, f);
        if (!site) continue;
        const text = lineOf(site.file, site.line) ?? '';
        const start = text.length - text.trimStart().length;
        const uri = pathToFileURL(site.file).href;
        (next.get(uri) ?? next.set(uri, []).get(uri)!).push({
          range: {
            start: { line: site.line - 1, character: start },
            end: { line: site.line - 1, character: Math.max(start, text.trimEnd().length) },
          },
          severity: DiagnosticSeverity.Error,
          source: 'Piwi',
          code: 'ci-failure',
          codeDescription: context.client ? { href: context.client.executionUrl(f.executionId) } : undefined,
          message: `${f.headline ?? 'Failed'} (${f.title}, run #${context.failures!.run!.id})`,
          data: { root: context.root, executionId: f.executionId } satisfies FailureData,
        });
      }
    }
    const previous = failureDiagnostics;
    failureDiagnostics = next;
    for (const uri of new Set([...previous.keys(), ...next.keys()])) {
      if (JSON.stringify(previous.get(uri) ?? []) !== JSON.stringify(next.get(uri) ?? [])) publish(uri);
    }
  };

  const runStatus = (): RunStatusResult => ({
    contexts: contexts
      .filter((c) => c.client && c.project)
      .map((c) => {
        const run = c.failures?.run ?? null;
        return {
          root: c.root,
          branch: c.runBranch,
          run: run
            ? {
                id: run.id,
                status: run.status,
                startTime: run.startTime,
                totalTests: run.totalTests,
                passedTests: run.passedTests,
                failedTests: run.failedTests,
                flakyTests: run.flakyTests,
                skippedTests: run.skippedTests,
                url: c.client!.runUrl(run.id),
              }
            : null,
          failures: c.failures?.failures.length ?? 0,
        };
      }),
  });

  /** Publish the failures and tell the client when the run status changed. */
  const runChanged = () => {
    publishFailures();
    const status = runStatus();
    const serialized = JSON.stringify(status);
    if (serialized !== lastRunStatus) {
      lastRunStatus = serialized;
      void connection.sendNotification(RUN_STATUS_NOTIFICATION, status);
    }
  };

  /** Read the latest runs again, sooner while one runs. */
  const pollRuns = () => {
    if (stopped) return;
    const base = options.runPollMs ?? RUN_POLL_MS;
    const active = contexts.some((c) => ACTIVE_RUN.has(c.failures?.run?.status ?? ''));
    runTimer = setTimeout(
      async () => {
        const changed = await Promise.all(contexts.map((c) => c.refreshRun()));
        if (changed.some(Boolean)) runChanged();
        pollRuns();
      },
      active ? Math.min(base, RUN_POLL_ACTIVE_MS, Math.max(1, Math.floor(base / 4))) : base,
    );
    runTimer.unref?.();
  };

  /**
   * A fix plan as one workspace edit: its validated patch applied to each file it
   * names, else its locator rewrites whose line still reads as captured. Null when
   * nothing applies to the workspace as it is.
   */
  const fixPlanEdit = (context: PiwiContext, plan: FixPlan): { edit: WorkspaceEdit; files: number } | null => {
    const roots = [context.root, context.repoRoot];
    const next = new Map<string, string>();
    const patch = plan.diagnosis?.patch;
    const validation = plan.diagnosis?.patchValidation?.status;
    if (patch && validation !== 'stale-file' && validation !== 'invalid') {
      for (const file of parsePatch(patch)) {
        const target = resolveReportedFile(roots, file.path);
        const text = target ? (next.get(target) ?? readText(target)) : null;
        const patched = text !== null ? applyPatchFile(text, file) : null;
        if (!target || patched === null) return null;
        next.set(target, patched);
      }
    } else {
      for (const e of plan.edits) {
        if (!e.edit?.filePath) continue;
        const target = resolveReportedFile(roots, e.edit.filePath);
        const text = target ? (next.get(target) ?? readText(target)) : null;
        if (!target || text === null) continue;
        const lines = text.split(/\r?\n/);
        const current = lines[e.edit.line - 1];
        if (current === undefined || current.trim() !== e.edit.oldLine.trim()) continue;
        lines[e.edit.line - 1] =
          current.slice(0, current.length - current.trimStart().length) + e.edit.newLine.trimStart();
        next.set(target, lines.join(text.includes('\r\n') ? '\r\n' : '\n'));
      }
    }
    if (!next.size) return null;
    const whole = (text: string) => {
      const lines = text.split(/\r?\n/);
      return {
        start: { line: 0, character: 0 },
        end: { line: lines.length - 1, character: lines[lines.length - 1]!.length },
      };
    };
    const entries = [...next].map(([file, text]) => ({
      uri: pathToFileURL(file).href,
      range: whole(readText(file) ?? ''),
      newText: text,
    }));
    const edit: WorkspaceEdit = previewsEdits
      ? {
          documentChanges: entries.map((e) => ({
            textDocument: { uri: e.uri, version: null },
            edits: [{ range: e.range, newText: e.newText, annotationId: 'piwi.fixPlan' }],
          })),
          changeAnnotations: {
            'piwi.fixPlan': {
              label: `Piwi fix plan: ${plan.cluster.title ?? plan.cluster.signature}`,
              needsConfirmation: true,
            },
          },
        }
      : { changes: Object.fromEntries(entries.map((e) => [e.uri, [{ range: e.range, newText: e.newText }]])) };
    return { edit, files: next.size };
  };

  /** One block about a failure for a coding agent: the failure, its healing and its cluster's fix plan. */
  const agentContext = async (context: PiwiContext, failure: BranchFailure): Promise<string> => {
    const healing = await context.healing(failure.executionId);
    const plan = failure.clusterId ? await context.fixPlanText(failure.clusterId) : null;
    const recommended = healing?.recommendation?.recommended?.locator;
    return [
      `# Failing test: ${failure.title}`,
      '',
      failure.headline ?? 'Failed',
      failure.location ? `At ${failure.location}` : `In ${failure.file}${failure.line ? `:${failure.line}` : ''}`,
      context.client ? `Execution: ${context.client.executionUrl(failure.executionId)}` : null,
      recommended
        ? `\n## Locator healing\n\nReplace the failing locator with \`${recommended}\`${healing?.edit ? `:\n\n\`\`\`diff\n- ${healing.edit.oldLine.trim()}\n+ ${healing.edit.newLine.trim()}\n\`\`\`` : '.'}`
        : null,
      plan ? `\n${plan.trim()}` : null,
    ]
      .filter((part) => part !== null)
      .join('\n');
  };

  const contextOfRoot = (root: string) => contexts.find((c) => c.root === root) ?? null;

  const failureOf = (data: FailureData): { context: PiwiContext; failure: BranchFailure } | null => {
    const context = contextOfRoot(data.root);
    const failure = context?.failures?.failures.find((f) => f.executionId === data.executionId);
    return context && failure ? { context, failure } : null;
  };

  const isOpen = (document: TextDocument) => documents.get(document.uri) === document;

  async function validate(document: TextDocument): Promise<void> {
    const file = uriToPath(document.uri);
    const context = file ? contextFor(file) : null;
    if (!file || !context?.index) {
      analysisDiagnostics.delete(document.uri);
      publish(document.uri);
      return;
    }
    const lines = document.getText().split(/\r?\n/);
    const relative = relativeTo(context.root, file);
    const diagnostics: Diagnostic[] = [];
    if (isTestCode(context, relative)) {
      appAnalyses.delete(document.uri);
      if (SPEC_FILE.test(relative!) && context.timeouts.size) {
        const cases = new Map((await context.casesOf(relative!)).map((c) => [c.title, c]));
        lines.forEach((text, i) => {
          const m = TEST_CALL.exec(text);
          const found = m ? cases.get(m[2]!) : undefined;
          const advice = found ? context.timeouts.get(found.id) : undefined;
          if (!advice) return;
          const start = text.length - text.trimStart().length;
          diagnostics.push({
            range: { start: { line: i, character: start }, end: { line: i, character: text.trimEnd().length } },
            severity: DiagnosticSeverity.Information,
            source: 'Piwi',
            code: 'timeout',
            message: timeoutMessage(advice),
            data: { testCaseId: advice.testCaseId, line: i },
          });
        });
      }
      for (const finding of stabilityFindings(locatorsInFile(context.index, relative!))) {
        const text = lines[finding.line - 1] ?? '';
        const range = locatorRange(text, finding.locator);
        diagnostics.push({
          range: {
            start: { line: finding.line - 1, character: range.start },
            end: { line: finding.line - 1, character: range.end },
          },
          severity: finding.level === 'brittle' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Hint,
          source: 'Piwi',
          code: finding.level,
          message: finding.message,
          data: { locator: finding.locator, line: finding.line },
        });
      }
    } else {
      const repoRelative = relativeTo(context.repoRoot, file);
      const before = repoRelative ? await context.committed(repoRelative) : null;
      if (repoRelative && before !== null) {
        const maps = await context.translationMaps();
        const groups = breaksByAnchor(
          breaksOfChange(diffLines(repoRelative, before, document.getText()), context.index, {
            translations: (key, side) => (side === 'old' ? maps.old : maps.new).get(key),
            readFile: (_p, side) => (side === 'old' ? before : document.getText()),
            reach: reachFrom(context.codeIndex),
          }),
        );
        if (!isOpen(document)) return;
        appAnalyses.set(document.uri, { context, groups });
        for (const group of groups) {
          const line = Math.max(0, group.anchor.line - 1);
          const text = lines[line] ?? '';
          const at = text.indexOf(group.anchor.after ?? group.anchor.before);
          const likely = group.breaks.some((b) => b.confidence === 'likely');
          diagnostics.push({
            range: {
              start: { line, character: at >= 0 ? at : text.length - text.trimStart().length },
              end: { line, character: at >= 0 ? at + (group.anchor.after ?? group.anchor.before).length : text.length },
            },
            severity: likely ? DiagnosticSeverity.Warning : DiagnosticSeverity.Information,
            source: 'Piwi',
            code: 'locator-break',
            message: breakMessage(group.anchor, group.breaks),
            data: { anchorLine: group.anchor.line, before: group.anchor.before },
          });
        }
      } else {
        appAnalyses.delete(document.uri);
      }
    }
    // Closed while the committed text, translations or cases were read: nothing to show.
    if (!isOpen(document)) return;
    analysisDiagnostics.set(document.uri, diagnostics);
    publish(document.uri);
  }

  const schedule = (document: TextDocument, delay = options.debounceMs ?? DEBOUNCE_MS) => {
    clearTimeout(timers.get(document.uri));
    timers.set(
      document.uri,
      setTimeout(() => {
        timers.delete(document.uri);
        void validate(document).catch((e) => connection.console.error(`Piwi: ${(e as Error).message}`));
      }, delay),
    );
  };

  async function refreshAll(): Promise<void> {
    await Promise.all(contexts.map((c) => c.refresh(env, credentials)));
    runChanged();
    for (const document of documents.all()) schedule(document, 0);
  }

  connection.onInitialize((params: InitializeParams) => {
    folders = (params.workspaceFolders ?? []).map((f) => uriToPath(f.uri)).filter((f): f is string => !!f);
    if (!folders.length && params.rootUri) {
      const root = uriToPath(params.rootUri);
      if (root) folders = [root];
    }
    const workspaceEdit = params.capabilities.workspace?.workspaceEdit;
    previewsEdits = !!workspaceEdit?.documentChanges && !!workspaceEdit.changeAnnotationSupport;
    const init = params.initializationOptions as { credentials?: EditorCredentials } | undefined;
    credentials = init?.credentials ?? {};
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        completionProvider: { triggerCharacters: ['.'] },
        codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
      },
      serverInfo: { name: 'Piwi' },
    };
  });

  connection.onInitialized(() => {
    for (const folder of folders) {
      for (const root of findPlaywrightRoots(folder)) {
        if (!contexts.some((c) => c.root === root)) contexts.push(new PiwiContext(root));
      }
    }
    void refreshAll();
    refreshTimer = setInterval(() => void refreshAll(), options.refreshMs ?? REFRESH_MS);
    refreshTimer.unref?.();
    pollRuns();
    // The desktop app writes its discovery file when it starts or a folder link
    // changes, and removes it on quit: read the connection again then.
    fs.watchFile(
      desktopFile,
      { interval: options.desktopWatchMs ?? DESKTOP_WATCH_MS, persistent: false },
      onDesktopFile,
    );
  });

  documents.onDidOpen((e) => schedule(e.document, 0));
  documents.onDidChangeContent((e) => schedule(e.document));
  documents.onDidClose((e) => {
    clearTimeout(timers.get(e.document.uri));
    timers.delete(e.document.uri);
    appAnalyses.delete(e.document.uri);
    analysisDiagnostics.delete(e.document.uri);
    publish(e.document.uri);
  });

  connection.onCodeAction(async (params): Promise<CodeAction[]> => {
    const file = uriToPath(params.textDocument.uri);
    const context = file ? contextFor(file) : null;
    const document = documents.get(params.textDocument.uri);
    if (!file || !context || !document) return [];
    const actions: CodeAction[] = [];
    const lines = document.getText().split(/\r?\n/);
    for (const diagnostic of params.context.diagnostics) {
      if (diagnostic.source !== 'Piwi') continue;
      if (diagnostic.code === 'brittle' || diagnostic.code === 'watch') {
        const { locator, line } = diagnostic.data as { locator: string; line: number };
        const relative = relativeTo(context.root, file);
        if (!relative) continue;
        const replacement = stableReplacement(locator, line, relative, await context.alternativesOf(relative));
        const text = lines[line - 1] ?? '';
        const next = replacement ? replaceLocatorOnLine(text, locator, replacement.locator) : null;
        if (!replacement || next === null) continue;
        actions.push({
          title: `Use ${replacement.locator} (as of the last passing run)`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: {
            changes: {
              [params.textDocument.uri]: [
                {
                  range: { start: { line: line - 1, character: 0 }, end: { line: line - 1, character: text.length } },
                  newText: next,
                },
              ],
            },
          },
        });
      } else if (diagnostic.code === 'timeout') {
        const { testCaseId, line } = diagnostic.data as { testCaseId: number; line: number };
        const advice = context.timeouts.get(testCaseId);
        const change = advice ? timeoutEdit(lines, line, advice) : null;
        if (!advice || !change) continue;
        const current = lines[change.line] ?? '';
        actions.push({
          title:
            advice.kind === 'stale-slow' ? 'Remove test.slow()' : `Set the timeout to ${advice.recommendedTimeout} ms`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: {
            changes: {
              [params.textDocument.uri]: [
                change.replace
                  ? change.text
                    ? {
                        range: {
                          start: { line: change.line, character: 0 },
                          end: { line: change.line, character: current.length },
                        },
                        newText: change.text,
                      }
                    : {
                        range: {
                          start: { line: change.line, character: 0 },
                          end: { line: change.line + 1, character: 0 },
                        },
                        newText: '',
                      }
                  : {
                      range: { start: { line: change.line, character: 0 }, end: { line: change.line, character: 0 } },
                      newText: `${change.text}\n`,
                    },
              ],
            },
          },
        });
      } else if (diagnostic.code === 'locator-break') {
        const analysis = appAnalyses.get(params.textDocument.uri);
        const { anchorLine, before } = diagnostic.data as { anchorLine: number; before: string };
        const group = analysis?.groups.find((g) => g.anchor.line === anchorLine && g.anchor.before === before);
        if (!group) continue;
        const edits = rewriteEdits(group.breaks, (f, l) => lineOf(path.resolve(context.root, f), l));
        if (!edits.length) continue;
        const changes: Record<string, TextEdit[]> = {};
        for (const edit of edits) {
          const uri = pathToFileURL(path.resolve(context.root, edit.file)).href;
          (changes[uri] ??= []).push({
            range: {
              start: { line: edit.line - 1, character: 0 },
              end: { line: edit.line - 1, character: edit.oldText.length },
            },
            newText: edit.newText,
          });
        }
        const files = [...new Set(edits.map((e) => path.basename(e.file)))];
        actions.push({
          title: `Update ${plural(edits.length, 'locator')} in ${files.slice(0, 3).join(', ')}${files.length > 3 ? '…' : ''}`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          edit: { changes },
        });
      } else if (diagnostic.code === 'ci-failure') {
        const found = failureOf(diagnostic.data as FailureData);
        if (!found) continue;
        const { context: owner, failure } = found;
        const healing = await owner.healing(failure.executionId);
        const edit = healing?.edit;
        const line = diagnostic.range.start.line;
        const current = lines[line] ?? '';
        if (edit && edit.line === line + 1 && current.trim() === edit.oldLine.trim() && edit.newLine.trim()) {
          const indent = current.slice(0, current.length - current.trimStart().length);
          actions.push({
            title: `Heal: use ${healing!.recommendation?.recommended?.locator ?? edit.newLine.trim()}`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            isPreferred: true,
            edit: {
              changes: {
                [params.textDocument.uri]: [
                  {
                    range: { start: { line, character: 0 }, end: { line, character: current.length } },
                    newText: indent + edit.newLine.trimStart(),
                  },
                ],
              },
            },
          });
        }
        if (failure.traces.length) {
          actions.push({
            title: 'Open the trace',
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            command: {
              title: 'Open the trace',
              command: 'piwi.openTrace',
              arguments: [{ uri: params.textDocument.uri, executionId: failure.executionId } satisfies TraceParams],
            },
          });
        }
        const fixPlan = failure.clusterId ? await owner.fixPlan(failure.clusterId) : null;
        const planEdit = fixPlan ? fixPlanEdit(owner, fixPlan) : null;
        if (fixPlan && planEdit) {
          actions.push({
            title: `Apply the fix plan (${plural(planEdit.files, 'file')}), then run its verification`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: planEdit.edit,
            command: {
              title: 'Run the verification',
              command: 'piwi.runCommand',
              arguments: [{ cwd: owner.root, command: fixPlan.verify.command } satisfies RunCommandArgs],
            },
          });
        }
        if (owner.client && failure.clusterId && !(await owner.issuesOf(failure)).length) {
          actions.push({
            title: 'File an issue',
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            command: {
              title: 'File an issue',
              command: 'piwi.openInDashboard',
              arguments: [owner.client.clusterUrl(failure.clusterId)],
            },
          });
        }
        if (owner.client) {
          actions.push({
            title: 'Copy context for agent',
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            command: {
              title: 'Copy context for agent',
              command: 'piwi.copyText',
              arguments: [await agentContext(owner, failure)],
            },
          });
          actions.push({
            title: 'Open the failure in the dashboard',
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            command: {
              title: 'Open the failure in the dashboard',
              command: 'piwi.openInDashboard',
              arguments: [owner.client.executionUrl(failure.executionId)],
            },
          });
        }
      }
    }
    return actions;
  });

  // In test code: after `page.`, the chains the suite uses on the pages this file's tests visit; at the start of a
  // statement, the project's functions for those pages; inside `piwi:` annotations and tags, their known values.
  connection.onCompletion(async (params): Promise<CompletionItem[]> => {
    const file = uriToPath(params.textDocument.uri);
    const context = file ? contextFor(file) : null;
    const document = documents.get(params.textDocument.uri);
    if (!file || !context?.index || !document) return [];
    const relative = relativeTo(context.root, file);
    if (!relative || !isTestCode(context, relative)) return [];
    const line = document.getText().split(/\r?\n/)[params.position.line] ?? '';
    const before = line.slice(0, params.position.character);
    const annotation = await annotationItems(context, before, params.position);
    if (annotation) return annotation;
    const statement = /^(\s*)((?:await\s+)?[A-Za-z_$][\w$]*)?$/.exec(before);
    if (statement) {
      const functions = functionSuggestions(await context.functionCatalog(), filePages(context.index, relative));
      const start = { line: params.position.line, character: statement[1]!.length };
      return functions.map((f, i) => ({
        label: f.kind === 'page-object-method' && f.receiver ? `${f.receiver}.${f.name}` : f.name,
        kind: CompletionItemKind.Function,
        detail: [f.kind === 'page-object-method' ? f.importName : f.module, f.urlPattern].filter(Boolean).join(' · '),
        sortText: `~${String(i).padStart(3, '0')}`,
        filterText: `await ${f.receiver ? `${f.receiver}.` : ''}${f.name} ${f.name}`,
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: { range: { start, end: params.position }, newText: functionSnippet(f) },
      }));
    }
    const typed = /(?:^|[^\w$.])(?:this\.)?page\.([A-Za-z]*)$/.exec(before);
    if (!typed) return [];
    const start = { line: params.position.line, character: params.position.character - typed[1]!.length };
    return locatorSuggestions(context.index, relative).map((s, i) => ({
      label: s.locator,
      kind: CompletionItemKind.Value,
      detail: [
        plural(s.tests, 'test'),
        s.pages.slice(0, 3).join(', '),
        s.stability && s.stability.level !== 'stable' ? `${s.stability.level}: ${stabilityLabels(s.stability)}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      sortText: String(i).padStart(3, '0'),
      filterText: s.locator,
      textEdit: { range: { start, end: params.position }, newText: s.locator },
    }));
  });

  /** Completion inside a `piwi:` annotation or a tag; null when the cursor is in neither. */
  const annotationItems = async (
    context: PiwiContext,
    before: string,
    position: { line: number; character: number },
  ): Promise<CompletionItem[] | null> => {
    const item = (label: string, typed: string, detail?: string): CompletionItem => ({
      label,
      kind: CompletionItemKind.EnumMember,
      detail,
      textEdit: {
        range: { start: { line: position.line, character: position.character - typed.length }, end: position },
        newText: label,
      },
    });
    const type = /\btype:\s*(['"`])([\w:-]*)$/.exec(before);
    if (type) {
      return [
        item('piwi:owner', type[2]!, 'Who owns the test'),
        item('piwi:priority', type[2]!, 'critical, high, medium or low'),
        item('piwi:feature', type[2]!, 'The product area it covers'),
        item('piwi:link', type[2]!, 'A ticket, spec or runbook URL'),
      ];
    }
    const value = /\btype:\s*(['"`])piwi:(owner|priority|feature)\1\s*,\s*description:\s*(['"`])([^'"`]*)$/.exec(
      before,
    );
    if (value) {
      const words = await context.vocabulary();
      const values =
        value[2] === 'priority'
          ? ['critical', 'high', 'medium', 'low']
          : value[2] === 'owner'
            ? words.owners
            : words.features;
      return values.map((v) => item(v, value[4]!));
    }
    const tag = /\btag:\s*(?:\[[^\]]*)?(['"`])(@[\w-]*)$/.exec(before);
    if (tag) return (await context.vocabulary()).tags.map((t) => item(t.startsWith('@') ? t : `@${t}`, tag[2]!));
    return null;
  };

  connection.onHover(async (params): Promise<Hover | null> => {
    const failures = (failureDiagnostics.get(params.textDocument.uri) ?? []).filter(
      (d) => d.range.start.line === params.position.line,
    );
    const analysis = await hoverOfAnalysis(params);
    if (!failures.length) return analysis;
    const parts: string[] = [];
    for (const d of failures) {
      const found = failureOf(d.data as FailureData);
      if (!found) continue;
      const { context, failure } = found;
      const shot = failure.screenshot ? await context.evidence(failure.screenshot) : null;
      const issues = await context.issuesOf(failure);
      parts.push(
        [
          `**CI failure** · [${failure.title.replace(/[[\]]/g, '')}](${context.client?.executionUrl(failure.executionId) ?? ''}) · run #${context.failures?.run?.id ?? ''}`,
          failure.headline ?? '',
          ...issues.map(
            (l) =>
              `Known issue: [${[l.key, l.title].filter(Boolean).join(' ').replace(/[[\]]/g, '') || l.url}](${l.url})${l.statusText ? ` · ${l.statusText}` : ''}`,
          ),
          shot ? `![Failure screenshot](${pathToFileURL(shot).href})` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      );
    }
    const analysisText =
      analysis && typeof analysis.contents === 'object' && 'value' in analysis.contents ? analysis.contents.value : '';
    const value = [...parts, analysisText].filter(Boolean).join('\n\n---\n\n');
    return value ? { contents: { kind: 'markdown', value } } : null;
  });

  const hoverOfAnalysis = async (params: {
    textDocument: { uri: string };
    position: { line: number };
  }): Promise<Hover | null> => {
    const file = uriToPath(params.textDocument.uri);
    const context = file ? contextFor(file) : null;
    if (!file || !context?.index) return null;
    const line = params.position.line + 1;
    const analysis = appAnalyses.get(params.textDocument.uri);
    if (analysis) {
      const groups = analysis.groups.filter((g) => g.anchor.line === line);
      if (!groups.length) return null;
      const parts = groups.flatMap((g) =>
        g.breaks.map((b) => {
          const sites = [...new Set(b.uses.flatMap((u) => u.callSites))].slice(0, 3).map((s) => `\`${s}\``);
          const fix = b.rewrite ? `\n  → \`${b.rewrite}\`` : '';
          return `- \`${b.locator}\` · ${plural(b.tests.length, 'test')} · ${b.confidence} · ${sites.join(', ')}${fix}`;
        }),
      );
      return { contents: { kind: 'markdown', value: `**Piwi: locators this change breaks**\n\n${parts.join('\n')}` } };
    }
    const relative = relativeTo(context.root, file);
    if (!relative) return null;
    const here = locatorsInFile(context.index, relative).filter((l) => l.line === line);
    if (!here.length) return null;
    return { contents: { kind: 'markdown', value: here.map((l) => hoverFor(context, l)).join('\n\n---\n\n') } };
  };

  const hoverFor = (context: PiwiContext, l: LineLocator): string => {
    const icon = (status: string | null) =>
      status === 'passed'
        ? '✓'
        : status === 'failed'
          ? '✗'
          : status === 'flaky'
            ? '~'
            : status === 'skipped'
              ? '−'
              : '·';
    const tests = l.tests
      .slice(0, 10)
      .map(
        (t) =>
          `- ${icon(t.status)} [${t.title.replace(/[[\]]/g, '')}](${context.client?.testUrl(t.id) ?? ''}) · \`${t.file}\``,
      )
      .join('\n');
    const pages = [
      ...new Set(l.uses.flatMap((u) => (u.pages ?? []).map((p) => context.index?.pages?.[p]).filter(Boolean))),
    ].slice(0, 5);
    const stability =
      l.stability && l.stability.level !== 'stable' ? `\n\n${l.stability.level}: ${stabilityLabels(l.stability)}` : '';
    return [
      `**\`${l.entry.locator}\`** · ${plural(l.tests.length, 'test')} · ${l.actions.slice(0, 4).join(', ')}`,
      tests,
      pages.length ? `Pages: ${pages.map((p) => `\`${p}\``).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
      .concat(stability);
  };

  connection.onRequest(FILE_SUMMARY_REQUEST, async (params: FileSummaryParams): Promise<FileSummary> => {
    const empty: FileSummary = { file: null, lines: [] };
    const file = uriToPath(params.uri);
    const context = file ? contextFor(file) : null;
    if (!file || !context?.index || !context.client) return empty;
    const relative = relativeTo(context.root, file);
    const document = documents.get(params.uri);
    const text = document ? document.getText() : fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
    const lines = text.split(/\r?\n/);
    const run = (testIds: number[]) => ({
      title: 'Run them',
      command: 'piwi.runTests' as const,
      arguments: [{ uri: params.uri, testIds } satisfies RunTestsArgs],
    });

    if (isTestCode(context, relative)) {
      const out: SummaryLine[] = [];
      for (const l of locatorsInFile(context.index, relative!)) {
        const counts = testCounts(l.tests);
        out.push({
          line: l.line - 1,
          title: [plural(l.tests.length, 'test'), l.actions.slice(0, 2).join(', '), counts].filter(Boolean).join(' · '),
          command: run(l.tests.map((t) => t.id)),
        });
      }
      const cases = SPEC_FILE.test(relative!) ? await context.casesOf(relative!) : [];
      const casesByTitle = new Map(cases.map((c) => [c.title, c]));
      lines.forEach((text, i) => {
        const m = TEST_CALL.exec(text);
        const found = m ? casesByTitle.get(m[2]!) : undefined;
        if (!found) return;
        const runs = found.totalRuns ?? 0;
        const passed = found.passedRuns ?? 0;
        const status = found.status && found.status !== 'passed' ? ` · ${found.status}` : '';
        const quarantined = context.quarantined.get(found.id);
        const quarantine = quarantined
          ? ` · quarantined ${Math.max(1, Math.round(quarantined.ageMs / 86_400_000))} d · ${
              quarantined.releaseProposed
                ? 'ready to release'
                : `${quarantined.consecutivePasses}${context.releaseAfter ? `/${context.releaseAfter}` : ''} passes toward release`
            }`
          : '';
        const inSelections = context.selections.filter((sel) => sel.tests.has(found.id)).map((sel) => sel.name);
        const selectionsText = inSelections.length
          ? ` · in ${inSelections.slice(0, 3).join(', ')}${inSelections.length > 3 ? '…' : ''}`
          : '';
        const flaky = context.flaky.get(found.id);
        const flakiness = flaky
          ? [
              ` · flaky score ${flaky.score}`,
              flaky.wastedCiMinutes >= 1 ? ` · ${Math.round(flaky.wastedCiMinutes)} CI min wasted` : '',
              flaky.rootCause ? ` · ${flaky.rootCause}` : '',
            ].join('')
          : '';
        out.push({
          line: i,
          title: `passed ${passed}/${runs}${status}${quarantine}${flakiness}${selectionsText}`,
          command: {
            title: 'Open in dashboard',
            command: 'piwi.openInDashboard',
            arguments: [context.client!.testUrl(found.id)],
          },
        });
      });
      const fileLine: SummaryLine | null = cases.length
        ? {
            line: 0,
            title: [
              `${plural(cases.length, 'test')} in Piwi`,
              testCounts(cases.map((c) => ({ status: c.status ?? null }))),
            ]
              .filter(Boolean)
              .join(' · '),
            command: run(cases.map((c) => c.id)),
          }
        : null;
      return { file: fileLine, lines: out.sort((a, b) => a.line - b.line) };
    }

    const repoRelative = relativeTo(context.repoRoot, file);
    const tests = repoRelative ? testsReaching(context.codeIndex, repoRelative) : [];
    const page = repoRelative
      ? (pageSummary(context.index, repoRelative) ?? pageSummary(context.index, relative ?? ''))
      : null;
    const reachLine: SummaryLine | null = tests.length
      ? {
          line: 0,
          title: [`Reached by ${plural(tests.length, 'test')}`, testCounts(tests)].filter(Boolean).join(' · '),
          command: run(tests.map((t) => t.id)),
        }
      : null;
    if (!page) return reachLine ? { file: reachLine, lines: [] } : empty;
    const pageLine: SummaryLine = {
      line: 0,
      title: [
        `Page ${page.pages.slice(0, 2).join(', ')}: ${plural(page.tests.length, 'test')} act on it`,
        plural(page.locators, 'locator'),
        page.brittle ? `${page.brittle} brittle` : '',
        testCounts(page.tests),
      ]
        .filter(Boolean)
        .join(' · '),
      command: run(page.tests.map((t) => t.id)),
    };
    return { file: pageLine, lines: reachLine ? [reachLine] : [] };
  });

  connection.onRequest(TESTS_FOR_FILE_REQUEST, async (params: TestsForFileParams): Promise<TestsForFile> => {
    const file = uriToPath(params.uri);
    const context = file ? contextFor(file) : null;
    if (!file || !context?.index) return { tests: [], basis: 'none' };
    const relative = relativeTo(context.root, file);
    if (relative && SPEC_FILE.test(relative)) {
      const cases = await context.casesOf(relative);
      return {
        basis: 'defined',
        tests: cases.map((c) => ({
          id: c.id,
          title: c.title,
          file: c.filePath,
          status: (['passed', 'failed', 'flaky', 'skipped'].includes(c.status ?? '')
            ? c.status
            : null) as EditorTest['status'],
          url: context.client?.testUrl(c.id) ?? '',
        })),
      };
    }
    if (isTestCode(context, relative)) {
      const tests = new Map<number, LocatorIndexTest>();
      for (const l of locatorsInFile(context.index, relative!)) for (const t of l.tests) tests.set(t.id, t);
      return { basis: 'locators', tests: [...tests.values()].map((t) => toEditorTest(context, t)) };
    }
    const repoRelative = relativeTo(context.repoRoot, file);
    const reached = repoRelative ? testsReaching(context.codeIndex, repoRelative) : [];
    return { basis: reached.length ? 'reach' : 'none', tests: reached.map((t) => toEditorTest(context, t)) };
  });

  connection.onRequest(RUN_ARGS_REQUEST, async (params: RunTestsArgs): Promise<RunCommand | null> => {
    const file = uriToPath(params.uri);
    const context = file ? contextFor(file) : null;
    if (!context?.client || !context.project || !params.testIds.length) return null;
    const { args, command } = await context.client.runArgs(context.project.id, params.testIds);
    return { cwd: context.root, args, command: command || `npx playwright test ${args.join(' ')}` };
  });

  connection.onRequest(
    STATUS_REQUEST,
    (): StatusResult => ({
      contexts: contexts.map((c) => ({
        root: c.root,
        connected: !!c.index && !c.problem,
        serverUrl: c.client?.connection.serverUrl ?? null,
        source: c.source,
        projectId: c.project?.id ?? null,
        projectName: c.project?.name ?? null,
        branch: c.branch ?? c.index?.defaultBranch ?? null,
        locators: c.index?.locators.length ?? 0,
        reachedFiles: c.codeIndex?.files.length ?? 0,
        problem: c.problem,
      })),
    }),
  );

  connection.onRequest(RUN_STATUS_REQUEST, (): RunStatusResult => runStatus());

  connection.onRequest(DESKTOP_REQUEST, async (): Promise<DesktopResult> => {
    const desktop = readDesktopDiscovery(env);
    if (!desktop) return { url: null, projects: [], linked: null };
    const projects = await new PiwiClient({ serverUrl: desktop.url, apiKey: desktop.token, project: '' })
      .projects()
      .catch(() => []);
    const id = contexts[0] ? linkedDesktopProject(desktop, contexts[0].root) : null;
    const linked = id === null ? null : (projects.find((p) => p.id === id) ?? null);
    return { url: desktop.url, projects, linked };
  });

  connection.onRequest(SELECTIONS_REQUEST, async (params: SelectionsParams): Promise<SelectionsResult> => {
    const file = params.uri ? uriToPath(params.uri) : null;
    const context = (file ? contextFor(file) : null) ?? contexts.find((c) => c.selections.length) ?? null;
    if (!context) return { items: [] };
    const relative = file ? relativeTo(context.root, file) : null;
    const ids =
      relative && SPEC_FILE.test(relative) ? new Set((await context.casesOf(relative)).map((c) => c.id)) : null;
    return {
      items: context.selections.map((sel) => ({
        key: sel.key,
        name: sel.name,
        count: sel.tests.size,
        includesFile: !!ids && [...sel.tests].some((id) => ids.has(id)),
      })),
    };
  });

  connection.onRequest(RUN_SELECTION_REQUEST, (params: RunSelectionParams): RunCommand | null => {
    const file = uriToPath(params.uri);
    const context = (file ? contextFor(file) : null) ?? contexts.find((c) => c.selections.length) ?? null;
    const selection = context?.selections.find((s) => s.key === params.key);
    if (!context || !selection?.command) return null;
    return { cwd: context.root, command: selection.command, args: [] };
  });

  connection.onRequest(
    FAILURES_REQUEST,
    (): FailuresResult => ({
      items: contexts.flatMap((context) =>
        (context.failures?.failures ?? []).flatMap((f) => {
          const site = failureSite(context, f);
          if (!site || !context.client) return [];
          return [
            {
              uri: pathToFileURL(site.file).href,
              line: site.line - 1,
              title: f.title,
              headline: f.headline,
              executionId: f.executionId,
              runId: context.failures!.run!.id,
              url: context.client.executionUrl(f.executionId),
              hasTrace: f.traces.length > 0,
            },
          ];
        }),
      ),
    }),
  );

  connection.onRequest(TRACE_REQUEST, async (params: TraceParams): Promise<TraceResult | null> => {
    const file = uriToPath(params.uri);
    const candidates = [file ? contextFor(file) : null, ...contexts].filter((c): c is PiwiContext => !!c);
    for (const context of candidates) {
      const failure = context.failures?.failures.find((f) => f.executionId === params.executionId);
      if (!failure?.traces.length) continue;
      const trace = await context.evidence(failure.traces[failure.traces.length - 1]!);
      if (!trace) return null;
      return { path: trace, cwd: context.root, command: `npx playwright show-trace "${trace}"` };
    }
    return null;
  });

  connection.onRequest(MCP_REQUEST, (): McpServersResult => {
    const seen = new Set<string>();
    const servers: McpServersResult['servers'] = [];
    for (const c of contexts) {
      const conn = c.client?.connection;
      if (!conn || seen.has(conn.serverUrl)) continue;
      seen.add(conn.serverUrl);
      let host = conn.serverUrl;
      try {
        host = new URL(conn.serverUrl).host;
      } catch {
        // keep the URL as given
      }
      servers.push({
        label: `Piwi (${host})`,
        url: `${conn.serverUrl}/mcp`,
        headers: conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {},
      });
    }
    return { servers };
  });

  connection.onRequest(RENDER_STEPS_REQUEST, async (params: RenderStepsParams): Promise<RenderStepsResult> => {
    const parsed = parseSteps(params.steps);
    if (!parsed.ok) return { code: '', warnings: parsed.errors };
    const file = uriToPath(params.uri);
    const context = (file ? contextFor(file) : null) ?? contexts.find((c) => c.client && c.project) ?? null;
    const suiteLocators = new Set(
      (context?.index?.locators ?? []).flatMap((l) => {
        const canonical = canonicalLocator(l.locator);
        return canonical ? [canonical] : [];
      }),
    );
    const result = renderSpec(sessionFromSteps(parsed.steps), {
      format: 'body',
      urls: 'relative',
      locators: 'stable',
      urlChecks: true,
      catalog: context ? await context.functionCatalog() : [],
      preferLocators: suiteLocators,
    });
    return { code: result.code, warnings: result.warnings.map((w) => w.message) };
  });

  connection.onRequest(REFRESH_REQUEST, async () => {
    await refreshAll();
    return null;
  });

  connection.onNotification(SET_CREDENTIALS_NOTIFICATION, (next: EditorCredentials) => {
    credentials = next ?? {};
    void refreshAll();
  });

  documents.listen(connection);
  connection.listen();
  return () => {
    stopped = true;
    if (refreshTimer) clearInterval(refreshTimer);
    fs.unwatchFile(desktopFile, onDesktopFile);
    if (runTimer) clearTimeout(runTimer);
    for (const t of timers.values()) clearTimeout(t);
  };
}
