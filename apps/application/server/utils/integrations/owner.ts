/**
 * The owner a cluster's owner routes match: the person a triager assigned it
 * to, else the `piwi:owner` annotation of its most-affected test, else the
 * repository's CODEOWNERS for that test's file.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { failureClusters, testCases, testRunsCases } from '../../database/schema';
import type { DbClient } from '../../database';
import { resolveOwners } from '../scm/ownership';

export async function resolveClusterOwner(db: DbClient, clusterId: number): Promise<string | null> {
  const [cluster] = await db
    .select({ projectId: failureClusters.projectId, assignee: failureClusters.assignee })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return null;
  if (cluster.assignee?.trim()) return cluster.assignee.trim();

  const [test] = await db
    .select({ filePath: testCases.filePath, owner: testCases.owner })
    .from(testRunsCases)
    .innerJoin(testCases, eq(testRunsCases.testCaseId, testCases.id))
    .where(eq(testRunsCases.failureClusterId, clusterId))
    .groupBy(testCases.id, testCases.filePath, testCases.owner)
    .orderBy(desc(sql`count(${testRunsCases.id})`))
    .limit(1);
  if (!test) return null;
  const resolved = await resolveOwners(db, cluster.projectId, [test]).catch(() => new Map());
  return resolved.get(test)?.owner ?? test.owner ?? null;
}
