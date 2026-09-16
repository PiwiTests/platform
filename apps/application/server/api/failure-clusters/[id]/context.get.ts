import { failureClusters } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { buildDiagnosisContext } from '../../../utils/ai-context';
import { loadDiagnosisSystemPrompt } from '../../../utils/ai-diagnosis';
import { buildPromptPreview } from '#shared/ai-prompt-preview';
import { contextStalenessHash } from '#shared/diagnosis-staleness';
import { DIAGNOSIS_JSON_SCHEMA } from '#shared/ai-diagnosis';
import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Get AI diagnosis context preview',
    description:
      'Returns a preview of the full AI context that would be sent for diagnosis. `?format=json` gives a structured response with per-section breakdown, token estimate and coverage metadata; `?format=prompt` gives the exact request payload as plain text — system prompt, user message, image count and response schema — for pasting into another assistant or auditing what is sent.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['json', 'prompt'] } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');

  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, id));
  if (!cluster) throw apiError({ statusCode: 404, message: 'Failure cluster not found' });

  const query = getQuery(event);
  const baseCommit = query.baseCommit as string | undefined;
  const selectedCommitShasRaw = query.selectedCommitShas;
  const selectedCommitShas = Array.isArray(selectedCommitShasRaw)
    ? selectedCommitShasRaw.map(String)
    : selectedCommitShasRaw
      ? [String(selectedCommitShasRaw)]
      : undefined;
  const format = query.format as string | undefined;

  const ctx = await buildDiagnosisContext(db, {
    kind: 'cluster',
    clusterId: id,
    baseCommit,
    selectedCommitShas,
  });

  if (format === 'prompt') {
    setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8');
    return buildPromptPreview({
      system: await loadDiagnosisSystemPrompt(db, cluster),
      user: ctx.text,
      imageCount: ctx.images?.length ?? 0,
      jsonSchema: DIAGNOSIS_JSON_SCHEMA,
    });
  }

  // Same hash the completed diagnosis stored, so the client can tell whether the
  // evidence has changed since (staleness detection).
  const contextSha = await contextStalenessHash(ctx.sections);

  if (format === 'json') {
    return {
      scope: ctx.scope,
      text: ctx.text,
      contextSha,
      sections: ctx.sections,
      coverage: ctx.coverage,
      scmChanges: ctx.scmChanges,
      tokenEstimate: ctx.tokenEstimate,
      textTokenEstimate: ctx.textTokenEstimate,
      imageTokenEstimate: ctx.imageTokenEstimate,
      cluster: ctx.cluster,
    };
  }

  return { context: ctx.text, contextSha, coverage: ctx.coverage, scmChanges: ctx.scmChanges };
});
