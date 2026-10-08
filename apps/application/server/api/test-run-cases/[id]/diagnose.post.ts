import { queryFlag } from '../../../utils/query-params';
import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';
import type { AiAttachedImage } from '../../../utils/ai-provider';
import { diagnoseExecution } from '../../../utils/execution-diagnosis';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'Run AI diagnosis for a test run case',
    description:
      'Triggers an AI-powered diagnosis for the specified test run case (execution scope). Uses its failure cluster for context if available.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'force',
        in: 'query',
        required: false,
        schema: { type: 'boolean' },
        description: 'Re-run the diagnosis even if one already exists (default false).',
      },
    ],
    'x-required-permission': 'ai:run',
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');

  const body = (await readBody(event).catch(() => null)) as {
    additionalContext?: string;
    images?: AiAttachedImage[];
    baseCommit?: string;
    selectedCommitShas?: string[];
  } | null;

  const outcome = await diagnoseExecution(db, id, {
    force: queryFlag(event, 'force'),
    additionalContext: body?.additionalContext,
    images: body?.images,
    baseCommit: body?.baseCommit,
    selectedCommitShas: body?.selectedCommitShas,
  });
  if (outcome.ok) return outcome.diagnosis;
  if (outcome.error === 'not-found') throw apiError({ statusCode: 404, message: 'Test run case not found' });
  if (outcome.error === 'not-configured') {
    throw apiError({ statusCode: 503, errorCode: 'AI_NOT_CONFIGURED', message: 'AI diagnosis is not configured' });
  }
  throw apiError({ statusCode: 409, message: 'Diagnosis is already running' });
});
