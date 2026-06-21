import { eq, and } from 'drizzle-orm';
import { projects, testRuns, failureClusters } from '../../database/schema';
import { emitNotification } from './emit';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

/**
 * Emit run.finished / run.failed / run.failed.default_branch notifications for a completed run,
 * plus cluster.new for any failure clusters first seen in this run.
 * Call this after the run status is finalized.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function emitRunNotifications(db: LibSQLDatabase<any>, runId: number): Promise<void> {
  try {
    const [runRow] = await db.select().from(testRuns).where(eq(testRuns.id, runId));
    if (!runRow) return;

    const [project] = await db.select().from(projects).where(eq(projects.id, runRow.projectId));
    if (!project) return;

    const meta = (runRow.metadata as Record<string, unknown> | null) ?? {};
    const branch = (meta.branch as string | undefined) || (meta.gitBranch as string | undefined) || undefined;
    const defaultBranch = (meta.defaultBranch as string | undefined) || 'main';
    const isDefaultBranch = branch ? branch === defaultBranch : false;

    const runPayload = {
      runId,
      projectId: runRow.projectId,
      projectName: project.label || project.name,
      status: runRow.status,
      totalTests: runRow.totalTests,
      failedTests: runRow.failedTests,
      passedTests: runRow.passedTests,
      flakyTests: runRow.flakyTests,
      branch,
      isDefaultBranch,
    };

    await emitNotification(db, 'run.finished', runPayload);

    if (runRow.status === 'failed' || runRow.failedTests > 0) {
      await emitNotification(db, 'run.failed', runPayload);
      if (isDefaultBranch) {
        await emitNotification(db, 'run.failed.default_branch', runPayload);
      }
    }

    // Emit cluster.new for any clusters first seen in this run
    const newClusters = await db
      .select({ id: failureClusters.id, signature: failureClusters.signature })
      .from(failureClusters)
      .where(and(eq(failureClusters.firstSeenRunId, runId), eq(failureClusters.projectId, runRow.projectId)));

    for (const cluster of newClusters) {
      await emitNotification(db, 'cluster.new', {
        clusterId: cluster.id,
        projectId: runRow.projectId,
        projectName: project.label || project.name,
        signature: cluster.signature,
        runId,
      });
    }
  } catch (e) {
    console.error('[notifications] emitRunNotifications error', e);
  }
}
