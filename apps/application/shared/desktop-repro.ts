/**
 * Repro requests: Piwi Picker asks the desktop app to run a bug report's steps
 * with Playwright, or an editor asks it to reproduce a failure at its commit,
 * bisect it, or run a flaky test's Flake Lab experiment (a job,
 * `@piwitests/core/desktop-job`). A request carries steps, commits, test
 * locations and lab conditions, never code or command-line flags; the app keeps
 * it until the developer confirms it in the window, builds the run itself, and
 * reports the verdict back on the same request.
 */
import { z } from 'zod';
import { parseSteps, type PiwiSteps } from '@piwitests/core/steps';
import type { SpecRunVerdict } from '@piwitests/core/bug-report';
import {
  type DesktopJobKind,
  type DesktopJobVerdict,
  type FlakeLabJobArm,
  type FlakeLabJobPlan,
} from '@piwitests/core/desktop-job';
import { parseFlakePlan, type FlakeCondition } from '@piwitests/core/flake-plan';

/** How long a request waits for the developer, and how long its verdict stays readable. */
export const REPRO_REQUEST_TTL_MS = 10 * 60_000;

export const REPRO_REQUEST_STATUSES = ['waiting', 'running', 'done', 'declined', 'expired'] as const;
export type ReproRequestStatus = (typeof REPRO_REQUEST_STATUSES)[number];

/** What a request asks: run a bug report's steps, or one of the editor's jobs. */
export type ReproRequestKind = 'steps' | DesktopJobKind;

const playwrightProjectSchema = z
  .string()
  .trim()
  .regex(/^[\w .:@/+-]{1,100}$/, 'A Playwright project name');

const instanceUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((u) => /^https?:\/\/[^\s]+$/.test(u), 'An http(s) URL');

export const reproOptionsSchema = z.object({
  headed: z.boolean().default(false),
  trace: z.boolean().default(false),
  /** A Playwright project name from the config. */
  project: playwrightProjectSchema.nullish(),
  repeatEach: z.number().int().min(1).max(20).default(1),
});
export type ReproOptions = z.infer<typeof reproOptionsSchema>;

const reproBodySchema = z.object({
  steps: z.unknown(),
  options: reproOptionsSchema.default({ headed: false, trace: false, repeatEach: 1 }),
  title: z.string().trim().max(200).nullish(),
  /** The report on the instance it came from, for the verdict to be shared there. */
  bugReportId: z.number().int().positive().nullish(),
  instanceUrl: instanceUrlSchema.nullish(),
});

const SHA = /^[0-9a-f]{7,40}$/i;
const shaSchema = z.string().trim().regex(SHA, 'A commit SHA (7 to 40 hex characters)');

/** Whether a spec path is relative to the Playwright config's directory: never a flag, never outside it. */
function isRelativeSpecPath(p: string): boolean {
  return !/^[-/\\]/.test(p) && !/^[a-z]:/i.test(p) && !p.split(/[\\/]/).includes('..') && !p.includes('\0');
}

const specPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isRelativeSpecPath, 'A spec path relative to the Playwright config');

const jobTestSchema = z.object({
  filePath: specPathSchema,
  title: z.string().trim().max(500).default(''),
  line: z.number().int().positive().nullish(),
  projectName: playwrightProjectSchema.nullish(),
});

/**
 * An arm's conditions, read by the plan parser the reporter applies them with;
 * the other test of an `alongside` or `after` condition and a pinned project
 * reach Playwright's command line, so they follow the job's path and project rules.
 */
const labConditionsSchema = z
  .array(z.unknown())
  .max(20)
  .transform((conditions, ctx): FlakeCondition[] => {
    let parsed: FlakeCondition[];
    try {
      parsed = parseFlakePlan({
        version: 1,
        experimentId: 'job',
        test: { file: 'job', title: 'job' },
        arm: { id: 'job', conditions },
      }).arm.conditions;
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message });
      return z.NEVER;
    }
    for (const condition of parsed) {
      const bad =
        ((condition.kind === 'alongside' || condition.kind === 'after') && !isRelativeSpecPath(condition.test.file)) ||
        (condition.kind === 'project' && !playwrightProjectSchema.safeParse(condition.name).success);
      if (bad) ctx.addIssue({ code: 'custom', message: `A ${condition.kind} condition outside the job's rules` });
    }
    return parsed;
  });

/** An arm id as the instance names it: `control`, `suspect-<rank>`, `combined`. */
const ARM_ID = /^[a-z][\w-]{0,63}$/;

const labArmSchema = z.object({
  id: z.string().regex(ARM_ID, 'An arm id'),
  label: z.string().trim().max(512),
  suspectId: z.string().max(512).nullable(),
  rank: z.number().int().min(1).max(50).nullable(),
  conditions: labConditionsSchema,
  runs: z.number().int().min(1).max(100),
  stopAt: z.number().int().min(1).max(100).nullable(),
});

const count = z.number().int().min(0).max(1_000_000);

/** A reproduce plan of the instance's flake-plan endpoint, kept to the fields `piwi flake --plan` runs. */
const labPlanSchema = z.object({
  version: z.literal(1),
  experimentId: z
    .string()
    .regex(/^\d{1,20}$/, 'An experiment id')
    .nullable(),
  kind: z.literal('reproduce'),
  projectId: z.number().int().positive(),
  testCaseId: z.number().int().positive(),
  test: z.object({
    file: specPathSchema,
    title: z.string().trim().min(1).max(500),
    suite: z.array(z.string().max(500)).max(20).default([]),
    project: playwrightProjectSchema.nullable(),
  }),
  displayTitle: z.string().trim().max(1000),
  windowDays: count,
  failures: count,
  passes: count,
  failureCommit: shaSchema.nullable(),
  medianDurationMs: z.number().min(0).max(86_400_000).nullable(),
  errorSignatures: z.array(z.string().max(2000)).max(20),
  control: labArmSchema.refine((a) => a.id === 'control' && a.conditions.length === 0, 'The control arm'),
  arms: z.array(labArmSchema).max(50),
  combined: labArmSchema.nullable(),
});

const labJobBodySchema = z.object({
  kind: z.literal('flake-lab'),
  commit: shaSchema,
  plan: labPlanSchema,
  title: z.string().trim().max(200).nullish(),
  instanceUrl: instanceUrlSchema,
  clusterId: z.number().int().positive().nullish(),
});

const jobBodySchema = z
  .object({
    kind: z.enum(['reproduce', 'bisect']),
    commit: shaSchema,
    good: shaSchema.nullish(),
    tests: z.array(jobTestSchema).min(1).max(50),
    browser: z
      .string()
      .trim()
      .regex(/^[a-z][\w-]{0,30}$/i, 'A browser name')
      .nullish(),
    title: z.string().trim().max(200).nullish(),
    instanceUrl: instanceUrlSchema,
    clusterId: z.number().int().positive().nullish(),
  })
  .refine((b) => b.kind !== 'bisect' || !!b.good, { message: 'A bisect needs the good commit', path: ['good'] });

/** An editor's job, as the window runs it. */
export interface DesktopJob {
  commit: string;
  /** The good end of a bisect; null to reproduce. */
  good: string | null;
  /** The failing tests; for a Flake Lab job, the test its plan experiments on. */
  tests: Array<{ filePath: string; title: string; line: number | null; projectName: string | null }>;
  browser: string | null;
  /** The failure cluster on the instance the job came from. */
  clusterId: number | null;
  /** The experiment a Flake Lab job runs; null for the other jobs. */
  plan: FlakeLabJobPlan | null;
}

export type ReproRequestInput =
  | {
      kind: 'steps';
      steps: PiwiSteps;
      options: ReproOptions;
      title: string | null;
      bugReportId: number | null;
      instanceUrl: string | null;
    }
  | { kind: DesktopJobKind; job: DesktopJob; title: string | null; instanceUrl: string };

export type ParseReproRequestResult =
  | { ok: true; request: ReproRequestInput }
  | { ok: false; statusCode: 400 | 415; message: string; errors?: string[] };

function invalid(issues: z.ZodError['issues']): ParseReproRequestResult {
  return {
    ok: false,
    statusCode: 400,
    message: 'Invalid repro request',
    errors: issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
  };
}

type LabArmInput = z.infer<typeof labArmSchema>;

function labArm(arm: LabArmInput): FlakeLabJobArm {
  return {
    id: arm.id,
    label: arm.label,
    suspectId: arm.suspectId,
    rank: arm.rank,
    conditions: arm.conditions,
    runs: arm.runs,
    stopAt: arm.stopAt,
  };
}

/** The plan as the lab's plan file holds it: the parsed fields, the commit lower-cased, no suspects to print. */
function labJobPlan(plan: z.infer<typeof labPlanSchema>): FlakeLabJobPlan {
  return {
    version: 1,
    experimentId: plan.experimentId,
    kind: 'reproduce',
    projectId: plan.projectId,
    testCaseId: plan.testCaseId,
    test: { ...plan.test, file: plan.test.file.replace(/\\/g, '/') },
    displayTitle: plan.displayTitle,
    windowDays: plan.windowDays,
    failures: plan.failures,
    passes: plan.passes,
    failureCommit: plan.failureCommit?.toLowerCase() ?? null,
    medianDurationMs: plan.medianDurationMs,
    errorSignatures: plan.errorSignatures,
    suspects: [],
    control: labArm(plan.control),
    arms: plan.arms.map(labArm),
    combined: plan.combined ? labArm(plan.combined) : null,
    verifies: null,
  };
}

/**
 * A repro request's body, when it is JSON (a page cannot send JSON to another
 * origin without a preflight the server never answers) and holds either a
 * steps document `parseSteps` accepts or an editor's job (`kind` `reproduce`,
 * `bisect` or `flake-lab`).
 */
export function parseReproRequest(contentType: string | undefined, body: unknown): ParseReproRequestResult {
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json') {
    return { ok: false, statusCode: 415, message: 'A repro request is a JSON body (Content-Type: application/json)' };
  }
  const kind = body && typeof body === 'object' ? (body as { kind?: unknown }).kind : undefined;
  if (kind === 'flake-lab') {
    const job = labJobBodySchema.safeParse(body);
    if (!job.success) return invalid(job.error.issues);
    const { commit, plan, title, instanceUrl, clusterId } = job.data;
    return {
      ok: true,
      request: {
        kind: 'flake-lab',
        job: {
          commit: commit.toLowerCase(),
          good: null,
          tests: [
            {
              filePath: plan.test.file.replace(/\\/g, '/'),
              title: plan.displayTitle || plan.test.title,
              line: null,
              projectName: plan.test.project,
            },
          ],
          browser: null,
          clusterId: clusterId ?? null,
          plan: labJobPlan(plan),
        },
        title: title ?? null,
        instanceUrl: instanceUrl.replace(/\/+$/, ''),
      },
    };
  }
  if (kind !== undefined && kind !== 'steps') {
    const job = jobBodySchema.safeParse(body);
    if (!job.success) return invalid(job.error.issues);
    const { kind: jobKind, commit, good, tests, browser, title, instanceUrl, clusterId } = job.data;
    return {
      ok: true,
      request: {
        kind: jobKind,
        job: {
          commit: commit.toLowerCase(),
          good: jobKind === 'bisect' ? good!.toLowerCase() : null,
          tests: tests.map((t) => ({
            filePath: t.filePath.replace(/\\/g, '/'),
            title: t.title,
            line: t.line ?? null,
            projectName: t.projectName ?? null,
          })),
          browser: browser ?? null,
          clusterId: clusterId ?? null,
          plan: null,
        },
        title: title ?? null,
        instanceUrl: instanceUrl.replace(/\/+$/, ''),
      },
    };
  }
  const parsed = reproBodySchema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error.issues);
  const steps = parseSteps(parsed.data.steps);
  if (!steps.ok) return { ok: false, statusCode: 400, message: 'Invalid steps', errors: steps.errors };
  return {
    ok: true,
    request: {
      kind: 'steps',
      steps: steps.steps,
      options: parsed.data.options,
      title: parsed.data.title ?? steps.steps.title ?? null,
      bugReportId: parsed.data.bugReportId ?? null,
      instanceUrl: parsed.data.instanceUrl ?? null,
    },
  };
}

/** The `playwright test` flags a request's options stand for, each with its value joined by `=`. */
export function reproArgs(options: ReproOptions): string[] {
  const args: string[] = [];
  if (options.headed) args.push('--headed');
  if (options.trace) args.push('--trace=on');
  if (options.project) args.push(`--project=${options.project}`);
  if (options.repeatEach > 1) args.push(`--repeat-each=${options.repeatEach}`);
  return args;
}

/** What the window, Piwi Picker and the editor read about a request. */
export interface ReproRequestView {
  id: string;
  kind: ReproRequestKind;
  title: string | null;
  /** The steps to run (kind `steps`); null for a job. */
  steps: PiwiSteps | null;
  options: ReproOptions;
  /** The editor's job (kind `reproduce`, `bisect` or `flake-lab`); null for steps. */
  job: DesktopJob | null;
  bugReportId: number | null;
  instanceUrl: string | null;
  status: ReproRequestStatus;
  createdAt: string;
  expiresAt: string;
  /** The linked project the developer ran it in. */
  projectId: number | null;
  verdict: SpecRunVerdict | null;
  /** How a job ended, once done. */
  jobVerdict: DesktopJobVerdict | null;
  /** The Piwi run the reporter recorded, when the window matched one. */
  runId: number | null;
}

const bisectCommitSchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{7,40}$/),
  subject: z.string().max(500),
  author: z.string().max(500).nullable(),
  date: z.string().max(100).nullable(),
});

const labReportSchema = z.object({
  verdict: z.enum(['reproduced', 'amplified', 'not-reproduced']),
  reproducingArm: z.string().regex(ARM_ID).nullable(),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .nullable(),
  arms: z
    .array(
      z.object({
        id: z.string().regex(ARM_ID),
        runs: count,
        matchingFailures: count,
        otherFailures: count,
        discardedRounds: count,
        stoppedEarly: z.boolean(),
      }),
    )
    .min(1)
    .max(52),
});

export const reproRequestPatchSchema = z.object({
  status: z.enum(['running', 'done', 'declined']),
  projectId: z.number().int().positive().nullish(),
  verdict: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('reproduced'), step: z.number().int().min(0), found: z.string().max(500).nullable() }),
      z.object({ kind: z.literal('not-reproduced') }),
      z.object({ kind: z.literal('diverged'), step: z.number().int().min(0), reason: z.string().max(500) }),
      z.object({ kind: z.literal('completed') }),
      z.object({ kind: z.literal('stopped') }),
    ])
    .nullish(),
  jobVerdict: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('reproduced') }),
      z.object({ kind: z.literal('not-reproduced') }),
      z.object({ kind: z.literal('first-bad'), commit: bisectCommitSchema }),
      z.object({ kind: z.literal('lab'), report: labReportSchema }),
      z.object({ kind: z.literal('error'), reason: z.string().max(500) }),
      z.object({ kind: z.literal('stopped') }),
    ])
    .nullish(),
  runId: z.number().int().positive().nullish(),
});
export type ReproRequestPatch = z.infer<typeof reproRequestPatchSchema>;

/**
 * Lines appended to a repro spec: after the test, write how it ended to the
 * file the desktop app names in `PIWI_REPRO_RESULT` (the status, the spec line
 * the first error points at, the message). The app reads the verdict from it.
 * Under `--repeat-each` or retries, a repetition that did not pass is kept over
 * a later one that did: the bug showed.
 */
export const REPRO_RESULT_HOOK = `
// Written by Piwi for this run only: records how the test ended for the desktop app.
import { readFileSync as piwiReadResult, writeFileSync as piwiWriteResult } from 'node:fs';
test.afterEach(async ({}, testInfo) => {
  const out = process.env.PIWI_REPRO_RESULT;
  if (!out) return;
  if (testInfo.status === 'passed') {
    try {
      if (JSON.parse(piwiReadResult(out, 'utf8')).status !== 'passed') return;
    } catch {}
  }
  const frames = testInfo.errors.flatMap((e) => (e.stack ?? '').split('\\n'));
  const frame = frames.find((l) => l.includes(testInfo.file));
  const line = frame ? Number(/:(\\d+):\\d+\\)?\\s*$/.exec(frame)?.[1]) : NaN;
  const message = testInfo.errors[0]?.message ?? null;
  piwiWriteResult(out, JSON.stringify({ status: testInfo.status, line: Number.isFinite(line) ? line : null, message }));
});
`;

/** A rendered spec with the result hook after it; the steps keep their lines. */
export function withReproResultHook(code: string): string {
  return `${code.trimEnd()}\n${REPRO_RESULT_HOOK}`;
}
