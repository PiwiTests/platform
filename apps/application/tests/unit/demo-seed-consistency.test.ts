import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeErrorFingerprint } from '#shared/error-fingerprint';
import { resolveHealingForCase } from '~~/server/utils/locator-healing';
import { validatePatch } from '#shared/patch';
import { allDemoSourceFiles } from '~~/app/demo/demo-scm';
import { FAILURE_STORIES, SCM_REPOS, SIMULATOR_ERRORS, storyForCase } from '#shared/demo/failure-stories.mjs';
import { parseAriaCandidates } from '#shared/locator-fingerprint';
import { computeDemoFingerprint } from '#shared/demo/demo-fingerprint.mjs';

// Root of the Nuxt app (tests/unit/ -> ../..).
const rootDir = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

interface Row {
  [key: string]: unknown;
}

let db: import('sql.js').Database;

function q(sql: string): Row[] {
  const res = db.exec(sql);
  if (!res.length) return [];
  const { columns, values } = res[0]!;
  return values.map((row) => Object.fromEntries(row.map((v, i) => [columns[i]!, v])));
}

// Regenerate into a throwaway directory unique to this test file, never the
// tracked public/demo/seed.sql — another test file's beforeAll regenerates
// concurrently (vitest runs files in parallel) and would otherwise race on
// the same path, producing a torn read and a SQL parse error.
function regenerate(outDir: string): string {
  execFileSync('node', ['scripts/generate-demo-seed.mjs'], {
    cwd: rootDir,
    stdio: 'ignore',
    env: { ...process.env, PIWI_DEMO_SEED_OUTPUT_DIR: outDir },
  });
  return readFileSync(join(outDir, 'seed.sql'), 'utf-8');
}

const tmpDirs: string[] = [];
function tempOutDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'piwi-demo-seed-consistency-'));
  tmpDirs.push(dir);
  return dir;
}

beforeAll(async () => {
  const seedSql = regenerate(tempOutDir());

  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  db = new SQL.Database();
  db.run(seedSql);
});

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe('demo seed generation is deterministic', () => {
  test('regenerating without source changes produces the same content hash', () => {
    const before = regenerate(tempOutDir());
    const after = regenerate(tempOutDir());
    // Compare content only, excluding the timestamp comment line (see the
    // generator's own hash-stability comment).
    const strip = (s: string) =>
      s
        .split('\n')
        .filter((l) => !l.startsWith('-- Generated at:'))
        .join('\n');
    expect(strip(after)).toBe(strip(before));
  });
});

describe('fingerprint mirror parity (demo mirror vs the real algorithm)', () => {
  const corpus = [
    ...FAILURE_STORIES.flatMap((s) => s.failingCases.map((fc) => fc.error)),
    // Adversarial cases beyond the seeded stories.
    '[31mError: expect(locator).toBeVisible() failed[39m',
    "TimeoutError: locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole('row', { name: 'Acme' }).getByRole('button', { name: 'Delete' })\n    at tests/x.spec.ts:1:1",
    'Error: expect(received).toBe(expected)\n\nExpected: 200\nReceived: 500\n    at tests/x.spec.ts:2:2',
    'Error: page.click: Target page, context or browser has been closed',
    "Error: strict mode violation: getByRole('button') resolved to 2 elements",
    'Some completely unstructured error with no recognizable shape at all',
  ];

  for (const [i, err] of corpus.entries()) {
    test(`corpus[${i}] matches real computeErrorFingerprint`, async () => {
      const [mine, real] = await Promise.all([computeDemoFingerprint(err), computeErrorFingerprint(err)]);
      expect(mine.fingerprint, 'fingerprint').toBe(real.fingerprint);
      expect(mine.errorType, 'errorType').toBe(real.errorType);
      expect(mine.signature, 'signature').toBe(real.signature);
    });
  }
});

describe('cluster ↔ case ↔ file coherence', () => {
  test('every failing execution error matches its story, and its case is really in that file', () => {
    const rows = q(`
      select trc.error, trc.line, trc.column, trc.failure_cluster_id, tc.file_path, tc.title
      from test_runs_cases trc
      join test_cases tc on tc.id = trc.test_case_id
      where trc.failure_cluster_id is not null
    `);
    expect(rows.length).toBeGreaterThan(0);

    const storyByCluster = new Map(FAILURE_STORIES.map((s) => [s.clusterId, s]));
    for (const r of rows) {
      const story = storyByCluster.get(r.failure_cluster_id as number)!;
      expect(story, `cluster ${r.failure_cluster_id} has a story`).toBeTruthy();
      expect(r.file_path, `case file for cluster ${r.failure_cluster_id}`).toBe(story.specFile);

      const failingCase = story.failingCases.find((fc) => fc.title === r.title);
      expect(failingCase, `story ${story.key} declares case "${r.title}"`).toBeTruthy();
      expect(r.error, `error text for "${r.title}"`).toBe(failingCase!.error);
      expect(r.line, `declared line for "${r.title}"`).not.toBeNull();

      // The error's final stack frame must reference the same file the case lives in.
      const frames = [...(r.error as string).matchAll(/at (\S+):(\d+):(\d+)/g)];
      const last = frames[frames.length - 1];
      expect(last?.[1], `last frame file for "${r.title}"`).toBe(story.specFile);
    }
  });

  test('cluster fingerprint matches the real recomputation of its sample_error', async () => {
    const rows = q('select id, fingerprint, sample_error from failure_clusters');
    expect(rows.length).toBe(FAILURE_STORIES.length);
    for (const r of rows) {
      const real = await computeErrorFingerprint(r.sample_error as string);
      expect(real.fingerprint, `cluster ${r.id}`).toBe(r.fingerprint);
    }
  });

  test('cluster occurrences and first/last run ids are internally consistent', () => {
    const clusters = q('select id, occurrences, first_seen_run_id, last_seen_run_id from failure_clusters');
    for (const c of clusters) {
      const trcCount = q(`select count(*) as n from test_runs_cases where failure_cluster_id = ${c.id as number}`)[0]!
        .n as number;
      expect(trcCount, `cluster ${c.id} occurrences`).toBe(c.occurrences);
      expect(c.first_seen_run_id, `cluster ${c.id} first_seen_run_id`).not.toBeNull();
      expect(c.last_seen_run_id, `cluster ${c.id} last_seen_run_id`).not.toBeNull();
    }
  });

  // A fix is only ever recorded from a run that came back green, so a landing
  // run the cluster failed in is a contradiction the UI would faithfully show.
  test('a recorded fix landed in a run where the cluster did not fail', () => {
    const fixed = q(`
      select id, fix_landed_run_id, fix_verification, time_to_resolution_ms
      from failure_clusters where fix_verification is not null`);
    expect(fixed.length, 'demo should carry recorded fixes').toBeGreaterThan(0);

    for (const c of fixed) {
      expect(c.fix_landed_run_id, `cluster ${c.id} fix_landed_run_id`).not.toBeNull();
      expect(c.time_to_resolution_ms, `cluster ${c.id} time_to_resolution_ms`).toBeGreaterThan(0);

      const failedInLandingRun = q(`
        select count(*) as n from test_runs_cases
        where failure_cluster_id = ${c.id as number} and test_run_id = ${c.fix_landed_run_id as number}`)[0]!
        .n as number;
      expect(failedInLandingRun, `cluster ${c.id} failed in the run its fix supposedly landed in`).toBe(0);
    }
  });

  // Run ids descend as time advances in the seed, so "later" means a lower id.
  test('only a regressed cluster fails after its fix landed', () => {
    const fixed = q(`
      select id, fix_landed_run_id, fix_verification from failure_clusters where fix_verification is not null`);
    const verdicts = new Set(fixed.map((c) => c.fix_verification));
    // All three verdicts read very differently; the demo is only useful if it
    // shows what each one looks like.
    expect(verdicts).toEqual(new Set(['regressed', 'stopped-failing', 'diagnosis-verified']));

    for (const c of fixed) {
      const failuresAfter = q(`
        select count(*) as n from test_runs_cases
        where failure_cluster_id = ${c.id as number} and test_run_id < ${c.fix_landed_run_id as number}`)[0]!
        .n as number;
      if (c.fix_verification === 'regressed') {
        expect(failuresAfter, `regressed cluster ${c.id} should fail again after the fix`).toBeGreaterThan(0);
      } else {
        expect(failuresAfter, `cluster ${c.id} kept failing after a fix that supposedly held`).toBe(0);
      }
    }
  });
});

describe('captured-source format fidelity', () => {
  test('test_source has the failing-line marker with the correct gutter, and frames are well-formed', () => {
    const rows = q(`
      select id, test_source, test_source_frames, line
      from test_runs_cases
      where status = 'failed' and test_source is not null
    `);
    expect(rows.length).toBeGreaterThan(0);

    for (const r of rows) {
      const src = r.test_source as string;
      const lines = src.split('\n');
      // At least one line carries the '> ' failing-line marker with a
      // right-aligned 4-wide line-number gutter, e.g. "> NNNN | code".
      expect(
        lines.some((l) => /^> {1,4}\d+ \| /.test(l)),
        `trc ${r.id} has a > marker`,
      ).toBe(true);

      if (r.test_source_frames) {
        const frames = JSON.parse(r.test_source_frames as string) as Array<{
          file: string;
          line: number;
          snippet: string;
        }>;
        expect(frames.length, `trc ${r.id} frame count`).toBeLessThanOrEqual(4);
        expect(frames.length, `trc ${r.id} has frames`).toBeGreaterThan(0);
        for (const f of frames) {
          expect(
            f.snippet.split('\n').some((l) => /^> {1,4}\d+ \| /.test(l)),
            `trc ${r.id} frame ${f.file}`,
          ).toBe(true);
        }
      }
    }
  });

  test('every failing execution error ends in an "at file:line:col" frame (column always present)', () => {
    const rows = q(`select id, error from test_runs_cases where status = 'failed'`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const frames = [...(r.error as string).matchAll(/at (\S+):(\d+):(\d+)/g)];
      expect(frames.length, `trc ${r.id} has at least one frame`).toBeGreaterThan(0);
    }
  });
});

describe('suggested-fix patches and SCM references', () => {
  test('every story patch applies cleanly against the demo-scm source files', () => {
    const files = allDemoSourceFiles();
    for (const story of FAILURE_STORIES) {
      const result = validatePatch(story.diagnosis.fix.patch, files);
      expect(['applies', 'applies-with-offset'], `${story.key}: ${result.errors.join('; ')}`).toContain(result.status);
    }
  });

  test('every story suspect commit exists in its project SCM history', () => {
    for (const story of FAILURE_STORIES) {
      const repo = SCM_REPOS[story.projectId as keyof typeof SCM_REPOS];
      expect(
        repo.commits.some((c) => c.sha === story.suspectSha),
        `${story.key} suspect commit`,
      ).toBe(true);
    }
  });

  test('every run metadata.scm.commit exists in that project SCM history', () => {
    const rows = q('select id, project_id, metadata from test_runs');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const meta = JSON.parse(r.metadata as string) as { scm?: { commit?: string } };
      const repo = SCM_REPOS[r.project_id as keyof typeof SCM_REPOS];
      expect(
        repo.commits.some((c) => c.sha === meta.scm?.commit),
        `run ${r.id} scm commit`,
      ).toBe(true);
    }
  });

  test('every seeded diagnosis autoSelectedCommits SHA exists in that cluster project SCM history', () => {
    const clusters = q('select id, project_id from failure_clusters');
    const diagnoses = q('select cluster_id, details from failure_diagnoses');
    for (const d of diagnoses) {
      const cluster = clusters.find((r) => r.id === d.cluster_id)!;
      const details = JSON.parse(d.details as string) as { autoSelectedCommits: string[] };
      const repo = SCM_REPOS[cluster.project_id as keyof typeof SCM_REPOS];
      for (const sha of details.autoSelectedCommits) {
        expect(
          repo.commits.some((c) => c.sha === sha),
          `diagnosis for cluster ${d.cluster_id} sha ${sha}`,
        ).toBe(true);
      }
    }
  });
});

describe('evidence rules', () => {
  test('no console log entry echoes the first line of the case error', () => {
    const rows = q(`
      select id, error, console_logs from test_runs_cases
      where status = 'failed' and console_logs is not null
    `);
    for (const r of rows) {
      const logs = JSON.parse(r.console_logs as string) as Array<{ text: string }>;
      const firstLine = (r.error as string).split('\n')[0];
      expect(
        logs.some((l) => l.text === firstLine),
        `trc ${r.id} console log echoes the error`,
      ).toBe(false);
    }
  });

  test('the API project (2) has no web_vitals/page_state on any execution', () => {
    const rows = q(`
      select trc.id, trc.web_vitals, trc.page_state
      from test_runs_cases trc join test_cases tc on tc.id = trc.test_case_id
      where tc.project_id = 2 and trc.status != 'didnotrun'
    `);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.web_vitals, `trc ${r.id} web_vitals`).toBeNull();
      expect(r.page_state, `trc ${r.id} page_state`).toBeNull();
    }
  });

  test('every executed test_runs_cases row has a browser_name', () => {
    const rows = q(`select count(*) as n from test_runs_cases where browser_name is null`);
    expect(rows[0]!.n).toBe(0);
  });

  test('server logs only appear on requests the story actually declares as failing', () => {
    const rows = q(`
      select nr.id, nr.test_runs_case_id, nr.method, nr.url, nr.server_logs, trc.failure_cluster_id
      from network_requests nr join test_runs_cases trc on trc.id = nr.test_runs_case_id
      where nr.server_logs is not null
    `);
    const storyByCluster = new Map(FAILURE_STORIES.map((s) => [s.clusterId, s]));
    for (const r of rows) {
      const story = r.failure_cluster_id ? storyByCluster.get(r.failure_cluster_id as number) : null;
      const declared = story?.evidence.failingNetwork ?? [];
      expect(
        declared.some((d) => d.method === r.method && d.url === r.url),
        `network request ${r.method} ${r.url} (trc ${r.test_runs_case_id}) has server_logs but isn't a declared failing request`,
      ).toBe(true);
    }
  });
});

describe('media wiring', () => {
  test('every demo/** files row references a file that exists on disk', () => {
    const rows = q(`select id, path from files where path like 'demo/%'`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const abs = `${rootDir}/public/${r.path as string}`;
      expect(existsSync(abs), `files #${r.id}: ${r.path}`).toBe(true);
      expect(statSync(abs).size, `files #${r.id}: ${r.path} is non-empty`).toBeGreaterThan(0);
    }
  });

  test('trace/video/screenshot attachments are wired to the most recent failing execution of their case', () => {
    const attachments = q(`
      select f.id, f.type, f.test_runs_case_id, trc.test_case_id, trc.failure_cluster_id
      from files f join test_runs_cases trc on trc.id = f.test_runs_case_id
      where f.path like 'demo/traces/%' or f.path like 'demo/videos/%'
    `);
    expect(attachments.length).toBeGreaterThan(0);
    for (const a of attachments) {
      const maxId = q(
        `select max(id) as m from test_runs_cases where test_case_id = ${a.test_case_id as number} and failure_cluster_id = ${a.failure_cluster_id as number}`,
      )[0]!.m as number;
      expect(a.test_runs_case_id, `files #${a.id} (${a.type})`).toBe(maxId);
    }
  });

  test('the visual diff overlay references a baseline that is a real passing execution', () => {
    const rows = q(`select id, metadata from files where type = 'visual-diff'`);
    expect(rows.length).toBe(1);
    const meta = JSON.parse(rows[0]!.metadata as string) as {
      baselineTestRunsCaseId: number;
      baselineRunId: number;
    };
    const baseline = q(
      `select id, test_run_id, status from test_runs_cases where id = ${meta.baselineTestRunsCaseId}`,
    )[0];
    expect(baseline, 'baseline execution exists').toBeTruthy();
    expect(baseline!.status).toBe('passed');
    expect(baseline!.test_run_id).toBe(meta.baselineRunId);
  });
});

describe('cluster 6 (strict-mode) coherence', () => {
  test('the locator snapshot, its recommended alternative, and the ARIA snapshot all agree on the element name', () => {
    const story = FAILURE_STORIES.find((s) => s.clusterId === 6)!;
    const snapshotRows = q(`
      select element_attrs, alternatives from locator_snapshots
      where location = '${story.captureLocation}'
    `);
    expect(snapshotRows.length).toBe(1);
    const attrs = JSON.parse(snapshotRows[0]!.element_attrs as string) as { accessibleName: string };
    const alternatives = JSON.parse(snapshotRows[0]!.alternatives as string) as Array<{ locator: string }>;

    expect(story.aria).toContain(attrs.accessibleName);
    expect(alternatives.some((a) => a.locator.includes(attrs.accessibleName))).toBe(true);
    expect(story.diagnosis.fix.patch).toContain(attrs.accessibleName);
  });
});

describe('authored DOM snapshots (served as trace-extracted)', () => {
  const authored = FAILURE_STORIES.filter((s) => s.domSnapshot);

  test('the locator-centric stories carry an authored failure-time page', () => {
    expect(authored.map((s) => s.clusterId).sort((a, b) => a - b)).toEqual([1, 2, 6, 9]);
    for (const story of authored) {
      expect(story.domSnapshot.viewport.width).toBeGreaterThan(0);
      expect(story.domSnapshot.viewport.height).toBeGreaterThan(0);
      expect(story.domSnapshot.html).toContain('<!DOCTYPE html>');
    }
  });

  test('every named ARIA candidate appears in the authored page', () => {
    for (const story of authored) {
      const candidates = parseAriaCandidates(story.aria);
      expect(candidates.length).toBeGreaterThan(0);
      for (const c of candidates) {
        // Row names are concatenated cell texts — the cells appear, the
        // concatenation does not.
        if (!c.name || c.role === 'row') continue;
        expect(story.domSnapshot.html, `cluster ${story.clusterId}: ${c.role} "${c.name}"`).toContain(c.name);
      }
    }
  });

  test('cluster 9 keeps the hidden Export CSV button in the DOM but out of the ARIA tree', () => {
    const story = FAILURE_STORIES.find((s) => s.clusterId === 9)!;
    expect(story.domSnapshot.html).toContain('class="export-btn" hidden');
    expect(story.domSnapshot.html).toContain('Export CSV');
    expect(story.aria).not.toContain('Export CSV');
  });

  test('storyForCase resolves each authored story from its failing case identity', () => {
    for (const story of authored) {
      for (const fc of story.failingCases) {
        expect(storyForCase(story.projectId, story.specFile, fc.title)).toBe(story);
      }
    }
    expect(storyForCase(999, 'tests/nowhere.spec.ts', 'no such test')).toBeNull();
  });
});

describe('cluster 9 (assertion-captured healing) coherence', () => {
  test('the expect()-captured snapshot sits at the failing call site; the resolved-but-hidden failure is not healed', async () => {
    const story = FAILURE_STORIES.find((s) => s.clusterId === 9)!;
    const rows = q(`
      select * from locator_snapshots
      where location = '${story.captureLocation}'
    `);
    expect(rows.length).toBe(1);
    const raw = rows[0]!;

    // The seeded row is keyed at the expect() call site — the same line the
    // failing case's innermost stack frame points at.
    const failing = story.failingCases[0]!;
    expect(story.captureLocation).toBe(`${story.specFile}:${failing.failingLine}:${failing.column}`);

    const row = {
      id: raw.id,
      testCaseId: raw.test_case_id,
      location: raw.location,
      usedMethod: raw.used_method,
      usedArgs: raw.used_args,
      usedArgsFp: raw.used_args_fp,
      elementTag: raw.element_tag,
      elementAttrs: raw.element_attrs,
      elementText: raw.element_text,
      alternatives: raw.alternatives,
      lastSeenRunId: raw.last_seen_run_id,
      lastSeenAt: null,
    } as unknown as import('~~/server/database/schema').LocatorSnapshotRow;

    // The stored row describes the element the failing assertion targets.
    expect(row.usedMethod).toBe('getByRole');
    const alternatives = JSON.parse(row.alternatives) as Array<{ locator: string }>;
    expect(alternatives.some((a) => a.locator === "locator('.export-btn')")).toBe(true);

    // The call log says the locator resolved (to a hidden button) — the CSS is
    // the bug, not the selector — so the healing gate declines to suggest a
    // replacement even though a snapshot sits at the exact call site.
    const healing = await resolveHealingForCase({ error: failing.error, ariaSnapshot: story.aria }, [row], null);
    expect(healing.applicable).toBe(false);
    expect(healing.reason).toBe('The locator resolved; this is not a locator problem.');
    expect(healing.recommendation).toBeNull();
    expect(healing.failingLocator?.method).toBe('getByRole');
  });
});

describe('step timing survives the load-time rebase', () => {
  interface StepRow {
    id: number;
    started_at: number;
    duration: number;
    steps: string;
  }

  // Executed cases only: a didnotrun case has duration 0 and no real span, so
  // its illustrative steps have no window to sit inside.
  function executedCasesWithSteps(): StepRow[] {
    return q(`
      select id, started_at, duration, steps from test_runs_cases
      where status != 'didnotrun' and duration > 0
        and steps is not null and json_valid(steps) and json_array_length(steps) > 0
    `) as unknown as StepRow[];
  }

  // The rebase shifts started_at and the JSON step timestamps together. If it
  // ever shifts one without the other, every step's absolute startTime lands
  // ~months away from its execution window and the Perfetto export (which
  // clamps each step into that window) collapses them all to the left edge.
  test('every executed step starts within its execution window', () => {
    const rows = executedCasesWithSteps();
    expect(rows.length).toBeGreaterThan(0);

    for (const r of rows) {
      const start = Number(r.started_at);
      const end = start + Number(r.duration);
      const steps = (JSON.parse(r.steps) as Array<{ startTime?: number }>).filter(
        (s) => typeof s.startTime === 'number',
      );
      for (const s of steps) {
        const t = s.startTime!;
        // A generous rounding slack still catches a months-scale desync.
        expect(t, `trc ${r.id}: step startTime before window`).toBeGreaterThanOrEqual(start - 1000);
        expect(t, `trc ${r.id}: step startTime past window`).toBeLessThanOrEqual(end + 1000);
      }
    }
  });

  test('steps spread across the window instead of collapsing to the start', () => {
    const rows = executedCasesWithSteps();
    // The largest step offset, as a fraction of its case duration, across all
    // multi-step executed cases. In the collapsed-to-left failure mode every
    // offset is 0; a healthy seed lays steps end-to-end across the span.
    let maxFraction = 0;
    for (const r of rows) {
      const start = Number(r.started_at);
      const duration = Number(r.duration);
      const steps = (JSON.parse(r.steps) as Array<{ startTime?: number }>).filter(
        (s) => typeof s.startTime === 'number',
      );
      if (steps.length < 2) continue;
      for (const s of steps) maxFraction = Math.max(maxFraction, (s.startTime! - start) / duration);
    }
    expect(maxFraction).toBeGreaterThan(0.5);
  });
});

describe('simulator ↔ seed fingerprint parity', () => {
  test('the simulator error strings are identity-equal to the story fixtures they claim to reuse', () => {
    const c1 = FAILURE_STORIES.find((s) => s.clusterId === 1)!;
    const c2 = FAILURE_STORIES.find((s) => s.clusterId === 2)!;
    expect(SIMULATOR_ERRORS.checkoutPayTimeout).toBe(c1.failingCases[0]!.error);
    expect(SIMULATOR_ERRORS.checkoutPayTimeoutPaypal).toBe(c1.failingCases[1]!.error);
    expect(SIMULATOR_ERRORS.emailLabelRenamed).toBe(c2.failingCases[0]!.error);
  });

  test("the simulator's known errors fingerprint identically to their seeded clusters", async () => {
    const cluster1 = q(`select fingerprint from failure_clusters where id = 1`)[0]!.fingerprint as string;
    const cluster2 = q(`select fingerprint from failure_clusters where id = 2`)[0]!.fingerprint as string;

    const timeoutFp = await computeErrorFingerprint(SIMULATOR_ERRORS.checkoutPayTimeout);
    expect(timeoutFp.fingerprint).toBe(cluster1);

    const paypalFp = await computeErrorFingerprint(SIMULATOR_ERRORS.checkoutPayTimeoutPaypal);
    expect(paypalFp.fingerprint).toBe(cluster1);

    const renamedFp = await computeErrorFingerprint(SIMULATOR_ERRORS.emailLabelRenamed);
    expect(renamedFp.fingerprint).toBe(cluster2);
  });
});
