/**
 * Capability detection for the Setup page.
 *
 * Piwi's optional capabilities (capture fixtures, locator healing, AI diagnosis,
 * notifications, …) are each enabled somewhere else — a reporter option, a
 * settings page, an env var. Nothing told a user which ones were actually live
 * on their instance, so a feature they never switched on was indistinguishable
 * from one that was broken.
 *
 * This reports, per capability, whether the instance has ever seen evidence of
 * it working. It is deliberately evidence-based rather than config-based: a
 * configured-but-never-used capability reads as inactive, which is the honest
 * answer to "is this working for me?".
 *
 * Cheap by construction — every check is a `limit(1)` existence probe, never a
 * full count, so the page stays fast on instances with millions of rows.
 */
import {
  testRuns,
  networkRequests,
  locatorSnapshots,
  notificationChannels,
  tags,
  markers,
  projects,
  appSettings,
  quarantinedTests,
  failureClusters,
  testRunsCases,
} from '../../server/database/schema';
import { and, eq, isNotNull, or } from 'drizzle-orm';

import type { DrizzleDB } from './db';

/** Stable ids — the UI keys its copy off these. */
export type SetupCapabilityId =
  | 'reporter'
  | 'fixtures'
  | 'locator-healing'
  | 'backend-logs'
  | 'clustering'
  | 'ai'
  | 'notifications'
  | 'scm'
  | 'tags'
  | 'markers'
  | 'quarantine'
  | 'green-samples';

export interface SetupCapability {
  id: SetupCapabilityId;
  /** True when the instance has evidence this capability is doing something. */
  active: boolean;
}

export interface SetupStatus {
  capabilities: SetupCapability[];
}

/** `true` when the table has at least one row matching the (optional) filter. */
async function exists(db: DrizzleDB, query: Promise<unknown[]>): Promise<boolean> {
  const rows = await query;
  return rows.length > 0;
}

export async function getSetupStatus(db: DrizzleDB): Promise<SetupStatus> {
  const [
    hasRuns,
    hasNetwork,
    hasLocators,
    hasServerTraces,
    hasClusters,
    hasAiSetting,
    hasChannels,
    hasScm,
    hasTags,
    hasMarkers,
    hasQuarantine,
    hasGreenSamples,
  ] = await Promise.all([
    exists(db, db.select({ id: testRuns.id }).from(testRuns).limit(1)),
    exists(db, db.select({ id: networkRequests.id }).from(networkRequests).limit(1)),
    exists(db, db.select({ id: locatorSnapshots.id }).from(locatorSnapshots).limit(1)),
    exists(
      db,
      db
        .select({ id: networkRequests.id })
        .from(networkRequests)
        .where(isNotNull(networkRequests.serverTraces))
        .limit(1),
    ),
    exists(db, db.select({ id: failureClusters.id }).from(failureClusters).limit(1)),
    exists(db, db.select({ key: appSettings.key }).from(appSettings).where(eq(appSettings.key, 'ai')).limit(1)),
    exists(db, db.select({ id: notificationChannels.id }).from(notificationChannels).limit(1)),
    exists(db, db.select({ id: projects.id }).from(projects).where(isNotNull(projects.scmToken)).limit(1)),
    exists(db, db.select({ id: tags.id }).from(tags).limit(1)),
    exists(db, db.select({ id: markers.id }).from(markers).limit(1)),
    exists(db, db.select({ id: quarantinedTests.id }).from(quarantinedTests).limit(1)),
    exists(
      db,
      db
        .select({ id: testRunsCases.id })
        .from(testRunsCases)
        .where(
          and(
            eq(testRunsCases.status, 'passed'),
            or(isNotNull(testRunsCases.ariaSnapshotPayloadId), isNotNull(testRunsCases.ariaSnapshot)),
          ),
        )
        .limit(1),
    ),
  ]);

  // AI also counts as active when pinned by environment — an env-configured
  // instance has no `ai` row in app_settings but is very much switched on.
  const aiFromEnv = Boolean(
    typeof process !== 'undefined' && (process.env?.PIWI_AI_API_KEY || process.env?.PIWI_AI_MODEL),
  );

  const capabilities: SetupCapability[] = [
    { id: 'reporter', active: hasRuns },
    { id: 'fixtures', active: hasNetwork },
    { id: 'locator-healing', active: hasLocators },
    { id: 'backend-logs', active: hasServerTraces },
    { id: 'clustering', active: hasClusters },
    { id: 'ai', active: hasAiSetting || aiFromEnv },
    { id: 'notifications', active: hasChannels },
    { id: 'scm', active: hasScm },
    { id: 'tags', active: hasTags },
    { id: 'markers', active: hasMarkers },
    { id: 'quarantine', active: hasQuarantine },
    { id: 'green-samples', active: hasGreenSamples },
  ];

  return { capabilities };
}
