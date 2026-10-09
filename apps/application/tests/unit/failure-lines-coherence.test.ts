import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Client } from '@libsql/client';
import { pickMostLikely, nextStepSourceLine, type MostLikely } from '#shared/most-likely';
import type { NextStep } from '#shared/next-step';
import type { ClusterState } from '#shared/cluster-state';
import type { FailureClueStrength } from '#shared/failure-clues';
import type { FailureCluesResult } from '#shared/handlers/test-cases';
import type { DrizzleDB } from '#shared/handlers/db';

/**
 * The failure pages' lines, checked against each other over a freshly generated
 * demo seed. Every failure cluster and every problem execution goes through the
 * shared handlers the REST endpoints and the demo serve (`getFailureCluster`,
 * `getTestRunCase`, `getFailureClues`), with and without an AI provider, and
 * each page's Most likely and Next source line are built the way the pages build
 * them (`pickMostLikely`, `nextStepSourceLine`).
 *
 * Each rule reads kinds and sources, not sentences, so a reworded seed keeps
 * passing. A failure names the page and prints its lines. The last test names
 * the seeded rows each rule must reach, so the file cannot pass without
 * checking anything.
 */

/** The statuses whose execution page shows Most likely and Next. */
const PROBLEM_STATUSES = ['failed', 'timedOut', 'timedout', 'didnotrun'];

/** Cluster-level steps: the cluster page and its latest occurrence's page must agree on them. */
const CLUSTER_LEVEL_STEPS: ReadonlySet<NextStep['kind']> = new Set([
  'mark-resolved',
  'replace-locator',
  'apply-patch',
  'follow-diagnosis',
  'see-what-changed',
]);

/** The fallback wording that denies what Most likely shows. */
const NOTHING_KNOWN = /nothing (deterministic|conclusive)/i;

interface DiagnosisFacts {
  summary: string;
  confidence: string | null;
  provider: string | null;
}

/** One page's lines, as the page shows them. */
interface PageLines {
  /** "cluster #10" or "execution #37", with the variant it was built under. */
  label: string;
  page: 'cluster' | 'execution';
  id: number;
  aiConfigured: boolean;
  fixVerification: string | null;
  /** The cluster page's latest occurrence, whose clues it shows. */
  latestExecutionId: number | null;
  diagnosis: DiagnosisFacts | null;
  /** Most likely as shown, and the strength of the story or clue it shows. */
  mostLikely: MostLikely | null;
  strength: FailureClueStrength | null;
  next: NextStep | null;
  sourceLine: string | null;
  /** The cluster page's State line. */
  state: ClusterState | null;
  /** The execution page's situation lines, joined. */
  situation: string | null;
}

/** What a rule found: the pages its premise matched, and the ones that broke it. */
interface RuleResult {
  checked: string[];
  violations: string[];
}

const rootDir = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
let outDir: string;
let client: Client;
const pages: PageLines[] = [];
/** Pages built after the seed's cluster diagnoses were changed, see `buildVariants`. */
let variants: PageLines[] = [];

function completedDiagnosis(
  d: { status?: string | null; summary?: string | null; confidence?: string | null; provider?: string | null } | null,
): DiagnosisFacts | null {
  return d && d.status === 'completed' && d.summary
    ? { summary: d.summary, confidence: d.confidence ?? null, provider: d.provider ?? null }
    : null;
}

/** The strength behind a story or clue Most likely; null for the diagnosis. */
function shownStrength(mostLikely: MostLikely | null, clues: FailureCluesResult | null): FailureClueStrength | null {
  if (mostLikely?.source === 'story') return clues?.story?.strength ?? null;
  if (mostLikely?.source === 'clue') return clues?.clues[0]?.strength ?? null;
  return null;
}

function describePage(p: PageLines): string {
  const lines = [p.label];
  if (p.mostLikely) {
    lines.push(`  Most likely [${p.mostLikely.source}, ${p.mostLikely.grade ?? '-'}] ${p.mostLikely.sentence}`);
  }
  if (p.state) lines.push(`  State [${p.state.kind}, action ${p.state.action ?? 'none'}] ${p.state.sentence}`);
  if (p.situation) lines.push(`  Situation ${p.situation}`);
  if (p.next) {
    const actions = [p.next.primary, ...p.next.secondary].map((a) => a.action).join(', ');
    lines.push(
      `  Next [${p.next.kind}, source ${p.next.source ?? 'none'}] ${p.next.title}. ${p.next.why} (${actions})`,
    );
  }
  if (p.sourceLine) lines.push(`  Source ${p.sourceLine}`);
  return lines.join('\n');
}

async function loadSeed(): Promise<{ db: DrizzleDB; now: Date }> {
  // The schema barrel picks PostgreSQL at import time when PIWI_DATABASE_URL is set.
  delete process.env.PIWI_DATABASE_URL;
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const schema = await import('~~/server/database/schema.sqlite');

  // Regenerate into a directory of this file's own, never the tracked
  // public/demo/seed.sql, which other seed tests regenerate concurrently.
  outDir = mkdtempSync(join(tmpdir(), 'piwi-failure-lines-'));
  execFileSync('node', ['scripts/generate-demo-seed.mjs'], {
    cwd: rootDir,
    stdio: 'ignore',
    env: { ...process.env, PIWI_DEMO_SEED_OUTPUT_DIR: outDir },
  });
  client = createClient({ url: `file:${join(outDir, 'piwi.db')}` });
  await client.executeMultiple(readFileSync(join(outDir, 'seed.sql'), 'utf8'));
  return { db: drizzle(client, { schema }) as unknown as DrizzleDB, now: new Date() };
}

async function ids(sql: string): Promise<number[]> {
  return (await client.execute(sql)).rows.map((r) => Number(r.id));
}

async function pageBuilders(db: DrizzleDB, now: Date) {
  const { getTestRunCase, getFailureClues } = await import('#shared/handlers/test-cases');
  const { getFailureCluster } = await import('#shared/handlers/failure-clusters');

  const cluesById = new Map<number, FailureCluesResult>();
  const cluesFor = async (id: number) => {
    if (!cluesById.has(id)) cluesById.set(id, await getFailureClues(db, id));
    return cluesById.get(id)!;
  };

  // The cluster page shows the clues of its latest occurrence and the cluster's
  // completed diagnosis.
  async function clusterPage(id: number, aiConfigured: boolean, label: string): Promise<PageLines> {
    const cluster = await getFailureCluster(db, id, { aiConfigured, now });
    if (!cluster) throw new Error(`cluster #${id} not found`);
    const latest = cluster.latestTestRunsCaseId ?? null;
    const clues = latest != null ? await cluesFor(latest) : null;
    const diagnosis = completedDiagnosis(cluster.diagnosis);
    const mostLikely = pickMostLikely({ story: clues?.story, clues: clues?.clues, diagnosis });
    return {
      label,
      page: 'cluster',
      id,
      aiConfigured,
      fixVerification: cluster.fixVerification ?? null,
      latestExecutionId: latest,
      diagnosis,
      mostLikely,
      strength: shownStrength(mostLikely, clues),
      next: cluster.nextStep,
      sourceLine: nextStepSourceLine(cluster.nextStep, { mostLikely, diagnosis, scope: 'cluster' }),
      state: cluster.clusterState,
      situation: null,
    };
  }

  // The execution page shows Most likely only beside a verdict, and Next only on
  // a problem execution; its source line reads Most likely as computed.
  async function executionPage(id: number, aiConfigured: boolean, label: string): Promise<PageLines> {
    const execution = await getTestRunCase(db, id, null, { aiConfigured, now });
    if (!execution) throw new Error(`execution #${id} not found`);
    const clues = await cluesFor(id);
    const diagnosis = completedDiagnosis(execution.failureCluster?.diagnosis ?? null);
    const computed = pickMostLikely({ story: clues.story, clues: clues.clues, diagnosis });
    const mostLikely = execution.verdict ? computed : null;
    const isProblem = PROBLEM_STATUSES.includes(execution.status);
    return {
      label,
      page: 'execution',
      id,
      aiConfigured,
      fixVerification: execution.failureCluster?.fixVerification ?? null,
      latestExecutionId: null,
      diagnosis,
      mostLikely,
      strength: shownStrength(mostLikely, clues),
      next: isProblem ? execution.nextStep : null,
      sourceLine: isProblem
        ? nextStepSourceLine(execution.nextStep, { mostLikely: computed, diagnosis, scope: 'execution' })
        : null,
      state: null,
      situation: execution.situation?.text ?? null,
    };
  }

  return { clusterPage, executionPage };
}

/**
 * Every diagnosis-verified cluster again, with its diagnosed patch recorded as
 * still applying at the fix's commit, and its latest occurrence's page: the
 * fix is then unconfirmed and the patch leads.
 */
async function buildVariants(builders: Awaited<ReturnType<typeof pageBuilders>>): Promise<PageLines[]> {
  const rows = (
    await client.execute(
      `SELECT c.id, c.fix_landed_run_id AS runId, c.fix_commit AS fixCommit
         FROM failure_clusters c
         JOIN failure_diagnoses d ON d.cluster_id = c.id AND d.scope = 'cluster'
        WHERE c.fix_verification = 'diagnosis-verified' AND c.fix_landed_run_id IS NOT NULL
          AND d.status = 'completed' AND json_extract(d.details, '$.suggestedFix.patch') IS NOT NULL
        ORDER BY c.id`,
    )
  ).rows;
  const out: PageLines[] = [];
  for (const row of rows) {
    const clusterId = Number(row.id);
    const atFix = { status: 'applies', inCode: false, runId: Number(row.runId), commit: String(row.fixCommit ?? '') };
    await client.execute({
      sql: `UPDATE failure_diagnoses SET details = json_set(details, '$.patchValidationAtFix', json(?))
             WHERE cluster_id = ? AND scope = 'cluster'`,
      args: [JSON.stringify(atFix), clusterId],
    });
    const cluster = await builders.clusterPage(clusterId, true, `cluster #${clusterId}, patch applying at its fix`);
    out.push(cluster);
    if (cluster.latestExecutionId != null) {
      const id = cluster.latestExecutionId;
      out.push(await builders.executionPage(id, true, `execution #${id}, patch applying at its fix`));
    }
  }
  return out;
}

beforeAll(async () => {
  const { db, now } = await loadSeed();
  const builders = await pageBuilders(db, now);
  const clusterIds = await ids('SELECT id FROM failure_clusters ORDER BY id');
  const statuses = PROBLEM_STATUSES.map((s) => `'${s}'`).join(', ');
  // Every problem execution, and every cluster's latest occurrence whatever its status.
  const executionIds = await ids(
    `SELECT id FROM test_runs_cases WHERE status IN (${statuses})
     UNION
     SELECT max(e.id) AS id FROM failure_clusters c
       JOIN test_runs_cases e ON e.failure_cluster_id = c.id AND e.test_run_id = c.last_seen_run_id
      GROUP BY c.id
     ORDER BY id`,
  );

  for (const aiConfigured of [true, false]) {
    const suffix = aiConfigured ? '' : ' (no AI provider)';
    for (const id of clusterIds) pages.push(await builders.clusterPage(id, aiConfigured, `cluster #${id}${suffix}`));
    for (const id of executionIds) {
      pages.push(await builders.executionPage(id, aiConfigured, `execution #${id}${suffix}`));
    }
  }
  variants = await buildVariants(builders);
}, 180_000);

afterAll(() => {
  client?.close();
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

const all = () => [...pages, ...variants];

/** The execution page of a cluster page's latest occurrence, built under the same variant. */
function latestOccurrencePage(cluster: PageLines): PageLines | undefined {
  const variantOf = variants.includes(cluster) ? variants : pages;
  return variantOf.find(
    (p) => p.page === 'execution' && p.id === cluster.latestExecutionId && p.aiConfigured === cluster.aiConfigured,
  );
}

// ── The rules ────────────────────────────────────────────────────────────────

/**
 * A verified fix reads the same in State and Next: a State that offers Mark
 * resolved for a fix sits beside a Next that marks it resolved, and a Next that
 * applies the diagnosed patch to a verified fix sits beside an unconfirmed fix
 * with no Mark resolved of its own.
 */
function verifiedFixRule(): RuleResult {
  const result: RuleResult = { checked: [], violations: [] };
  for (const p of all()) {
    if (p.page !== 'cluster' || !p.state || !p.next) continue;
    const offersResolve = ['fix-verified-open', 'stopped-failing-open', 'ticket-done'].includes(p.state.kind);
    const patchOnVerifiedFix = p.fixVerification === 'diagnosis-verified' && p.next.kind === 'apply-patch';
    if (!offersResolve && !patchOnVerifiedFix) continue;
    result.checked.push(p.label);
    const broken = offersResolve
      ? p.state.action === 'mark-resolved' && p.next.kind !== 'mark-resolved'
      : p.state.kind !== 'fix-unconfirmed' || p.state.action === 'mark-resolved';
    if (broken) result.violations.push(describePage(p));
  }
  return result;
}

/** A Next from the diagnosis, beside a Most likely that is not that diagnosis, quotes its summary. */
function diagnosisSourceRule(): RuleResult {
  const result: RuleResult = { checked: [], violations: [] };
  for (const p of all()) {
    if (p.next?.source !== 'diagnosis' || p.mostLikely?.source === 'diagnosis' || !p.diagnosis) continue;
    result.checked.push(p.label);
    if (!p.sourceLine?.includes(p.diagnosis.summary.trim())) result.violations.push(describePage(p));
  }
  return result;
}

/** A cluster page and its latest occurrence's page lead with the same Most likely. */
function sameMostLikelyRule(): RuleResult {
  const result: RuleResult = { checked: [], violations: [] };
  for (const p of all()) {
    if (p.page !== 'cluster' || p.latestExecutionId == null) continue;
    const execution = latestOccurrencePage(p);
    if (!execution) continue;
    result.checked.push(p.label);
    const same =
      p.mostLikely?.source === execution.mostLikely?.source &&
      p.mostLikely?.sentence === execution.mostLikely?.sentence;
    if (!same) result.violations.push(`${describePage(p)}\n${describePage(execution)}`);
  }
  return result;
}

/** No Next says nothing explains the failure beside a strong or medium story or clue. */
function noDenialRule(): RuleResult {
  const result: RuleResult = { checked: [], violations: [] };
  for (const p of all()) {
    if (!p.next || (p.strength !== 'strong' && p.strength !== 'medium')) continue;
    result.checked.push(p.label);
    if ([p.next.title, p.next.why, p.sourceLine ?? ''].some((text) => NOTHING_KNOWN.test(text))) {
      result.violations.push(describePage(p));
    }
  }
  return result;
}

/** Ownership is an assignee or an owner, never "unassigned". */
function noUnassignedRule(): RuleResult {
  const result: RuleResult = { checked: [], violations: [] };
  for (const p of all()) {
    const sentence = p.page === 'cluster' ? p.state?.sentence : p.situation;
    if (!sentence) continue;
    result.checked.push(p.label);
    if (/unassigned/i.test(sentence)) result.violations.push(describePage(p));
  }
  return result;
}

/** A cluster-level Next is the same step on the cluster's latest occurrence's page. */
function sameClusterStepRule(): RuleResult {
  const result: RuleResult = { checked: [], violations: [] };
  for (const p of all()) {
    if (p.page !== 'cluster' || !p.next || !CLUSTER_LEVEL_STEPS.has(p.next.kind)) continue;
    const execution = latestOccurrencePage(p);
    if (!execution) continue;
    result.checked.push(p.label);
    if (execution.next?.kind !== p.next.kind) result.violations.push(`${describePage(p)}\n${describePage(execution)}`);
  }
  return result;
}

describe('failure page lines over the demo seed', () => {
  test('a verified fix reads the same in State and Next', () => {
    expect(verifiedFixRule().violations).toEqual([]);
  });

  test('a Next from the diagnosis quotes it when Most likely shows something else', () => {
    expect(diagnosisSourceRule().violations).toEqual([]);
  });

  test("a cluster and its latest occurrence's execution lead with the same Most likely", () => {
    expect(sameMostLikelyRule().violations).toEqual([]);
  });

  test('no Next says nothing explains the failure beside a strong or medium Most likely', () => {
    expect(noDenialRule().violations).toEqual([]);
  });

  test('no Situation or State sentence says "unassigned"', () => {
    expect(noUnassignedRule().violations).toEqual([]);
  });

  test("a cluster-level Next is the same step on its latest occurrence's execution", () => {
    expect(sameClusterStepRule().violations).toEqual([]);
  });

  test('every rule reaches the seeded pages it is about', () => {
    const reached = (rule: () => RuleResult) => rule().checked;
    // Cluster #10's fix was verified: State and Next both mark it resolved, and
    // with its patch applying at the fix, both lead with the patch.
    expect(reached(verifiedFixRule)).toEqual(
      expect.arrayContaining(['cluster #10', 'cluster #10, patch applying at its fix']),
    );
    // #37 and cluster #1 lead with the quote story while Next applies the diagnosed patch.
    expect(reached(diagnosisSourceRule)).toEqual(expect.arrayContaining(['execution #37', 'cluster #1']));
    expect(reached(sameMostLikelyRule)).toEqual(expect.arrayContaining(['cluster #1', 'cluster #10']));
    expect(reached(noDenialRule)).toEqual(expect.arrayContaining(['execution #37', 'execution #37 (no AI provider)']));
    expect(reached(noUnassignedRule)).toEqual(expect.arrayContaining(['cluster #1', 'execution #37']));
    // Apply the patch, replace the locator, mark resolved.
    expect(reached(sameClusterStepRule)).toEqual(
      expect.arrayContaining(['cluster #1', 'cluster #2', 'cluster #10', 'cluster #10, patch applying at its fix']),
    );
  });
});
