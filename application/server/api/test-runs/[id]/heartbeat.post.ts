import { eq } from 'drizzle-orm';
import { getDatabase } from '../../../database';
import { testRuns } from '../../../database/schema';
import { authorizeStreamToken } from '../../../utils/stream-auth';
import { Role } from '#shared/types';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Test Runs'],
    summary: 'Keep a streaming test run alive',
    description:
      'Lightweight liveness ping for an active streaming run. The reporter sends this during idle gaps (when no test events are flowing) so the server can tell a still-running run apart from a crashed one. Bumps the run\'s activity timestamp; the stale-run reaper marks runs with no recent activity as "interrupted". Requires the stream token.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { streamToken: { type: 'string' } },
            required: ['streamToken'],
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0');

  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid test run ID' });
  }

  const body = await readBody(event);

  if (!body.streamToken) {
    throw createError({ statusCode: 401, message: 'Missing stream token' });
  }

  const db = await getDatabase();

  // Validates the token (and revives an interrupted run if it was prematurely reaped).
  await authorizeStreamToken(db, id, body.streamToken);

  // Advance the activity timestamp so the stale-run reaper leaves this run alone.
  await db.update(testRuns).set({ updatedAt: new Date() }).where(eq(testRuns.id, id));

  return { success: true };
});
