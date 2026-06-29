import { describe, it, beforeEach, afterEach, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { hashForProject, computeInstanceId } from '../src/internal/support/instance-id.js';
import { getSetupFilePath, readSetupInfo } from '../src/internal/support/setup-file.js';
import { detectCiRunLabel } from '../src/internal/support/ci.js';
import { readSourceSnippet } from '../src/internal/support/source-snippet.js';
import { createLimiter } from '../src/internal/support/limiter.js';
import { workerIndexOf } from '../src/internal/support/worker-index.js';
import { detectCliFileFilters } from '../src/internal/support/cli-filters.js';

const CI_KEYS = [
  'GITHUB_ACTIONS',
  'GITHUB_RUN_ID',
  'GITLAB_CI',
  'CI_PIPELINE_ID',
  'CIRCLECI',
  'CIRCLE_WORKFLOW_ID',
  'TRAVIS',
  'TRAVIS_BUILD_ID',
  'TF_BUILD',
  'BUILD_BUILDID',
  'JENKINS_URL',
  'BUILD_ID',
  'BUILDKITE_BUILD_ID',
  'TEAMCITY_BUILD_ID',
  'BITBUCKET_BUILD_NUMBER',
  'SEMAPHORE_WORKFLOW_ID',
  'APPVEYOR_BUILD_ID',
  'DRONE_BUILD_NUMBER',
];

const SAVED_ENV: Record<string, string | undefined> = {};
function saveEnv(): void {
  for (const k of CI_KEYS) SAVED_ENV[k] = process.env[k];
}
function clearCiEnv(): void {
  for (const k of CI_KEYS) delete process.env[k];
}
function restoreEnv(): void {
  for (const k of CI_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
}

describe('hashForProject', () => {
  it('returns a deterministic 16-char sha1 prefix', () => {
    const h = hashForProject('my-project');
    expect(h.length).toBe(16);
    expect(hashForProject('my-project')).toBe(h);
    expect(hashForProject('other-project')).not.toBe(h);
  });
});

describe('getSetupFilePath', () => {
  it('lives in os.tmpdir() and embeds the project hash', () => {
    const p = getSetupFilePath('my-project');
    expect(path.dirname(p)).toBe(os.tmpdir());
    const base = path.basename(p);
    expect(base.startsWith('piwi-dashboard-setup-'), base).toBeTruthy();
    expect(base.includes(hashForProject('my-project'))).toBeTruthy();
    expect(base.endsWith('.json')).toBeTruthy();
  });
});

describe('detectCliFileFilters', () => {
  const N = ['node', 'playwright'];
  it('returns [] for a full-suite run with no positional args', () => {
    expect(detectCliFileFilters([...N, 'test'])).toEqual([]);
    expect(detectCliFileFilters([...N, 'test', '--workers=4', '--headed'])).toEqual([]);
  });
  it('captures positional file/path filters', () => {
    expect(detectCliFileFilters([...N, 'test', 'tests/login.spec.ts'])).toEqual(['tests/login.spec.ts']);
    expect(detectCliFileFilters([...N, 'test', 'auth/', 'checkout/'])).toEqual(['auth/', 'checkout/']);
  });
  it('does not mistake value-taking flag values for files', () => {
    expect(detectCliFileFilters([...N, 'test', '-g', '@smoke'])).toEqual([]);
    expect(detectCliFileFilters([...N, 'test', '--grep', '@smoke', 'tests/a.spec.ts'])).toEqual(['tests/a.spec.ts']);
    expect(detectCliFileFilters([...N, 'test', '-j', '4', '--project', 'chromium', 'a.spec.ts'])).toEqual([
      'a.spec.ts',
    ]);
  });
  it('handles --flag=value forms (no extra token consumed)', () => {
    expect(detectCliFileFilters([...N, 'test', '--project=chromium', 'a.spec.ts'])).toEqual(['a.spec.ts']);
  });
  it('works when no explicit test subcommand is present', () => {
    expect(detectCliFileFilters([...N, 'a.spec.ts'])).toEqual(['a.spec.ts']);
  });
});

describe('computeInstanceId', () => {
  it('derives from hostname|projectName when no runLabel', () => {
    const a = computeInstanceId('proj-a', null);
    const b = computeInstanceId('proj-b', null);
    expect(a.length).toBe(16);
    expect(a).not.toBe(b);
    // deterministic
    expect(computeInstanceId('proj-a', null)).toBe(a);
  });

  it('derives from projectName|runLabel when runLabel is set', () => {
    const sharded = computeInstanceId('proj-a', 'run-1');
    const unsharded = computeInstanceId('proj-a', null);
    expect(sharded).not.toBe(unsharded);
    // same label + project → same instanceId (all shards share it)
    expect(computeInstanceId('proj-a', 'run-1')).toBe(sharded);
  });
});

describe('detectCiRunLabel', () => {
  beforeEach(() => {
    saveEnv();
    clearCiEnv();
  });
  afterEach(() => restoreEnv());

  it('returns null outside CI', () => {
    expect(detectCiRunLabel()).toBe(null);
  });

  it('detects GitHub Actions', () => {
    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_RUN_ID = 'gh-123';
    expect(detectCiRunLabel()).toBe('gh-123');
  });

  it('detects GitLab CI', () => {
    process.env.GITLAB_CI = 'true';
    process.env.CI_PIPELINE_ID = 'gl-456';
    expect(detectCiRunLabel()).toBe('gl-456');
  });

  it('detects CircleCI', () => {
    process.env.CIRCLECI = 'true';
    process.env.CIRCLE_WORKFLOW_ID = 'cc-789';
    expect(detectCiRunLabel()).toBe('cc-789');
  });

  it('detects Travis', () => {
    process.env.TRAVIS = 'true';
    process.env.TRAVIS_BUILD_ID = 'tv-1';
    expect(detectCiRunLabel()).toBe('tv-1');
  });

  it('detects Azure Pipelines (TF_BUILD)', () => {
    process.env.TF_BUILD = 'true';
    process.env.BUILD_BUILDID = 'az-1';
    expect(detectCiRunLabel()).toBe('az-1');
  });

  it('detects Jenkins', () => {
    process.env.JENKINS_URL = 'https://jenkins.example.com';
    process.env.BUILD_ID = 'jk-1';
    expect(detectCiRunLabel()).toBe('jk-1');
  });

  it('detects Buildkite / TeamCity / Bitbucket / Semaphore / AppVeyor / Drone', () => {
    process.env.BUILDKITE_BUILD_ID = 'bk-1';
    expect(detectCiRunLabel()).toBe('bk-1');
    clearCiEnv();

    process.env.TEAMCITY_BUILD_ID = 'tc-1';
    expect(detectCiRunLabel()).toBe('tc-1');
    clearCiEnv();

    process.env.BITBUCKET_BUILD_NUMBER = 'bb-1';
    expect(detectCiRunLabel()).toBe('bb-1');
    clearCiEnv();

    process.env.SEMAPHORE_WORKFLOW_ID = 'sm-1';
    expect(detectCiRunLabel()).toBe('sm-1');
    clearCiEnv();

    process.env.APPVEYOR_BUILD_ID = 'ap-1';
    expect(detectCiRunLabel()).toBe('ap-1');
    clearCiEnv();

    process.env.DRONE_BUILD_NUMBER = 'dr-1';
    expect(detectCiRunLabel()).toBe('dr-1');
  });
});

describe('readSourceSnippet', () => {
  it('returns null when the file does not exist', () => {
    expect(readSourceSnippet('/nonexistent/file.ts', 5, 3)).toBe(null);
  });

  it('returns a formatted snippet with a marker on the target line', () => {
    const tmp = path.join(os.tmpdir(), `piwi-snippet-${Date.now()}.ts`);
    fs.writeFileSync(tmp, ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n'), 'utf8');
    try {
      const snippet = readSourceSnippet(tmp, 3, 1);
      expect(snippet).toBeTruthy();
      const lines = snippet!.split('\n');
      // context=1 → start=max(0, 3-1-1)=1, end=min(5, 3+1)=4 → lines[1..3]
      expect(lines.length).toBe(3);
      expect(lines.some((l) => l.startsWith('> ') && l.includes('3 | line3'))).toBeTruthy();
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('clamps start to 0 for early lines', () => {
    const tmp = path.join(os.tmpdir(), `piwi-snippet-${Date.now()}.ts`);
    fs.writeFileSync(tmp, ['a', 'b', 'c'].join('\n'), 'utf8');
    try {
      const snippet = readSourceSnippet(tmp, 1, 30);
      expect(snippet).toBeTruthy();
      expect(snippet!.includes('> ')).toBeTruthy();
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

describe('readSetupInfo', () => {
  it('returns null when no setup file exists', () => {
    expect(readSetupInfo('definitely-no-such-project-' + Date.now())).toBe(null);
  });

  it('round-trips setup info and deletes the file', () => {
    const projectName = 'piwi-setup-roundtrip-' + Date.now();
    const file = getSetupFilePath(projectName);
    fs.writeFileSync(
      file,
      JSON.stringify({ runId: 42, setupToken: 'tok', projectName }),
      'utf8',
    );
    try {
      const info = readSetupInfo(projectName);
      expect(info).toEqual({ runId: 42, setupToken: 'tok', projectName });
      // second read returns null (file consumed)
      expect(readSetupInfo(projectName)).toBe(null);
    } finally {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });

  it('returns null when projectName does not match', () => {
    const projectName = 'piwi-setup-mismatch-' + Date.now();
    const file = getSetupFilePath(projectName);
    fs.writeFileSync(
      file,
      JSON.stringify({ runId: 1, setupToken: 't', projectName: 'other-project' }),
      'utf8',
    );
    try {
      expect(readSetupInfo(projectName)).toBe(null);
    } finally {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });
});

describe('workerIndexOf', () => {
  it('returns workerIndex when present', () => {
    expect(workerIndexOf({ workerIndex: 3, parallelIndex: 1 })).toBe(3);
  });

  it('falls back to parallelIndex when workerIndex is absent', () => {
    expect(workerIndexOf({ parallelIndex: 1 })).toBe(1);
  });

  it('returns null when neither is set', () => {
    expect(workerIndexOf({})).toBe(null);
    expect(workerIndexOf(null)).toBe(null);
    expect(workerIndexOf(undefined)).toBe(null);
  });

  it('returns null when both are null', () => {
    expect(workerIndexOf({ workerIndex: null, parallelIndex: null })).toBe(null);
  });
});

describe('createLimiter', () => {
  it('runs tasks with at most maxConcurrent in flight', async () => {
    let active = 0;
    let maxActive = 0;
    const limiter = createLimiter(2);
    const track = async (ms: number) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, ms));
      active--;
    };
    await Promise.all(Array.from({ length: 6 }, () => limiter(() => track(10))));
    expect(maxActive, `maxActive was ${maxActive}`).toBeLessThanOrEqual(2);
    expect(maxActive, `maxActive was ${maxActive}`).toBeGreaterThanOrEqual(2);
  });

  it('coerces maxConcurrent < 1 to 1', async () => {
    const limiter = createLimiter(0);
    let count = 0;
    await Promise.all(Array.from({ length: 3 }, () => limiter(async () => { count++; })));
    expect(count).toBe(3);
  });

  it('preserves return values and propagates rejections', async () => {
    const limiter = createLimiter(3);
    const ok = await limiter(async () => 7);
    expect(ok).toBe(7);
    await expect(limiter(async () => { throw new Error('boom'); })).rejects.toThrow(/boom/);
  });
});
