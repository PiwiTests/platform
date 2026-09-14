import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  callClaudeCli,
  claudeCliEnabled,
  getClaudeCliStatus,
  getUsageTotals,
  isDesktopRuntime,
  resetClaudeCliCache,
  resolveClaudeBinary,
  resolveClaudeBinaryDeep,
  streamClaudeCli,
} from '../../server/utils/ai-claude-cli';
import type { ResolvedAiRole } from '../../types/api';
import type { StreamChunk } from '../../server/utils/ai-provider';

// A stub standing in for the real `claude` binary. It answers the metadata
// probes (`--version`, `auth status`) and echoes a canned generation result so
// the spawn → parse → usage-tally path can be exercised without a real CLI.
const STUB = `#!/usr/bin/env node
const args = process.argv.slice(2);
const outFmt = args[args.indexOf('--output-format') + 1];
if (args.includes('--version')) { process.stdout.write('9.9.9 (stub)\\n'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') {
  const loggedIn = process.env.STUB_LOGGED_IN !== '0';
  process.stdout.write(JSON.stringify({ loggedIn, authMethod: 'oauth_token', apiProvider: 'firstParty' }));
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'login') { process.stdout.write('Open https://claude.ai/oauth/stub to continue\\n'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'logout') { process.exit(0); }
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  if (outFmt === 'stream-json') {
    const line = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
    line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } } });
    line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } } });
    line({ type: 'result', subtype: 'success', is_error: false, result: 'Hello world', total_cost_usd: 0.01,
      usage: { input_tokens: 11, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 },
      modelUsage: { 'claude-sonnet-5': {} } });
  } else {
    const body = input.trim() === 'ENVCHECK' ? 'API_KEY=' + (process.env.ANTHROPIC_API_KEY || 'unset') : 'ECHO:' + input.trim();
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false,
      result: body, total_cost_usd: 0.02,
      usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 },
      modelUsage: { 'claude-opus-5': {} } }));
  }
  process.exit(0);
});
`;

const role: ResolvedAiRole = { provider: 'claude-cli', apiKey: '', model: 'opus', baseUrl: null, temperature: null };

let dir: string;
let stubPath: string;
const savedEnv = { ...process.env };

describe.skipIf(process.platform === 'win32')('ai-claude-cli', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claude-stub-'));
    stubPath = join(dir, 'claude');
    writeFileSync(stubPath, STUB);
    chmodSync(stubPath, 0o755);
    process.env.PIWI_CLAUDE_CLI_PATH = stubPath;
    delete process.env.STUB_LOGGED_IN;
    delete process.env.PIWI_DESKTOP_TOKEN;
    delete process.env.NUXT_PUBLIC_DESKTOP;
    resetClaudeCliCache();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetClaudeCliCache();
  });

  afterAll(() => {
    process.env = { ...savedEnv };
  });

  it('is enabled when a binary path is pinned, even outside desktop', () => {
    expect(isDesktopRuntime()).toBe(false);
    expect(claudeCliEnabled()).toBe(true);
  });

  it('resolves the pinned binary, and null when the path is missing', () => {
    expect(resolveClaudeBinary()).toBe(stubPath);
    process.env.PIWI_CLAUDE_CLI_PATH = join(dir, 'does-not-exist');
    resetClaudeCliCache();
    expect(resolveClaudeBinary()).toBeNull();
  });

  // Blank out every source the quick scan reads so it genuinely finds nothing,
  // then restore them. (The test runner sets npm_config_prefix to the Node
  // install, whose bin holds the real `claude`.)
  function withNoQuickScanHit(run: () => void | Promise<void>): () => Promise<void> {
    return async () => {
      const saved = {
        PATH: process.env.PATH,
        npm_config_prefix: process.env.npm_config_prefix,
        PREFIX: process.env.PREFIX,
        SHELL: process.env.SHELL,
      };
      try {
        delete process.env.PIWI_CLAUDE_CLI_PATH;
        process.env.PATH = '';
        delete process.env.npm_config_prefix;
        delete process.env.PREFIX;
        resetClaudeCliCache();
        await run();
      } finally {
        Object.assign(process.env, saved);
        delete process.env.STUB_PATH;
      }
    };
  }

  it(
    'does not cache a not-found result, so a later resolve can recover',
    withNoQuickScanHit(() => {
      expect(resolveClaudeBinary()).toBeNull();
      // The user pins the path; the next resolve must not be stuck on the null.
      process.env.PIWI_CLAUDE_CLI_PATH = stubPath;
      expect(resolveClaudeBinary()).toBe(stubPath);
    }),
  );

  it(
    'falls back to the login shell PATH when the quick scan misses',
    withNoQuickScanHit(async () => {
      // A POSIX-sh stub that ignores its args and prints STUB_PATH as the shell PATH.
      const shellStub = join(dir, 'shell');
      writeFileSync(shellStub, '#!/bin/sh\nprintf %s "$STUB_PATH"\n');
      chmodSync(shellStub, 0o755);
      process.env.SHELL = shellStub; // the login shell "knows" where claude is
      process.env.STUB_PATH = dir;

      expect(resolveClaudeBinary()).toBeNull();
      expect(await resolveClaudeBinaryDeep()).toBe(stubPath);
    }),
  );

  it('reports version and signed-in status without spending tokens', async () => {
    const status = await getClaudeCliStatus({ force: true });
    expect(status.available).toBe(true);
    expect(status.version).toBe('9.9.9');
    expect(status.loggedIn).toBe(true);
    expect(status.authMethod).toBe('oauth_token');
    expect(status.error).toBeNull();
  });

  it('reports not-signed-in when the CLI has no account', async () => {
    process.env.STUB_LOGGED_IN = '0';
    const status = await getClaudeCliStatus({ force: true });
    expect(status.available).toBe(true);
    expect(status.loggedIn).toBe(false);
    expect(status.error).toMatch(/sign/i);
  });

  it('runs a non-streaming generation and maps usage + cost', async () => {
    const before = getUsageTotals().calls;
    const res = await callClaudeCli(role, { system: 'be brief', user: 'ping' });
    expect(res.text).toBe('ECHO:ping');
    expect(res.model).toBe('claude-opus-5');
    expect(res.inputTokens).toBe(5);
    expect(res.outputTokens).toBe(7);
    expect(res.cacheReadInputTokens).toBe(1);
    expect(res.costUsd).toBe(0.02);
    expect(getUsageTotals().calls).toBe(before + 1);
    expect(getUsageTotals().costUsd).toBeCloseTo(0.02, 5);
  });

  it('streams text deltas then a done chunk with usage', async () => {
    const chunks: StreamChunk[] = [];
    for await (const chunk of streamClaudeCli(role, { system: 'be brief', user: 'ping' })) {
      chunks.push(chunk);
    }
    const text = chunks
      .filter((c) => c.type === 'text')
      .map((c) => c.data)
      .join('');
    expect(text).toBe('Hello world');
    const done = chunks.find((c) => c.type === 'done');
    expect(done).toBeDefined();
    const data = done!.data as { model: string; outputTokens: number; costUsd: number };
    expect(data.model).toBe('claude-sonnet-5');
    expect(data.outputTokens).toBe(2);
    expect(data.costUsd).toBe(0.01);
  });

  it('does not leak ANTHROPIC_API_KEY to the CLI (keeps subscription billing)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-be-stripped';
    try {
      const res = await callClaudeCli(role, { system: 'x', user: 'ENVCHECK' });
      expect(res.text).toBe('API_KEY=unset');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('refuses to generate when the CLI is not signed in', async () => {
    process.env.STUB_LOGGED_IN = '0';
    resetClaudeCliCache();
    await expect(callClaudeCli(role, { system: 'x', user: 'y' })).rejects.toThrow(/sign/i);
  });
});
