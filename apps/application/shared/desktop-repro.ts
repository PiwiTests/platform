/**
 * Repro requests: Piwi Picker asks the desktop app to run a bug report's steps
 * with Playwright. The request carries steps and run options, never code; the
 * app keeps it until the developer confirms it in the window, renders the spec
 * itself, and reports the verdict back on the same request.
 */
import { z } from 'zod';
import { parseSteps, type PiwiSteps } from '@piwitests/core/steps';
import type { SpecRunVerdict } from '@piwitests/core/bug-report';

/** How long a request waits for the developer, and how long its verdict stays readable. */
export const REPRO_REQUEST_TTL_MS = 10 * 60_000;

export const REPRO_REQUEST_STATUSES = ['waiting', 'running', 'done', 'declined', 'expired'] as const;
export type ReproRequestStatus = (typeof REPRO_REQUEST_STATUSES)[number];

export const reproOptionsSchema = z.object({
  headed: z.boolean().default(false),
  trace: z.boolean().default(false),
  /** A Playwright project name from the config. */
  project: z
    .string()
    .trim()
    .regex(/^[\w .:@/+-]{1,100}$/, 'A Playwright project name')
    .nullish(),
  repeatEach: z.number().int().min(1).max(20).default(1),
});
export type ReproOptions = z.infer<typeof reproOptionsSchema>;

const reproBodySchema = z.object({
  steps: z.unknown(),
  options: reproOptionsSchema.default({ headed: false, trace: false, repeatEach: 1 }),
  title: z.string().trim().max(200).nullish(),
  /** The report on the instance it came from, for the verdict to be shared there. */
  bugReportId: z.number().int().positive().nullish(),
  instanceUrl: z
    .string()
    .trim()
    .max(300)
    .refine((u) => /^https?:\/\/[^\s]+$/.test(u), 'An http(s) URL')
    .nullish(),
});

export interface ReproRequestInput {
  steps: PiwiSteps;
  options: ReproOptions;
  title: string | null;
  bugReportId: number | null;
  instanceUrl: string | null;
}

export type ParseReproRequestResult =
  | { ok: true; request: ReproRequestInput }
  | { ok: false; statusCode: 400 | 415; message: string; errors?: string[] };

/**
 * A repro request's body, when it is JSON (a page cannot send JSON to another
 * origin without a preflight the server never answers) and holds a steps
 * document `parseSteps` accepts.
 */
export function parseReproRequest(contentType: string | undefined, body: unknown): ParseReproRequestResult {
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/json') {
    return { ok: false, statusCode: 415, message: 'A repro request is a JSON body (Content-Type: application/json)' };
  }
  const parsed = reproBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      statusCode: 400,
      message: 'Invalid repro request',
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
    };
  }
  const steps = parseSteps(parsed.data.steps);
  if (!steps.ok) return { ok: false, statusCode: 400, message: 'Invalid steps', errors: steps.errors };
  return {
    ok: true,
    request: {
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

/** What the window and Piwi Picker read about a request. */
export interface ReproRequestView {
  id: string;
  title: string | null;
  steps: PiwiSteps;
  options: ReproOptions;
  bugReportId: number | null;
  instanceUrl: string | null;
  status: ReproRequestStatus;
  createdAt: string;
  expiresAt: string;
  /** The linked project the developer ran it in. */
  projectId: number | null;
  verdict: SpecRunVerdict | null;
  /** The Piwi run the reporter recorded, when the window matched one. */
  runId: number | null;
}

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
