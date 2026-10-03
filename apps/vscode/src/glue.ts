/**
 * What the extension shows, computed from the editor service's answers with
 * no VS Code API, so it is tested without an editor: the status bar item, the
 * file patterns the service reads, and the MCP configuration editors without
 * the MCP provider API are given to paste.
 */
import type {
  ConnectionSource,
  DesktopJobUpdate,
  DesktopResult,
  McpServerDefinition,
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
  tooltip: string;
  /** `open` opens `url` in the browser; `connect` runs Piwi: Connect. */
  action: 'open' | 'connect' | 'none';
  url: string | null;
  /** Whether the item uses the editor's error background. */
  error: boolean;
}

const ACTIVE = new Set(['running', 'initializing', 'finalizing']);

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A line on the desktop app when it is not in use: it runs and Connect can
 * switch to it, or it was chosen and does not run. Empty otherwise.
 */
function desktopHint(status: StatusResult | null, desktopChosen: boolean): string {
  const inUse = status?.contexts.some((c) => c.source === 'desktop');
  if (!status || inUse) return '';
  if (status.desktopUrl) return '\nThe Piwi desktop app runs on this machine: Piwi: Connect to use it.';
  return desktopChosen ? '\nThe Piwi desktop app, chosen with Piwi: Connect, is not running.' : '';
}

/** The status bar item: the latest run on the checked-out branch, or what keeps the service from reading it. */
export function statusBarView(
  status: StatusResult | null,
  runs: RunStatusResult | null,
  desktopChosen = false,
): StatusBarView {
  const contexts = status?.contexts ?? [];
  if (!contexts.length) {
    return { text: '$(beaker) Piwi', tooltip: 'No Playwright config found', action: 'none', url: null, error: false };
  }
  const hint = desktopHint(status, desktopChosen);
  const connected = contexts.find((c) => c.connected);
  if (!connected) {
    return {
      text: '$(plug) Piwi: connect',
      tooltip: (contexts[0]!.problem ?? 'Not connected') + hint,
      action: 'connect',
      url: null,
      error: false,
    };
  }
  const run = runs?.contexts.find((c) => c.root === connected.root) ?? runs?.contexts[0];
  // The checked-out branch has no run yet: another branch's is shown.
  const fallback =
    run?.run && run.checkedOut && run.checkedOut !== run.branch ? ` (${run.checkedOut} has no run yet)` : '';
  const where = `${connected.projectName ?? 'Piwi'}${run?.branch ? ` on ${run.branch}` : ''}${fallback}`;
  const from = (connected.serverUrl ? `\n${connected.serverUrl}, from ${sourceLabel(connected.source)}` : '') + hint;
  if (!run?.run) {
    return {
      text: '$(beaker) Piwi: no run',
      tooltip: `No run of ${where} yet${from}`,
      action: 'none',
      url: null,
      error: false,
    };
  }
  const r = run.run;
  const tooltip = `Run #${r.id} of ${where}: ${r.passedTests} passed, ${r.failedTests} failed, ${r.flakyTests} flaky, ${r.skippedTests} skipped${from}`;
  if (ACTIVE.has(r.status)) {
    const done = r.passedTests + r.failedTests + r.flakyTests + r.skippedTests;
    const failing = r.failedTests ? ` · ${r.failedTests} failing` : '';
    return {
      text: `$(sync~spin) Piwi: ${done}/${r.totalTests}${failing}`,
      tooltip,
      action: 'open',
      url: r.url,
      error: false,
    };
  }
  if (r.failedTests > 0) {
    const flaky = r.flakyTests ? ` · ${r.flakyTests} flaky` : '';
    return {
      text: `$(error) Piwi: ${r.failedTests} failing${flaky}`,
      tooltip,
      action: 'open',
      url: r.url,
      error: true,
    };
  }
  if (r.status !== 'passed' && r.status !== 'failed') {
    return { text: `$(warning) Piwi: ${r.status}`, tooltip, action: 'open', url: r.url, error: false };
  }
  const flaky = r.flakyTests ? ` · ${r.flakyTests} flaky` : '';
  return {
    text: `$(pass) Piwi: ${plural(r.passedTests, 'passed', 'passed')}${flaky}`,
    tooltip,
    action: 'open',
    url: r.url,
    error: false,
  };
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
