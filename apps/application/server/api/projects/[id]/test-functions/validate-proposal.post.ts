import { z } from 'zod';
import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { validateExtractedFunction } from '#shared/test-function-extract-prompt';
import { Role } from '#shared/types';

defineRouteMeta({
  openAPI: {
    tags: ['Test Functions'],
    summary: 'Validate a pasted AI response into a proposed catalog entry (no AI call)',
    description:
      'For instances with no AI provider configured: paste the JSON reply from your own AI chat (seeded with the dashboard\'s "Copy prompt for your own AI" button) and get back the same validated, reviewable proposal shape as the AI-calling extract endpoint — no AI call, no credits spent here. Requires reporter or administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

const validateProposalSchema = z.object({
  responseText: z.string().min(1, 'Paste the AI response first.'),
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id, [Role.ADMINISTRATOR, Role.REPORTER]);

  const body = await readBody(event);
  const validation = validateProposalSchema.safeParse(body);
  if (!validation.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: validation.error.issues });
  }

  try {
    const proposal = validateExtractedFunction(validation.data.responseText);
    return { proposal };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to validate that response';
    throw apiError({ statusCode: 422, message });
  }
});
