import { failureClusters, failureDiagnoses, testRunsCases } from '../../../../database/schema';
import { eq, and } from 'drizzle-orm';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveClusterProjectId,
} from '../../../../utils/project-access';
import { Role } from '#shared/types';
import { resolveAiConfig } from '../../../../utils/ai-provider';
import type { AiAttachedImage } from '../../../../utils/ai-provider';
import { streamClusterDiagnosis, isDiagnosisRunning, isDiagnosisStale } from '../../../../utils/ai-diagnosis';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Run AI diagnosis with streaming response',
    description:
      'Triggers an AI-powered diagnosis for the specified failure cluster and returns the result as a Server-Sent Events stream. Text tokens are pushed as `event: thinking` chunks; the final structured result arrives as `event: result`.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');

  const body = (await readBody(event).catch(() => null)) as {
    additionalContext?: string;
    images?: AiAttachedImage[];
    baseCommit?: string;
    selectedCommitShas?: string[];
    scope?: string;
    testRunsCaseId?: number;
  } | null;

  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, id));
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  const config = await resolveAiConfig(db);
  if (!config) throw createError({ statusCode: 503, message: 'AI diagnosis is not configured' });

  const isExecutionScope = body?.scope === 'execution' && Boolean(body?.testRunsCaseId);

  if (isExecutionScope) {
    const [trc] = await db
      .select({ id: testRunsCases.id })
      .from(testRunsCases)
      .where(eq(testRunsCases.id, body!.testRunsCaseId!))
      .limit(1);
    if (!trc) throw createError({ statusCode: 404, message: 'Test run case not found' });
  }

  if (isDiagnosisRunning(id)) {
    throw createError({ statusCode: 409, message: 'Diagnosis is already running for this cluster' });
  }

  // Check for existing completed diagnosis (return as a single-event stream).
  // Not using the Force header — the client controls this by calling the
  // non-streaming diagnose endpoint first then switching to streaming for re-runs.
  const force = getQuery(event).force === 'true';
  if (!force) {
    const whereClause = isExecutionScope
      ? and(eq(failureDiagnoses.testRunsCaseId, body!.testRunsCaseId!), eq(failureDiagnoses.scope, 'execution'))
      : and(eq(failureDiagnoses.clusterId, id), eq(failureDiagnoses.scope, 'cluster'));

    const existingRows = await db.select().from(failureDiagnoses).where(whereClause).limit(1);
    const existing = existingRows[0];
    if (existing) {
      if (existing.status === 'running' && !isDiagnosisStale(existing)) {
        throw createError({ statusCode: 409, message: 'Diagnosis is already running' });
      }
      if (existing.status === 'completed') {
        // Return existing result as an immediate SSE stream
        setResponseHeaders(event, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const encoder = new TextEncoder();
        const existingData = JSON.stringify(existing);
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(`event: result\ndata: ${existingData}\n\n`));
              controller.close();
            },
          }),
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'X-Accel-Buffering': 'no',
            },
          },
        );
      }
    }
  }

  // SSE headers
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const encoder = new TextEncoder();
  let clientDisconnected = false;

  event.node.req.on('close', () => {
    clientDisconnected = true;
  });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await streamClusterDiagnosis(db, cluster, config, {
          additionalContext: body?.additionalContext,
          images: body?.images,
          baseCommit: body?.baseCommit,
          selectedCommitShas: body?.selectedCommitShas,
          testRunsCaseId: isExecutionScope ? body!.testRunsCaseId : undefined,
          onChunk: (chunk) => {
            if (clientDisconnected) return;
            try {
              if (chunk.type === 'text') {
                controller.enqueue(
                  encoder.encode(`event: thinking\ndata: ${JSON.stringify({ text: chunk.data })}\n\n`),
                );
              } else if (chunk.type === 'done') {
                controller.enqueue(encoder.encode(`event: result\ndata: ${JSON.stringify(chunk.data)}\n\n`));
              } else if (chunk.type === 'error') {
                controller.enqueue(
                  encoder.encode(`event: error\ndata: ${JSON.stringify({ message: String(chunk.data) })}\n\n`),
                );
              }
            } catch {
              // Stream closed — ignore
            }
          },
        });
      } catch (err) {
        if (clientDisconnected) return;
        try {
          const msg = err instanceof Error ? err.message : String(err);
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`));
        } catch {
          // Stream closed
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },
  });

  return stream;
});
