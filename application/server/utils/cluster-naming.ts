/**
 * Generate short, human-readable titles for failure clusters using a cheap model.
 * One batched call names many clusters at once (cost-efficient). Titles replace
 * the raw normalized `signature` in the UI; on failure we just keep the signature.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { failureClusters } from '../database/schema';
import { callAiProvider } from './ai-provider';
import type { ResolvedAiRole } from '~~/types/api';

type DbClient = Awaited<ReturnType<typeof import('../database').getDatabase>>;

const MAX_NAME_PER_RUN = 20; // cost guard

const NAMING_SYSTEM_PROMPT =
  'You name software-test failure clusters. For each cluster, write a concise, human-readable title (≤ 8 words) capturing the failing behavior or root cause — not a generic restatement of the stack trace. No trailing punctuation. Reply strictly as JSON.';

const NAMING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    titles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          title: { type: 'string' },
        },
        required: ['id', 'title'],
        additionalProperties: false,
      },
    },
  },
  required: ['titles'],
  additionalProperties: false,
} as const;

export interface ClusterForNaming {
  id: number;
  signature: string;
  errorType: string | null;
  sampleError: string | null;
}

const TITLE_MAX_CHARS = 80;
const SAMPLE_CAP = 800;

export async function generateClusterTitles(
  role: ResolvedAiRole,
  clusters: ClusterForNaming[],
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (clusters.length === 0) return result;

  const user = clusters
    .map(
      (c) =>
        `id ${c.id} [${c.errorType ?? 'unknown'}]: ${c.signature}\n  sample: ${(c.sampleError ?? '').slice(0, SAMPLE_CAP)}`,
    )
    .join('\n\n');

  const res = await callAiProvider(role, {
    system: NAMING_SYSTEM_PROMPT,
    user: `Name these ${clusters.length} failure clusters. Return one title per id.\n\n${user}`,
    jsonSchema: NAMING_JSON_SCHEMA as unknown as object,
    maxTokens: 1024,
  });

  try {
    const parsed = JSON.parse(res.text) as { titles?: Array<{ id: number; title: string }> };
    const valid = new Set(clusters.map((c) => c.id));
    for (const t of parsed.titles ?? []) {
      const title = String(t.title ?? '')
        .trim()
        .slice(0, TITLE_MAX_CHARS);
      if (valid.has(t.id) && title) result.set(t.id, title);
    }
  } catch {
    // leave map empty — callers keep the signature
  }
  return result;
}

/** Title the still-unnamed clusters first seen in a run (one batched call). */
export async function nameNewClusters(
  db: DbClient,
  projectId: number,
  runId: number,
  role: ResolvedAiRole,
): Promise<number> {
  const rows = await db
    .select({
      id: failureClusters.id,
      signature: failureClusters.signature,
      errorType: failureClusters.errorType,
      sampleError: failureClusters.sampleError,
    })
    .from(failureClusters)
    .where(
      and(
        eq(failureClusters.projectId, projectId),
        eq(failureClusters.firstSeenRunId, runId),
        eq(failureClusters.status, 'open'),
        isNull(failureClusters.title),
      ),
    )
    .limit(MAX_NAME_PER_RUN);

  if (rows.length === 0) return 0;

  const titles = await generateClusterTitles(role, rows);
  let named = 0;
  for (const [id, title] of titles) {
    await db.update(failureClusters).set({ title, updatedAt: new Date() }).where(eq(failureClusters.id, id));
    named++;
  }
  return named;
}
