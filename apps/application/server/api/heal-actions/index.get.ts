import { desc, eq } from 'drizzle-orm';
import { getDatabase } from '../../database';
import { healActions } from '../../database/schema';
import { requireProjectAccess } from '../../utils/project-access';
import type { HealActionPayload, HealActionResult } from '#shared/auto-heal';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'List auto-heal actions for a project',
    description:
      'The auto-heal pull requests Piwi has opened (or tried to) for a project, newest first: status, target branch, edit count, and the PR link when one was opened.',
    parameters: [{ name: 'projectId', in: 'query', required: true, schema: { type: 'integer' } }],
  },
});

export default eventHandler(async (event) => {
  const projectId = Number(getQuery(event).projectId);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'projectId query parameter is required' });
  }
  await requireProjectAccess(event, projectId);
  const db = await getDatabase();

  const rows = await db
    .select()
    .from(healActions)
    .where(eq(healActions.projectId, projectId))
    .orderBy(desc(healActions.id))
    .limit(50);

  return {
    actions: rows.map((row) => {
      const payload = row.payload as HealActionPayload;
      const result = row.result as HealActionResult | null;
      return {
        id: row.id,
        status: row.status,
        provider: payload.provider,
        branch: payload.branch,
        editCount: payload.edits.length,
        prNumber: result?.prNumber ?? null,
        prUrl: result?.prUrl ?? null,
        error: row.error,
        runId: row.runId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }),
  };
});
