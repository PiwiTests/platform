import { describe, it, expect } from 'vitest';
import { parseSelectArgs, parseDuration } from '../src/cli/select.js';
import { readSelectionStamp } from '../src/internal/support/selection-env.js';

describe('parseDuration', () => {
  it('parses units and plain millisecond counts', () => {
    expect(parseDuration('5m')).toBe(300_000);
    expect(parseDuration('90s')).toBe(90_000);
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('250ms')).toBe(250);
    expect(parseDuration('300000')).toBe(300_000);
  });

  it('rejects nonsense', () => {
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('0')).toBeNull();
    expect(parseDuration('-5m')).toBeNull();
  });
});

describe('parseSelectArgs', () => {
  const env = { PIWI_DASHBOARD_URL: 'https://dash.example', PIWI_API_KEY: 'k', PIWI_PROJECT_NAME: 'web' };

  it('reads the key, flags and env fallbacks', () => {
    const args = parseSelectArgs(['smoke', '--format', 'grep', '--budget', '5m', '--strict'], env);
    expect(args.key).toBe('smoke');
    expect(args.serverUrl).toBe('https://dash.example');
    expect(args.apiKey).toBe('k');
    expect(args.project).toBe('web');
    expect(args.format).toBe('grep');
    expect(args.budgetMs).toBe(300_000);
    expect(args.strict).toBe(true);
  });

  it('splits playwright passthrough args after --', () => {
    const args = parseSelectArgs(['smoke', '--', '--workers=1', '--headed'], env);
    expect(args.key).toBe('smoke');
    expect(args.extra).toEqual(['--workers=1', '--headed']);
  });

  it('requires a server URL and a key', () => {
    expect(() => parseSelectArgs(['smoke'], {})).toThrow(/dashboard URL/);
    expect(() => parseSelectArgs(['--format', 'grep'], env)).toThrow(/selection key/);
  });

  it('rejects an unparseable budget', () => {
    expect(() => parseSelectArgs(['smoke', '--budget', 'soon'], env)).toThrow(/--budget/);
  });

  it('accepts a well-formed shard and rejects a malformed one', () => {
    expect(parseSelectArgs(['smoke', '--shard', '2/4'], env).shard).toBe('2/4');
    expect(parseSelectArgs(['smoke'], env).shard).toBeNull();
    expect(() => parseSelectArgs(['smoke', '--shard', '2of4'], env)).toThrow(/--shard/);
  });

  it('reads the impact base ref and keeps the key as impact', () => {
    const args = parseSelectArgs(['impact', '--base', 'origin/main'], env);
    expect(args.key).toBe('impact');
    expect(args.base).toBe('origin/main');
    expect(parseSelectArgs(['smoke'], env).base).toBeNull();
  });

  it('maps --fail-fast to a failure-first order', () => {
    expect(parseSelectArgs(['smoke', '--fail-fast'], env).order).toBe('failureLikelihood');
    expect(parseSelectArgs(['smoke'], env).order).toBeNull();
  });
});

describe('readSelectionStamp', () => {
  it('returns a stamp only when every field is present and well-formed', () => {
    expect(
      readSelectionStamp({
        PIWI_SELECTION: 'smoke',
        PIWI_SELECTION_VERSION: '7',
        PIWI_SELECTION_HASH: 'abc123',
        PIWI_SELECTION_COUNT: '42',
      }),
    ).toEqual({ key: 'smoke', version: 7, resolvedHash: 'abc123', resolvedCount: 42 });
  });

  it('returns null without a key or with a malformed field', () => {
    expect(readSelectionStamp({})).toBeNull();
    expect(readSelectionStamp({ PIWI_SELECTION: 'smoke', PIWI_SELECTION_VERSION: 'x' })).toBeNull();
    expect(
      readSelectionStamp({ PIWI_SELECTION: 'smoke', PIWI_SELECTION_VERSION: '1', PIWI_SELECTION_COUNT: '2' }),
    ).toBeNull(); // no hash
  });
});
