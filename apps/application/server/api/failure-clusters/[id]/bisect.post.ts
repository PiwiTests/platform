// Desktop-only: record the first bad commit a bisect found on a failure cluster,
// so the result survives reloads and reaches the fix plan (its endpoint, the
// Markdown export and the get_fix_plan MCP tool). 404 on the normal server build
// (no PIWI_DESKTOP_TOKEN); under the desktop guard only the app's own window can
// reach it, and it already drove the bisect on this machine.
import { eq } from 'drizzle-orm';
import { failureClusters } from '../../../database/schema';
import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';
import type { BisectedCommit } from '#shared/reproduce';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Record a bisected first bad commit (desktop app)',
    description:
      'Desktop build only — 404 on the server build. Persists the first bad commit the desktop-driven git bisect found on this cluster (sha, subject, author, date), so it shows in the fix plan next to the regression window.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

const SHA_RE = /^[0-9a-f]{7,40}$/;

export default eventHandler(async (event) => {
  if (!process.env.PIWI_DESKTOP_TOKEN) {
    throw apiError({ statusCode: 404, message: 'Desktop build only' });
  }
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');

  const body = await readBody(event);
  const sha = typeof body?.sha === 'string' ? body.sha.trim().toLowerCase() : '';
  if (!SHA_RE.test(sha)) {
    throw apiError({ statusCode: 400, message: 'A valid commit SHA is required' });
  }
  const result: BisectedCommit = {
    sha,
    subject: typeof body?.subject === 'string' ? body.subject.trim() : '',
    author: typeof body?.author === 'string' && body.author.trim() ? body.author.trim() : null,
    date: typeof body?.date === 'string' && body.date.trim() ? body.date.trim() : null,
    // Derived from the project's SCM provider when the plan is read, never stored.
    commitUrl: null,
  };

  const updated = await db
    .update(failureClusters)
    .set({ bisectResult: result, updatedAt: new Date() })
    .where(eq(failureClusters.id, id))
    .returning({ id: failureClusters.id });
  if (updated.length === 0) throw apiError({ statusCode: 404, message: 'Failure cluster not found' });

  return { ok: true, bisectedCommit: result };
});
