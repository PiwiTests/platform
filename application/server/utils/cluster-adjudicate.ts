/**
 * LLM adjudication for the ambiguous similarity band. When two clusters are
 * close enough to suspect but not auto-merge, a reasoning model decides whether
 * they share a root cause. Used sparingly (budget-capped) by the reconciler.
 */

import { callAiProvider } from './ai-provider';
import type { ResolvedAiRole } from '~~/types/api';

const ADJUDICATION_SYSTEM_PROMPT = `You are triaging automated software-test failures. Given two failure clusters,
decide whether they share the SAME underlying root cause (and should be merged into one) or are genuinely different
problems. Be conservative: only answer merge=true when the evidence clearly points to one cause. Reply strictly as JSON.`;

const ADJUDICATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    merge: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reason: { type: 'string' },
  },
  required: ['merge', 'confidence', 'reason'],
  additionalProperties: false,
} as const;

export interface ClusterForAdjudication {
  signature: string;
  errorType: string | null;
  sampleError: string | null;
}

export interface AdjudicationResult {
  merge: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

function block(label: string, c: ClusterForAdjudication): string {
  return [
    `${label}:`,
    `- error type: ${c.errorType ?? 'unknown'}`,
    `- signature: ${c.signature}`,
    `- sample error: ${(c.sampleError ?? '').slice(0, 1500)}`,
  ].join('\n');
}

export async function adjudicateClusterPair(
  role: ResolvedAiRole,
  a: ClusterForAdjudication,
  b: ClusterForAdjudication,
): Promise<AdjudicationResult | null> {
  const user = `${block('Cluster A', a)}\n\n${block('Cluster B', b)}\n\nDo these two clusters share the same root cause?`;
  const res = await callAiProvider(role, {
    system: ADJUDICATION_SYSTEM_PROMPT,
    user,
    jsonSchema: ADJUDICATION_JSON_SCHEMA as unknown as object,
    maxTokens: 512,
  });
  try {
    const j = JSON.parse(res.text) as Partial<AdjudicationResult>;
    if (typeof j.merge !== 'boolean') return null;
    const confidence =
      j.confidence === 'high' || j.confidence === 'medium' || j.confidence === 'low' ? j.confidence : 'low';
    return { merge: j.merge, confidence, reason: String(j.reason ?? '').slice(0, 500) };
  } catch {
    return null;
  }
}
