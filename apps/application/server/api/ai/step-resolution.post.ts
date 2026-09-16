import { z } from 'zod';
import { requireAuth } from '../../utils/auth';
import { getDatabase } from '../../database';
import { resolveAiConfig } from '../../utils/ai-provider';
import { resolveStep } from '../../utils/ai-step-resolver';
import type { StepResolutionRequest } from '#shared/ai-step-resolution';

defineRouteMeta({
  openAPI: {
    tags: ['AI'],
    summary: 'Resolve one AI-step iteration (authoring)',
    description:
      'Given a natural-language template, the current page ARIA snapshot and the actions taken so far, returns one step decision (an element + action, or done + postcondition) for the Piwi reporter to compile into a committed artifact. Requires reporter or administrator role and a configured AI provider (see Settings → AI). The reporter calls this only in resolve/heal mode; normal test runs never hit it.',
    'x-required-roles': ['administrator', 'reporter'],
  },
});

const elementSchema = z.object({
  role: z.string().min(1),
  name: z.string().optional(),
  level: z.number().optional(),
  ref: z.string().optional(),
});

const requestSchema = z.object({
  kind: z.enum(['locator', 'run', 'wait']),
  template: z.string().min(1),
  paramNames: z.array(z.string()).default([]),
  ariaSnapshot: z.string().default(''),
  history: z
    .array(z.object({ action: z.string(), element: elementSchema.optional(), value: z.string().optional() }))
    .default([]),
  observedResponses: z.array(z.string()).optional(),
  screenshot: z.object({ mediaType: z.enum(['image/png', 'image/jpeg']), data: z.string() }).optional(),
});

export default eventHandler(async (event) => {
  await requireAuth(event);

  const validation = requestSchema.safeParse(await readBody(event));
  if (!validation.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: validation.error.issues });
  }

  const db = await getDatabase();
  const config = await resolveAiConfig(db);
  // Planning/grounding reuses the research role (cheaper tier) with a diagnosis
  // fallback — the same ladder the test-function extractor uses.
  const role = config?.roles.research ?? config?.roles.diagnosis;
  if (!role) {
    throw apiError({
      statusCode: 503,
      errorCode: 'AI_NOT_CONFIGURED',
      message: 'AI is not configured for this instance — set it up in Settings → AI to author AI steps.',
    });
  }

  try {
    const result = await resolveStep(role, validation.data as StepResolutionRequest);
    return result.decision;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resolve the step';
    throw apiError({ statusCode: 422, message });
  }
});
