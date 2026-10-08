/**
 * A diagnosis an agent writes: the same JSON a model returns to Piwi
 * (`DIAGNOSIS_JSON_SCHEMA`), recorded by the agent with the model it ran on.
 * The stored row carries the provider `agent`, so every surface can say who
 * wrote it.
 *
 * Pure: the body parser and the labels, shared by the REST route, the MCP tool,
 * the demo and the dashboard.
 */
import { z } from 'zod';
import {
  DIAGNOSIS_CATEGORIES,
  DIAGNOSIS_SEVERITIES,
  parseDiagnosisJson,
  type AiDiagnosisResult,
} from '#shared/ai-diagnosis';
import { REST_REPORT_CHANNELS, type RestReportChannel } from '#shared/handback-outcomes';

/** The `provider` stored on a diagnosis an agent recorded. */
export const AGENT_DIAGNOSIS_PROVIDER = 'agent';

/** Whether a stored diagnosis was written by an agent. */
export function isAgentDiagnosis(provider: string | null | undefined): boolean {
  return provider === AGENT_DIAGNOSIS_PROVIDER;
}

/** How a diagnosis names its author: the model, prefixed when an agent wrote it. */
export function diagnosisAuthorLabel(provider: string | null | undefined, model: string | null | undefined): string {
  if (isAgentDiagnosis(provider)) return model ? `Written by an agent (${model})` : 'Written by an agent';
  return model || 'unknown model';
}

const text = (max: number) => z.string().max(max);
const nullableText = (max: number) => text(max).nullable();

/** `DIAGNOSIS_JSON_SCHEMA` as a validator, so an agent gets told which field is wrong. */
export const agentDiagnosisSchema = z
  .object({
    summary: text(300).min(1),
    confidenceScore: z.number().int().min(0).max(100),
    severity: z.enum(DIAGNOSIS_SEVERITIES),
    affectedArea: nullableText(200),
    hypotheses: z
      .array(
        z
          .object({
            category: z.enum(DIAGNOSIS_CATEGORIES),
            rootCause: text(2000).min(1),
            likelihood: z.number().int().min(0).max(100),
            evidence: z.array(text(1000)).max(8),
          })
          .strict(),
      )
      .min(1)
      .max(5),
    suggestedFix: z
      .object({
        description: text(4000),
        file: nullableText(500),
        code: nullableText(20_000),
        patch: nullableText(200_000),
      })
      .strict(),
    investigationSteps: z.array(text(1000)).max(8),
    preventionTips: z.array(text(1000)).max(8),
  })
  .strict();

/**
 * The body `record_diagnosis`, `POST /api/failure-clusters/:id/agent-diagnosis` and
 * `POST /api/test-run-cases/:id/agent-diagnosis` take.
 */
export const recordAgentDiagnosisSchema = z.object({
  model: text(200).trim().min(1),
  diagnosis: agentDiagnosisSchema,
  channel: z.enum(REST_REPORT_CHANNELS).optional(),
});

/** What an agent's diagnosis is about: a failure cluster, or one failing execution (a failure). */
export type AgentDiagnosisTarget =
  | { scope: 'cluster'; clusterId: number }
  | { scope: 'execution'; executionId: number };

export interface AgentDiagnosisInput {
  model: string;
  diagnosis: AiDiagnosisResult;
  /** The surface a REST report came from; MCP records `mcp`. */
  channel?: RestReportChannel;
}

/**
 * Validate a recorded diagnosis and normalize it the way a model's answer is
 * (category, confidence and root cause derived from the top hypothesis).
 * Returns the problems, one per field, when it does not validate.
 */
export function parseAgentDiagnosis(
  raw: unknown,
): { ok: true; value: AgentDiagnosisInput } | { ok: false; message: string } {
  const parsed = recordAgentDiagnosisSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    };
  }
  return {
    ok: true,
    value: {
      model: parsed.data.model,
      diagnosis: parseDiagnosisJson(JSON.stringify(parsed.data.diagnosis)),
      channel: parsed.data.channel,
    },
  };
}

/** Why recording an agent's diagnosis was refused. */
export type AgentDiagnosisError = 'not-found' | 'declined' | 'running' | 'not-failed';

/** The message a refusal of recording an agent's diagnosis carries, worded for what the diagnosis is about. */
export function agentDiagnosisErrorMessage(error: AgentDiagnosisError, scope: AgentDiagnosisTarget['scope']): string {
  switch (error) {
    case 'not-found':
      return scope === 'cluster' ? 'Failure cluster not found' : 'Test run case not found';
    case 'declined':
      return 'Agent diagnoses are declined for this project';
    case 'running':
      return `A diagnosis is already running for this ${scope === 'cluster' ? 'cluster' : 'failure'}`;
    case 'not-failed':
      return 'This test run case did not fail';
  }
}

/** The HTTP status of each refusal. */
export const AGENT_DIAGNOSIS_STATUS = { 'not-found': 404, declined: 403, running: 409, 'not-failed': 400 } as const;
