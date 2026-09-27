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
  DiagnosticSeverity,
  TextDocuments,
  TextDocumentSyncKind,
  type CodeAction,
  type Connection,
  type Diagnostic,
  type Hover,
  type InitializeParams,
  type TextEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { diffLines } from '@piwitests/core/line-diff';
import { locatorCallSiteFiles, sameFilePath, type LocatorBreak } from '@piwitests/core/locator-break';
import { stabilityLabels } from '@piwitests/core/locator-stability';
import type { LocatorIndexTest } from '@piwitests/core/locator-index';
import {
  breakMessage,
  breaksByAnchor,
  breaksOfChange,
  locatorRange,
  locatorsInFile,
  reachFrom,
  replaceLocatorOnLine,
  rewriteEdits,
  stabilityFindings,
  stableReplacement,
  testsReaching,
  type LineLocator,
} from './analysis.js';
import { PiwiContext } from './context.js';
import type { BranchFailure } from './piwi-client.js';
import {
  FILE_SUMMARY_REQUEST,
  MCP_REQUEST,
  REFRESH_REQUEST,
  RUN_STATUS_NOTIFICATION,
  RUN_STATUS_REQUEST,
  TRACE_REQUEST,
  RUN_ARGS_REQUEST,
  SET_CREDENTIALS_NOTIFICATION,
  STATUS_REQUEST,
  TESTS_FOR_FILE_REQUEST,
  type EditorCredentials,
  type EditorTest,
  type FileSummary,
  type FileSummaryParams,
  type McpServersResult,
  type RunCommand,
  type RunStatusResult,
  type RunTestsArgs,
  type StatusResult,
  type SummaryLine,
  type TestsForFile,
  type TestsForFileParams,
  type TraceParams,
  type TraceResult,
} from './protocol.js';
import { findPlaywrightRoots, relativeTo, resolveReportedFile, splitLocation } from './workspace.js';

/** How often every context fetches its indexes again. */
const REFRESH_MS = 5 * 60_000;
/** How often the latest run is read again while it runs, and otherwise. */
const RUN_POLL_ACTIVE_MS = 15_000;
const RUN_POLL_MS = 60_000;
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

  const contextOfRoot = (root: string) => contexts.find((c) => c.root === root) ?? null;

  const failureOf = (data: FailureData): { context: PiwiContext; failure: BranchFailure } | null => {
    const context = contextOfRoot(data.root);
    const failure = context?.failures?.failures.find((f) => f.executionId === data.executionId);
    return context && failure ? { context, failure } : null;
  };

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
    const init = params.initializationOptions as { credentials?: EditorCredentials } | undefined;
    credentials = init?.credentials ?? {};
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
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
  });

  documents.onDidOpen((e) => schedule(e.document, 0));
  documents.onDidChangeContent((e) => schedule(e.document));
  documents.onDidClose((e) => {
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
        if (owner.client) {
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
      parts.push(
        [
          `**CI failure** · [${failure.title.replace(/[[\]]/g, '')}](${context.client?.executionUrl(failure.executionId) ?? ''}) · run #${context.failures?.run?.id ?? ''}`,
          failure.headline ?? '',
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
        out.push({
          line: i,
          title: `passed ${passed}/${runs}${status}`,
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
    if (!tests.length) return empty;
    return {
      file: {
        line: 0,
        title: [`Reached by ${plural(tests.length, 'test')}`, testCounts(tests)].filter(Boolean).join(' · '),
        command: run(tests.map((t) => t.id)),
      },
      lines: [],
    };
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
    if (runTimer) clearTimeout(runTimer);
    for (const t of timers.values()) clearTimeout(t);
  };
}
