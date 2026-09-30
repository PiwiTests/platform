/**
 * What the extension shows, computed from the editor service's answers with
 * no VS Code API, so it is tested without an editor: the status bar item, the
 * file patterns the service reads, and the MCP configuration editors without
 * the MCP provider API are given to paste.
 */
import type { ConnectionSource, McpServerDefinition, RunStatusResult, StatusResult } from '@piwitests/editor/protocol';

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

/** The status bar item: the latest run on the checked-out branch, or what keeps the service from reading it. */
export function statusBarView(status: StatusResult | null, runs: RunStatusResult | null): StatusBarView {
  const contexts = status?.contexts ?? [];
  if (!contexts.length) {
    return { text: '$(beaker) Piwi', tooltip: 'No Playwright config found', action: 'none', url: null, error: false };
  }
  const connected = contexts.find((c) => c.connected);
  if (!connected) {
    return {
      text: '$(plug) Piwi: connect',
      tooltip: contexts[0]!.problem ?? 'Not connected',
      action: 'connect',
      url: null,
      error: false,
    };
  }
  const run = runs?.contexts.find((c) => c.root === connected.root) ?? runs?.contexts[0];
  const where = `${connected.projectName ?? 'Piwi'}${run?.branch ? ` on ${run.branch}` : ''}`;
  const from = connected.serverUrl ? `\n${connected.serverUrl}, from ${sourceLabel(connected.source)}` : '';
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
export function disconnectQuestion(serverUrl: string | null, project: string | null): string | null {
  if (serverUrl) return `forget ${serverUrl}, the project, and the API key saved for it?`;
  if (project) return `forget the project ${project} saved for the desktop app?`;
  return null;
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
