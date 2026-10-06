/**
 * A fix attempt: a change a person or an agent reports having made to fix a
 * failure cluster (a patch, a locator edit, a fix plan carried out), tied to a
 * commit or a branch. It is the `fix-attempt` hand-back: reported `applied`,
 * then `verified` when the cluster's fix lands with it, or `regressed` when the
 * cluster fails again after that.
 *
 * Pure: the body parser, the attempt key and the stored details, shared by the
 * REST route, the MCP tool, the demo and fix verification.
 */
import { z } from 'zod';
import { REST_REPORT_CHANNELS, suggestionHash } from '#shared/handback-outcomes';

export const FIX_ATTEMPT_KINDS = ['patch', 'locator-edit', 'fix-plan'] as const;
export type FixAttemptKind = (typeof FIX_ATTEMPT_KINDS)[number];

/** How a verified attempt was tied to the fix that landed. */
export type FixAttemptLink = 'trailer' | 'commit' | 'branch';

/** The locator or line an attempt changed. */
export interface FixAttemptEdit {
  filePath: string;
  line?: number | null;
  from?: string | null;
  to?: string | null;
}

/** What a `fix-attempt` outcome row's details carry. */
export interface FixAttemptDetails {
  attemptKind: FixAttemptKind;
  /** Short hash of the patch applied, as reported or computed from the patch. */
  patchHash: string | null;
  edit: FixAttemptEdit | null;
  commit: string | null;
  branch: string | null;
  /** The diagnosis the attempt followed, when one did. */
  diagnosisId: number | null;
  note: string | null;
  /** On `verified`: how the attempt was tied to the fix. */
  link?: FixAttemptLink;
}

const sha = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,40}$/i, 'must be 7 to 40 hex characters');

/** The body `report_fix_attempt` and `POST /api/failure-clusters/:id/fix-attempts` take. */
export const reportFixAttemptSchema = z
  .object({
    kind: z.enum(FIX_ATTEMPT_KINDS),
    patch: z.string().max(200_000).optional(),
    patchHash: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{6,64}$/i, 'must be 6 to 64 hex characters')
      .optional(),
    edit: z
      .object({
        filePath: z.string().trim().min(1).max(500),
        line: z.number().int().positive().nullable().optional(),
        from: z.string().max(2000).nullable().optional(),
        to: z.string().max(2000).nullable().optional(),
      })
      .optional(),
    commit: sha.optional(),
    branch: z.string().trim().min(1).max(255).optional(),
    diagnosisId: z.number().int().positive().optional(),
    note: z.string().trim().max(1000).optional(),
    channel: z.enum(REST_REPORT_CHANNELS).optional(),
  })
  .refine((b) => b.commit || b.branch, { message: 'pass the commit or the branch the change is on', path: ['commit'] })
  .refine((b) => b.kind !== 'locator-edit' || b.edit, { message: 'a locator edit needs the edit', path: ['edit'] });

export type ReportFixAttemptBody = z.infer<typeof reportFixAttemptSchema>;

/** Parse a report body, or say what is wrong with it. */
export function parseFixAttempt(
  raw: unknown,
): { ok: true; value: ReportFixAttemptBody } | { ok: false; message: string } {
  const parsed = reportFixAttemptSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    message: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
  };
}

/** The stored details of a reported attempt. A patch given whole is kept as its hash. */
export function fixAttemptDetails(body: ReportFixAttemptBody): FixAttemptDetails {
  return {
    attemptKind: body.kind,
    patchHash:
      body.patchHash?.toLowerCase() ?? (body.patch ? suggestionHash([body.patch.replace(/\r\n?/g, '\n')]) : null),
    edit: body.edit
      ? {
          filePath: body.edit.filePath,
          line: body.edit.line ?? null,
          from: body.edit.from ?? null,
          to: body.edit.to ?? null,
        }
      : null,
    commit: body.commit?.toLowerCase() ?? null,
    branch: body.branch ?? null,
    diagnosisId: body.diagnosisId ?? null,
    note: body.note || null,
  };
}

/** The suggestion key of an attempt: the same change reported twice is one attempt. */
export function fixAttemptKey(details: FixAttemptDetails): string {
  const edit = details.edit ? [details.edit.filePath, details.edit.line, details.edit.to] : [];
  return `attempt:${suggestionHash([details.attemptKind, details.patchHash, ...edit, details.commit, details.branch])}`;
}

/** Whether two commit references name the same commit (a short SHA matches its full form). */
export function sameCommit(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.length <= y.length ? y.startsWith(x) : x.startsWith(y);
}

/** How the dashboard says what an attempt changed, in a few words. */
export function describeFixAttempt(
  details: Pick<FixAttemptDetails, 'attemptKind' | 'edit' | 'commit' | 'branch'>,
): string {
  const what =
    details.attemptKind === 'locator-edit'
      ? `a locator edit${details.edit ? ` in ${details.edit.filePath}` : ''}`
      : details.attemptKind === 'patch'
        ? 'a patch'
        : 'the fix plan';
  const where = details.commit ? ` at ${details.commit.slice(0, 7)}` : details.branch ? ` on ${details.branch}` : '';
  return `${what}${where}`;
}
