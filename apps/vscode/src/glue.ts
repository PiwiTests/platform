/**
 * What the extension shows, computed from the editor service's answers with
 * no VS Code API, so it is tested without an editor: the status bar item, the
 * file patterns the service reads, the MCP configuration editors without
 * the MCP provider API are given to paste, and the recorded block a recording
 * writes and follows through the edits around it.
 */
import type {
  ConnectionSource,
  DesktopJobUpdate,
  DesktopResult,
  LiveRun,
  McpServerDefinition,
  RecordingPlacement,
  RecordingUpdate,
  RunStatus,
  RunStatusResult,
  StatusResult,
  SummaryLine,
  TestLineStatus,
} from '@piwitests/editor/protocol';

/** The files the editor service reads: test and application code, and translations. */
export const DOCUMENT_PATTERN =
  '**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,vue,svelte,astro,html,json,yaml,yml,properties,po,resx,cshtml,razor}';

export interface StatusBarView {
  text: string;
  /** Markdown: what the item shows and when it was read, then links to the run, the dashboard and Connect. */
  tooltip: string;
  /** `refresh` reads the latest run again (`piwi.refreshRun`); `connect` runs Piwi: Connect. */
  action: 'refresh' | 'connect' | 'none';
  /** The latest run's page, which `piwi.openRun` opens. */
  url: string | null;
  /** Whether the item uses the editor's error background. */
  error: boolean;
}

const ACTIVE = new Set(['running', 'initializing', 'finalizing']);

/** The commands the status bar item's tooltip links to. */
export const STATUS_TOOLTIP_COMMANDS = ['piwi.openRun', 'piwi.openInDashboard', 'piwi.connect'];

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A text shown as written in Markdown. */
function md(text: string): string {
  return text.replace(/[\\`*_[\]<>|]/g, '\\$&');
}

/** Markdown lines, each a paragraph of its own, without the empty ones. */
function lines(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join('\n\n');
}

/** How long before `now` an ISO 8601 time is: `12 s ago`, `4 min ago`, `2 h ago`, `3 d ago`, or `just now`. */
export function relativeTime(iso: string, now: number): string {
  const seconds = Math.floor((now - Date.parse(iso)) / 1000);
  if (!(seconds >= 1)) return 'just now';
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/**
 * A line on the desktop app when it is not in use: it runs and Connect can
 * switch to it, or it was chosen and does not run. Null otherwise.
 */
function desktopHint(status: StatusResult | null, desktopChosen: boolean): string | null {
  const inUse = status?.contexts.some((c) => c.source === 'desktop');
  if (!status || inUse) return null;
  if (status.desktopUrl) return 'The Piwi desktop app runs on this machine: Piwi: Connect to use it.';
  return desktopChosen ? 'The Piwi desktop app, chosen with Piwi: Connect, is not running.' : null;
}

/** A run in progress in the status bar: `$(sync~spin) Piwi: 4/9 · 1 failing`, and ` · your run` for the editor's own. */
function liveText(live: LiveRun): string {
  const failing = live.failed ? ` · ${live.failed} failing` : '';
  return `$(sync~spin) Piwi: ${live.done}/${live.total}${failing}${live.own ? ' · your run' : ''}`;
}

/** The tooltip's line on a run in progress: `Your run #124 is running: 4/9 · 1 failing`. */
function liveLine(live: LiveRun): string {
  const failing = live.failed ? ` · ${live.failed} failing` : '';
  return `${live.own ? 'Your run' : 'Run'} #${live.runId} is running: ${live.done}/${live.total}${failing}`;
}

/** When the latest run was read, and how the service learns of the next: `Updated 12 s ago · live`. */
function updatedLine(run: RunStatus | undefined, now: number): string | null {
  if (!run?.updatedAt) return null;
  const how = run.stream === 'live' ? ' · live' : run.stream === 'polling' ? ' · read every minute' : '';
  return `Updated ${relativeTime(run.updatedAt, now)}${how}`;
}

/** The item's text while the latest run is read again: its icon spins. */
export function refreshingText(text: string): string {
  return `$(sync~spin) ${text.replace(/^\$\([^)]*\)\s*/, '')}`;
}

/**
 * The status bar item: the latest run on the checked-out branch, with what the runs laid over it fixed or still fail,
 * or what keeps the service from reading it. While a run is in progress, the editor's own or one on the branch, the
 * item counts it, and the tooltip has both. A click reads the latest run again; the tooltip says when it was read and
 * links to the run, the dashboard and Connect.
 */
export function statusBarView(
  status: StatusResult | null,
  runs: RunStatusResult | null,
  desktopChosen = false,
  now = Date.now(),
): StatusBarView {
  const contexts = status?.contexts ?? [];
  if (!contexts.length) {
    return { text: '$(beaker) Piwi', tooltip: 'No Playwright config found', action: 'none', url: null, error: false };
  }
  const hint = desktopHint(status, desktopChosen);
  const connect = '[Connect](command:piwi.connect)';
  const connected = contexts.find((c) => c.connected);
  if (!connected) {
    return {
      text: '$(plug) Piwi: connect',
      tooltip: lines(md(contexts[0]!.problem ?? 'Not connected'), hint, connect),
      action: 'connect',
      url: null,
      error: false,
    };
  }
  const run = runs?.contexts.find((c) => c.root === connected.root) ?? runs?.contexts[0];
  // The checked-out branch has no run yet: another branch's is shown.
  const fallback =
    run?.run && run.checkedOut && run.checkedOut !== run.branch ? ` (${run.checkedOut} has no run yet)` : '';
  const where = md(`${connected.projectName ?? 'Piwi'}${run?.branch ? ` on ${run.branch}` : ''}${fallback}`);
  const from = connected.serverUrl ? md(`${connected.serverUrl}, from ${sourceLabel(connected.source)}`) : null;
  const live = run?.live ?? null;
  const progress = live ? liveLine(live) : null;
  const updated = updatedLine(run, now);
  const dashboard = '[Open in dashboard](command:piwi.openInDashboard)';
  if (!run?.run) {
    return {
      text: live ? liveText(live) : '$(beaker) Piwi: no run',
      tooltip: lines(`No run of ${where} yet`, progress, updated, from, hint, `${dashboard} · ${connect}`),
      action: 'refresh',
      url: null,
      error: false,
    };
  }
  const r = run.run;
  // The tests still failing once the later runs are laid over the run; the run's own count from an older service.
  const failing = run.failingTests ?? r.failedTests;
  const fixed = run.resolved ?? 0;
  const tooltip = lines(
    `Run #${r.id} of ${where}: ${r.passedTests} passed, ${r.failedTests} failed, ${r.flakyTests} flaky, ${r.skippedTests} skipped`,
    run.overlays ? `${plural(run.overlays, 'local run')} since · ${plural(fixed, 'test')} fixed locally` : null,
    progress,
    updated,
    from,
    hint,
    `[Open run #${r.id}](command:piwi.openRun) · ${dashboard} · ${connect}`,
  );
  const view = { tooltip, action: 'refresh' as const, url: r.url, error: false };
  if (live || ACTIVE.has(r.status)) {
    const done = r.passedTests + r.failedTests + r.flakyTests + r.skippedTests;
    const failed = r.failedTests ? ` · ${r.failedTests} failing` : '';
    return { ...view, text: live ? liveText(live) : `$(sync~spin) Piwi: ${done}/${r.totalTests}${failed}` };
  }
  const flaky = r.flakyTests ? ` · ${r.flakyTests} flaky` : '';
  if (failing > 0) {
    const fixedText = fixed ? ` · ${fixed} fixed locally` : '';
    return { ...view, text: `$(error) Piwi: ${failing} failing${fixedText}${flaky}`, error: true };
  }
  if (r.status !== 'passed' && r.status !== 'failed') return { ...view, text: `$(warning) Piwi: ${r.status}` };
  if (fixed > 0) return { ...view, text: `$(pass) Piwi: ${fixed} fixed locally` };
  return { ...view, text: `$(pass) Piwi: ${plural(r.passedTests, 'passed', 'passed')}${flaky}` };
}

/**
 * The runs as the files show them, in one string: without the run in progress, the stream and the time of the last
 * read, which move while the latest run and its failures stay. The files are drawn again when it changes.
 */
export function runsInFiles(runs: RunStatusResult | null): string {
  return JSON.stringify(
    runs?.contexts.map((c) => ({ ...c, live: undefined, stream: undefined, updatedAt: undefined })) ?? null,
  );
}

/** A test's latest result, drawn on the test: a gutter icon, a hover, and a background while it fails. */
export interface TestDecoration {
  status: TestLineStatus;
  line: number;
  /** The last line of a failing test's background; null for any other result. */
  failingUntil: number | null;
  /** The line a failing test failed at, when the latest run says; null otherwise. */
  failingLine: number | null;
  hover: string;
  dashboardUrl: string | null;
}

/** The decorations of a file's tests: the summary lines that carry a result. */
export function testDecorations(lines: SummaryLine[]): TestDecoration[] {
  return lines.flatMap((l) =>
    l.status
      ? [
          {
            status: l.status,
            line: l.line,
            failingUntil: l.status === 'failed' ? Math.max(l.line, l.endLine ?? l.line) : null,
            failingLine: l.failure?.line ?? null,
            hover: testResultHover(l.status, l.title),
            dashboardUrl:
              l.command?.command === 'piwi.openInDashboard' && typeof l.command.arguments?.[0] === 'string'
                ? (l.command.arguments[0] as string)
                : null,
          },
        ]
      : [],
  );
}

/** A test's hover: its latest result, then its history as the service sums it up. */
export function testResultHover(status: TestLineStatus, title: string): string {
  const result = {
    failed: 'failing',
    flaky: 'flaky',
    passed: 'passing',
    skipped: 'skipped',
    unknown: 'no recent result',
  }[status];
  return [`**Piwi**: ${result}`, title].filter(Boolean).join(' · ');
}

/** Where the service found the instance: the settings come last. */
export function sourceLabel(source: ConnectionSource | null | undefined): string {
  switch (source) {
    case 'environment':
      return 'the environment (PIWI_DASHBOARD_URL)';
    case 'dotenv':
      return 'the workspace .env';
    case 'desktop':
      return 'the Piwi desktop app';
    default:
      return 'the Piwi settings';
  }
}

/** What Piwi: Disconnect asks before forgetting the saved connection; null when nothing is saved. */
export function disconnectQuestion(serverUrl: string | null, project: string | null, desktop = false): string | null {
  const parts: string[] = [];
  if (serverUrl) parts.push(`${serverUrl}, the project, and the API key saved for it`);
  else if (project) parts.push(`the project ${project} saved for the desktop app`);
  if (desktop) parts.push('the choice of the desktop app');
  return parts.length ? `forget ${parts.join(', and ')}?` : null;
}

/** A connection Piwi: Connect offers when the desktop app runs. */
export interface ConnectChoice {
  target: 'desktop' | 'instance' | 'other';
  label: string;
  description: string;
  detail: string;
  /** The address of an `instance`; null otherwise. */
  serverUrl: string | null;
}

/**
 * What Piwi: Connect offers when the desktop app runs: the app, the instance
 * the environment, the `.env` or the settings name (the app does not replace
 * it: either is one pick away), and another instance. The one in use says so.
 */
export function connectChoices(
  status: StatusResult | null,
  desktop: DesktopResult,
  savedUrl: string | null,
): ConnectChoice[] {
  const context = status?.contexts.find((c) => c.connected) ?? status?.contexts[0];
  const usesDesktop = context?.source === 'desktop';
  const choices: ConnectChoice[] = [
    {
      target: 'desktop',
      label: '$(device-desktop) The Piwi desktop app',
      description: `${desktop.url ?? ''}${usesDesktop ? ' · in use' : ''}`,
      detail: desktop.linked
        ? `Runs on this machine; this folder is linked there to the project ${desktop.linked.name}.`
        : 'Runs on this machine: no address or key needed.',
      serverUrl: null,
    },
  ];
  const instance = context?.instance ?? (savedUrl ? { serverUrl: savedUrl, source: 'editor' as const } : null);
  if (instance && instance.serverUrl !== desktop.url) {
    choices.push({
      target: 'instance',
      label: `$(server) ${instance.serverUrl}`,
      description: !usesDesktop && context?.serverUrl === instance.serverUrl ? 'in use' : '',
      detail: `From ${sourceLabel(instance.source)}.`,
      serverUrl: instance.serverUrl,
    });
  }
  choices.push({
    target: 'other',
    label: '$(globe) Another instance…',
    description: '',
    detail: 'A Piwi server, by its address.',
    serverUrl: null,
  });
  return choices;
}

/** A VS Code `mcp.json` holding Piwi's servers, for editors without the MCP provider API. */
export function mcpConfiguration(servers: McpServerDefinition[]): string {
  const entries = servers.map((s, i) => [
    i === 0 ? 'piwi' : `piwi-${i + 1}`,
    { type: 'http', url: s.url, ...(Object.keys(s.headers).length ? { headers: s.headers } : {}) },
  ]);
  return JSON.stringify({ servers: Object.fromEntries(entries) }, null, 2);
}

/**
 * A block of code re-indented to sit at a line indented with `indent`: its common
 * leading indentation removed, then `indent` added to every line after the first
 * (the first lands at the cursor).
 */
export function indentBlock(code: string, indent: string): string {
  const lines = code.replace(/\s+$/, '').split('\n');
  const common = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length),
    Number.MAX_SAFE_INTEGER,
  );
  const stripped = lines.map((l) => (l.trim() ? l.slice(common === Number.MAX_SAFE_INTEGER ? 0 : common) : ''));
  return stripped.map((l, i) => (i === 0 || !l ? l : indent + l)).join('\n');
}

/**
 * How a desktop job's update shows: a job that ended without a verdict (declined, expired, the app gone, or an
 * error) as a warning, anything else as information, with the share button when the verdict can be shared.
 */
export function desktopJobNotice(update: DesktopJobUpdate): {
  severity: 'information' | 'warning';
  text: string;
  actions: string[];
} {
  const failed = update.status !== 'done' && update.status !== 'running';
  return {
    severity: failed || update.message.startsWith('The desktop app could not') ? 'warning' : 'information',
    text: `Piwi: ${update.message}`,
    actions: update.share ? [update.share.label] : [],
  };
}

/** A position in a document: 0-based line and character, as the editor counts them. */
export interface TextPosition {
  line: number;
  character: number;
}

/** A range of a document. */
export interface TextSpan {
  start: TextPosition;
  end: TextPosition;
}

/** `range` replaced with `text`: a change the document went through, or an edit to make. */
export interface TextChange {
  range: TextSpan;
  text: string;
}

const LINE_BREAK = /\r\n|\r|\n/;

function comparePositions(a: TextPosition, b: TextPosition): number {
  return a.line - b.line || a.character - b.character;
}

function point(line: number, character: number): TextSpan {
  return { start: { line, character }, end: { line, character } };
}

/** Where `text` ends once inserted at `start`. */
function endOfInsert(start: TextPosition, text: string): TextPosition {
  const lines = text.split(LINE_BREAK);
  return lines.length === 1
    ? { line: start.line, character: start.character + text.length }
    : { line: start.line + lines.length - 1, character: lines[lines.length - 1]!.length };
}

/** Where a position at or after the end of a change's range is once the change is made. */
function afterChange(position: TextPosition, change: TextChange): TextPosition {
  const end = endOfInsert(change.range.start, change.text);
  return position.line === change.range.end.line
    ? { line: end.line, character: end.character + position.character - change.range.end.character }
    : { line: position.line + end.line - change.range.end.line, character: position.character };
}

/**
 * The recorded block as the file holds it: `RecordingUpdate.code` with every non-empty line prefixed with the
 * placement's indentation.
 */
export function recordedBlockText(code: string, indent: string): string {
  return code
    .split('\n')
    .map((line) => (line ? indent + line : line))
    .join('\n');
}

/**
 * Where the recorded block is. Until its first write, `range` is the start of the line `RecordResult.placement`
 * names, and `first` says how that write places the block: `insert` it on a new line there, or `replace` that line
 * while it is blank. Null once written: every later write replaces the block.
 */
export interface RecordedBlock {
  range: TextSpan;
  first: 'insert' | 'replace' | null;
}

/** The block of a recording that has written nothing yet: the start of the line its placement names. */
export function placedBlock(placement: RecordingPlacement): RecordedBlock {
  return { range: point(placement.line, 0), first: placement.newLine ? 'insert' : 'replace' };
}

/**
 * Follows the recorded block through one change of the document. A change `above` the block moves it and one `below`
 * it leaves it; one `inside` it, or across one of its edges, changes its text, and the block then covers what the
 * change wrote. Whole lines added or removed right before the block, or added right after it, stay outside it.
 */
export function followBlock(
  block: TextSpan,
  change: TextChange,
): { block: TextSpan; where: 'above' | 'inside' | 'below' } {
  const { start, end } = change.range;
  const touchesStart = comparePositions(end, block.start);
  const touchesEnd = comparePositions(start, block.end);
  const above =
    touchesStart < 0 ||
    (touchesStart === 0 && block.start.character === 0 && endOfInsert(start, change.text).character === 0);
  if (above) {
    return { where: 'above', block: { start: afterChange(block.start, change), end: afterChange(block.end, change) } };
  }
  if (touchesEnd > 0 || (touchesEnd === 0 && /^(?:\r\n|\r|\n)/.test(change.text))) return { where: 'below', block };
  return {
    where: 'inside',
    block: {
      start: comparePositions(start, block.start) < 0 ? start : block.start,
      end: comparePositions(end, block.end) >= 0 ? endOfInsert(start, change.text) : afterChange(block.end, change),
    },
  };
}

const IMPORT_START = /^import[\s{*'"]/;
const IMPORT_END = /(?:\bfrom\s*|^import\s*)(['"])[^'"]*\1|\brequire\s*\(/;

/** An import line with its spacing, its quotes and its final semicolon left out, to compare it with another. */
function importKey(line: string): string {
  return line.replace(/\s+/g, '').replace(/"/g, "'").replace(/;$/, '');
}

/**
 * The insertion of the import lines a file lacks among `imports`, which the editor service sends only when their
 * names are not bound in the file: after its last top-level `import` statement, or at the top when it has none; null
 * when it holds them all already, written in any spacing or quote style. An edit that replaces lines `replaced` with
 * `written` is taken into account: the replaced lines no longer count, and the written ones do.
 */
export function importInsertion(
  lines: string[],
  imports: string[],
  replaced: { start: number; end: number } | null = null,
  written = '',
): TextChange | null {
  const counts = (i: number) => !replaced || i < replaced.start || i > replaced.end;
  const present = new Set([...lines.filter((_, i) => counts(i)), ...written.split(LINE_BREAK)].map(importKey));
  /** The import statements of the file, as the first and last line of each. */
  const statements: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!counts(i) || !IMPORT_START.test(lines[i]!)) continue;
    let end = i;
    while (!IMPORT_END.test(lines[end]!) && end + 1 < lines.length && counts(end + 1)) end++;
    statements.push({ start: i, end });
    i = end;
  }
  const missing: string[] = [];
  for (const line of imports) {
    const key = importKey(line);
    if (!key || present.has(key)) continue;
    present.add(key);
    missing.push(line.trim());
  }
  if (!missing.length) return null;
  const last = statements.length > 0 ? statements[statements.length - 1]!.end : -1;
  const at = last + 1;
  if (at < lines.length || !lines.length) return { range: point(at, 0), text: `${missing.join('\n')}\n` };
  const end = lines.length - 1;
  return { range: point(end, lines[end]!.length), text: `\n${missing.join('\n')}` };
}

/**
 * The edit that writes the recorded block's new text, with the import lines the file lacks in the same edit, and the
 * block's range once it is made. The first write places the block as `first` says; every later one replaces the
 * block, keeping it on lines of its own.
 */
export function writeBlock(
  lines: string[],
  block: RecordedBlock,
  text: string,
  imports: string[],
): { changes: TextChange[]; block: TextSpan } {
  const lastLine = Math.max(lines.length - 1, 0);
  const line = block.range.start.line;
  let change: TextChange;
  let replaced: { start: number; end: number } | null = null;
  let startLine: number;
  if (block.first && line >= lines.length) {
    change = { range: point(lastLine, (lines[lastLine] ?? '').length), text: `\n${text}` };
    startLine = lines.length;
  } else if (block.first === 'insert' || (block.first === 'replace' && lines[line]!.trim())) {
    change = { range: point(line, 0), text: `${text}\n` };
    startLine = line;
  } else if (block.first === 'replace') {
    change = { range: { start: { line, character: 0 }, end: { line, character: lines[line]!.length } }, text };
    replaced = { start: line, end: line };
    startLine = line;
  } else {
    const clamp = (p: TextPosition): TextPosition =>
      p.line > lastLine
        ? { line: lastLine, character: (lines[lastLine] ?? '').length }
        : { line: p.line, character: Math.min(p.character, (lines[p.line] ?? '').length) };
    let start = clamp(block.range.start);
    let end = clamp(block.range.end);
    const startText = lines[start.line] ?? '';
    const endText = lines[end.line] ?? '';
    if (!startText.slice(0, start.character).trim()) start = { line: start.line, character: 0 };
    if (!endText.slice(end.character).trim()) end = { line: end.line, character: endText.length };
    const before = start.character > 0 ? '\n' : '';
    const after = end.character < endText.length ? '\n' : '';
    change = { range: { start, end }, text: before + text + after };
    replaced = { start: start.line, end: end.line };
    startLine = start.line + (before ? 1 : 0);
  }
  const insertion = importInsertion(lines, imports, replaced, text);
  const shift =
    insertion && comparePositions(insertion.range.start, change.range.start) <= 0
      ? insertion.text.split(LINE_BREAK).length - 1
      : 0;
  const first = { line: startLine + shift, character: 0 };
  return {
    changes: insertion ? [insertion, change] : [change],
    block: { start: first, end: endOfInsert(first, text) },
  };
}

/** A button of a recording's controls: the command it runs, with the session's id as its argument. */
export interface RecordingAction {
  title: string;
  command: 'piwi.stopRecording' | 'piwi.pauseRecording' | 'piwi.resumeRecording';
}

/** What the controls above the recorded block and the status bar item show while a recording runs. */
export interface RecordingView {
  /** The first control: the state and the step count. */
  title: string;
  actions: RecordingAction[];
  status: string;
  tooltip: string;
}

/**
 * The controls of a running recording, from the service's state, the step count, and whether it is paused because
 * the block was edited (`edited`), which takes precedence. `file` is the name of the file it writes into.
 */
export function recordingView(
  state: RecordingUpdate['state'],
  steps: number,
  edited: boolean,
  file: string,
): RecordingView {
  const count = plural(steps, 'step');
  const stop: RecordingAction = { title: 'Stop', command: 'piwi.stopRecording' };
  const resume: RecordingAction = { title: 'Resume', command: 'piwi.resumeRecording' };
  if (edited) {
    return {
      title: `$(debug-pause) Paused while you edit · ${count}`,
      actions: [resume, { title: 'Keep my edits', command: 'piwi.stopRecording' }],
      status: `$(debug-pause) Piwi: paused · ${count}`,
      tooltip: `The recording into ${file} is paused: you edited the recorded block. Click to stop and keep your edits.`,
    };
  }
  if (state === 'paused') {
    return {
      title: `$(debug-pause) Paused · ${count}`,
      actions: [stop, resume],
      status: `$(debug-pause) Piwi: paused · ${count}`,
      tooltip: `The recording into ${file} is paused. Click to stop.`,
    };
  }
  if (state === 'starting') {
    return {
      title: '$(loading~spin) Opening the browser',
      actions: [stop],
      status: '$(loading~spin) Piwi: opening the browser',
      tooltip: `Recording into ${file}. Click to stop.`,
    };
  }
  return {
    title: `$(record) Recording · ${count}`,
    actions: [stop, { title: 'Pause', command: 'piwi.pauseRecording' }],
    status: `$(record) Piwi: recording · ${count}`,
    tooltip: `Recording into ${file}. Click to stop.`,
  };
}

/**
 * Where a recording started at a position writes, from where `piwi/pageCandidates` says the position is: outside every
 * test, function and class, a new test (`test`); anywhere else, the steps there (`steps`), which the editor service
 * refuses where they cannot go.
 */
export function recordInto(context: string): 'steps' | 'test' {
  return context === 'file' ? 'test' : 'steps';
}

/** The notification after a recording stopped: what was written, or that the block keeps the edits made in it. */
export function recordingSummary(
  update: Pick<RecordingUpdate, 'steps' | 'warnings' | 'message'>,
  keptEdits: boolean,
): string {
  if (keptEdits) return 'Piwi: recording stopped. The recorded block keeps your edits.';
  const warnings = update.warnings.length;
  const counts = `${plural(update.steps.length, 'step')} written${warnings ? `, ${plural(warnings, 'warning')} to check` : ''}`;
  const message = update.message?.trim();
  if (!message) return `Piwi: recording stopped, ${counts}.`;
  return `Piwi: ${/[.!?]$/.test(message) ? message : `${message}.`} ${counts}.`;
}

/** A Playwright test file's name: `.spec` or `.test`, then a JavaScript or TypeScript extension. */
export const TEST_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;

/** The `testDir` a Playwright config names as a string literal; null when it names none that way. */
export function configTestDir(config: string): string | null {
  return /\btestDir\s*:\s*(['"`])([^'"`]+)\1/.exec(config)?.[2] ?? null;
}

/**
 * The name offered for a new test file, with the suffix of `sample`: a test file's own (`.test.js`), else `.spec.js`
 * beside a JavaScript Playwright config, else `.spec.ts`.
 */
export function newTestFileName(sample: string | null): string {
  const suffix =
    (sample && TEST_FILE.exec(sample)?.[0]) || (sample && /\.[cm]?js$/.test(sample) ? '.spec.js' : '.spec.ts');
  return `recorded${suffix}`;
}
