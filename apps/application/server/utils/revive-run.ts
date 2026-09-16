import { testRuns } from '../database/schema';
import { apiError } from './api-error';
import { eq } from 'drizzle-orm';
import type { DbClient as DB } from '../database';

/**
 * Validates the stream token for a test run. If the run was interrupted by the
 * stale-run cleanup (no activity for 1h, streamToken cleared), this revives it
 * back to `running` by accepting the reporter's existing token.
 *
 * Throws a proper HTTP error on invalid state or token mismatch.
 * Mutates `testRun` in place on revival so callers see the updated state.
 *
 * @param isShardToken Optional callback for shard-aware token validation.
 */
export async function validateAndReviveRun(
  db: DB,
  runId: number,
  testRun: { status: string; streamToken: string | null },
  bodyStreamToken: string | null | undefined,
  isShardToken?: (token: string) => boolean,
): Promise<void> {
  const isInterrupted = testRun.status === 'interrupted' && !testRun.streamToken;

  if (testRun.status !== 'running' && !isInterrupted) {
    throw apiError({
      statusCode: 409,
      message: 'Test run is not in running state',
    });
  }

  if (isInterrupted) {
    if (!bodyStreamToken) {
      throw apiError({
        statusCode: 403,
        message: 'Missing stream token',
      });
    }
    await db
      .update(testRuns)
      .set({
        status: 'running',
        streamToken: bodyStreamToken,
        updatedAt: new Date(),
      })
      .where(eq(testRuns.id, runId));
    testRun.status = 'running';
    testRun.streamToken = bodyStreamToken;
  } else if (testRun.streamToken !== bodyStreamToken) {
    // Fallback: accept shard token if provided
    if (isShardToken && bodyStreamToken && isShardToken(bodyStreamToken)) return;
    throw apiError({
      statusCode: 403,
      message: 'Invalid stream token',
    });
  }
}
