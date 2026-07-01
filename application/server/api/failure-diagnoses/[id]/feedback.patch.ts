import { failureDiagnoses } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { requireResolvedProjectAccess, requireRouteId, resolveDiagnosisProjectId } from '../../../utils/project-access';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Diagnoses'],
    summary: 'Submit feedback on a diagnosis',
    description: 'Record thumbs up/down feedback on a diagnosis result, with an optional note.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'diagnosis ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveDiagnosisProjectId, 'Diagnosis');

  const body = (await readBody(event).catch(() => null)) as {
    feedback?: string | null;
    feedbackNote?: string | null;
  } | null;
  if (!body) throw createError({ statusCode: 400, message: 'Request body required' });

  const feedback = body.feedback ?? null;
  if (feedback !== null && feedback !== 'up' && feedback !== 'down') {
    throw createError({ statusCode: 400, message: 'Feedback must be "up", "down", or null' });
  }

  const [existing] = await db
    .select({ id: failureDiagnoses.id })
    .from(failureDiagnoses)
    .where(eq(failureDiagnoses.id, id))
    .limit(1);
  if (!existing) throw createError({ statusCode: 404, message: 'Diagnosis not found' });

  const feedbackNote = body.feedbackNote?.trim() || null;

  await db
    .update(failureDiagnoses)
    .set({ feedback, feedbackNote, updatedAt: new Date() })
    .where(eq(failureDiagnoses.id, id));

  return { success: true, feedback, feedbackNote };
});
