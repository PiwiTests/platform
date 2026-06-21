import { describe, it as itRaw, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  hashForProject,
  getSetupFilePath,
  computeInstanceId,
  detectCiRunLabel,
  readSourceSnippet,
  createLimiter,
  readSetupInfo,
  workerIndexOf,
} from '../src/helpers.js';

// CI env tests mutate process.env and must run serially.
const it = itRaw;

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
    assert.equal(h.length, 16);
    assert.equal(hashForProject('my-project'), h);
    assert.notEqual(hashForProject('other-project'), h);
  });
});

describe('getSetupFilePath', () => {
  it('lives in os.tmpdir() and embeds the project hash', () => {
    const p = getSetupFilePath('my-project');
    assert.equal(path.dirname(p), os.tmpdir());
    const base = path.basename(p);
    assert.ok(base.startsWith('piwi-dashboard-setup-'), base);
    assert.ok(base.includes(hashForProject('my-project')));
    assert.ok(base.endsWith('.json'));
  });
});

describe('computeInstanceId', () => {
  it('derives from hostname|projectName when no runLabel', () => {
    const a = computeInstanceId('proj-a', null);
    const b = computeInstanceId('proj-b', null);
    assert.equal(a.length, 16);
    assert.notEqual(a, b);
    // deterministic
    assert.equal(computeInstanceId('proj-a', null), a);
  });

  it('derives from projectName|runLabel when runLabel is set', () => {
    const sharded = computeInstanceId('proj-a', 'run-1');
    const unsharded = computeInstanceId('proj-a', null);
    assert.notEqual(sharded, unsharded);
    // same label + project → same instanceId (all shards share it)
    assert.equal(computeInstanceId('proj-a', 'run-1'), sharded);
  });
});

describe('detectCiRunLabel', { concurrency: 1 }, () => {
  beforeEach(() => {
    saveEnv();
    clearCiEnv();
  });
  afterEach(() => restoreEnv());

  it('returns null outside CI', () => {
    assert.equal(detectCiRunLabel(), null);
  });

  it('detects GitHub Actions', () => {
    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_RUN_ID = 'gh-123';
    assert.equal(detectCiRunLabel(), 'gh-123');
  });

  it('detects GitLab CI', () => {
    process.env.GITLAB_CI = 'true';
    process.env.CI_PIPELINE_ID = 'gl-456';
    assert.equal(detectCiRunLabel(), 'gl-456');
  });

  it('detects CircleCI', () => {
    process.env.CIRCLECI = 'true';
    process.env.CIRCLE_WORKFLOW_ID = 'cc-789';
    assert.equal(detectCiRunLabel(), 'cc-789');
  });

  it('detects Travis', () => {
    process.env.TRAVIS = 'true';
    process.env.TRAVIS_BUILD_ID = 'tv-1';
    assert.equal(detectCiRunLabel(), 'tv-1');
  });

  it('detects Azure Pipelines (TF_BUILD)', () => {
    process.env.TF_BUILD = 'true';
    process.env.BUILD_BUILDID = 'az-1';
    assert.equal(detectCiRunLabel(), 'az-1');
  });

  it('detects Jenkins', () => {
    process.env.JENKINS_URL = 'https://jenkins.example.com';
    process.env.BUILD_ID = 'jk-1';
    assert.equal(detectCiRunLabel(), 'jk-1');
  });

  it('detects Buildkite / TeamCity / Bitbucket / Semaphore / AppVeyor / Drone', () => {
    process.env.BUILDKITE_BUILD_ID = 'bk-1';
    assert.equal(detectCiRunLabel(), 'bk-1');
    clearCiEnv();

    process.env.TEAMCITY_BUILD_ID = 'tc-1';
    assert.equal(detectCiRunLabel(), 'tc-1');
    clearCiEnv();

    process.env.BITBUCKET_BUILD_NUMBER = 'bb-1';
    assert.equal(detectCiRunLabel(), 'bb-1');
    clearCiEnv();

    process.env.SEMAPHORE_WORKFLOW_ID = 'sm-1';
    assert.equal(detectCiRunLabel(), 'sm-1');
    clearCiEnv();

    process.env.APPVEYOR_BUILD_ID = 'ap-1';
    assert.equal(detectCiRunLabel(), 'ap-1');
    clearCiEnv();

    process.env.DRONE_BUILD_NUMBER = 'dr-1';
    assert.equal(detectCiRunLabel(), 'dr-1');
  });
});

describe('readSourceSnippet', () => {
  it('returns null when the file does not exist', () => {
    assert.equal(readSourceSnippet('/nonexistent/file.ts', 5, 3), null);
  });

  it('returns a formatted snippet with a marker on the target line', () => {
    const tmp = path.join(os.tmpdir(), `piwi-snippet-${Date.now()}.ts`);
    fs.writeFileSync(tmp, ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n'), 'utf8');
    try {
      const snippet = readSourceSnippet(tmp, 3, 1);
      assert.ok(snippet);
      const lines = snippet!.split('\n');
      // context=1 → start=max(0, 3-1-1)=1, end=min(5, 3+1)=4 → lines[1..3]
      assert.equal(lines.length, 3);
      assert.ok(lines.some((l) => l.startsWith('> ') && l.includes('3 | line3')));
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('clamps start to 0 for early lines', () => {
    const tmp = path.join(os.tmpdir(), `piwi-snippet-${Date.now()}.ts`);
    fs.writeFileSync(tmp, ['a', 'b', 'c'].join('\n'), 'utf8');
    try {
      const snippet = readSourceSnippet(tmp, 1, 30);
      assert.ok(snippet);
      assert.ok(snippet!.includes('> '));
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

describe('readSetupInfo', () => {
  it('returns null when no setup file exists', () => {
    assert.equal(readSetupInfo('definitely-no-such-project-' + Date.now()), null);
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
      assert.deepEqual(info, { runId: 42, setupToken: 'tok', projectName });
      // second read returns null (file consumed)
      assert.equal(readSetupInfo(projectName), null);
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
      assert.equal(readSetupInfo(projectName), null);
    } finally {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });
});

describe('workerIndexOf', () => {
  it('returns workerIndex when present', () => {
    assert.equal(workerIndexOf({ workerIndex: 3, parallelIndex: 1 }), 3);
  });

  it('falls back to parallelIndex when workerIndex is absent', () => {
    assert.equal(workerIndexOf({ parallelIndex: 1 }), 1);
  });

  it('returns null when neither is set', () => {
    assert.equal(workerIndexOf({}), null);
    assert.equal(workerIndexOf(null), null);
    assert.equal(workerIndexOf(undefined), null);
  });

  it('returns null when both are null', () => {
    assert.equal(workerIndexOf({ workerIndex: null, parallelIndex: null }), null);
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
    assert.ok(maxActive <= 2, `maxActive was ${maxActive}`);
    assert.ok(maxActive >= 2, `maxActive was ${maxActive}`);
  });

  it('coerces maxConcurrent < 1 to 1', async () => {
    const limiter = createLimiter(0);
    let count = 0;
    await Promise.all(Array.from({ length: 3 }, () => limiter(async () => { count++; })));
    assert.equal(count, 3);
  });

  it('preserves return values and propagates rejections', async () => {
    const limiter = createLimiter(3);
    const ok = await limiter(async () => 7);
    assert.equal(ok, 7);
    await assert.rejects(limiter(async () => { throw new Error('boom'); }), /boom/);
  });
});
