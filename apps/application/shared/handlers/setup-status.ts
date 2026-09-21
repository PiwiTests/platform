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
  testCases,
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
  integrationConnections,
} from '../../server/database/schema';
import { and, eq, isNotNull, or } from 'drizzle-orm';
import { getAppSetting, setAppSetting } from '../../server/utils/app-settings';
import { PR_FEEDBACK_KEY } from '#shared/pr-feedback';
import { AUTO_HEAL_KEY } from '#shared/auto-heal';
import { compareVersions } from '#shared/piwi-env-vars';
import {
  CAPABILITIES,
  CAPABILITY_BY_ID,
  CAPABILITIES_SETTING_KEY,
  parseInstanceDecisions,
  resolveCapabilities,
  type CapabilityFacts,
  type CapabilityId,
  type CapabilityState,
  type InstanceDecision,
} from '#shared/capabilities';

import type { DrizzleDB } from './db';

/** Stable ids — the UI keys its copy off these. */
export type SetupCapabilityId =
  | 'reporter'
  | 'fixtures'
  | 'locator-healing'
  | 'backend-logs'
  | 'clustering'
  | 'ai'
  | 'mcp'
  | 'notifications'
  | 'pr-feedback'
  | 'auto-heal'
  | 'integrations'
  | 'scm'
  | 'tags'
  | 'markers'
  | 'quarantine'
  | 'green-samples';

export interface SetupCapability {
  id: SetupCapabilityId;
  /** True when the instance has evidence this capability is doing something. */
  active: boolean;
  /** Resolved instance-level state (evidence, then the stored decision). */
  state: CapabilityState;
  /** The stored instance decision, or `null` when nothing is stored. */
  decision: InstanceDecision | null;
  /** True when the capability's release is newer than the instance's first run. */
  isNew: boolean;
}

export interface SetupStatus {
  capabilities: SetupCapability[];
}

/** `app_settings` key holding the app version recorded at the instance's first Setup read. */
export const FIRST_RUN_VERSION_KEY = 'first-run-version';

/** Evidence for every detection id, `true` when at least one row exists. */
export type CapabilityEvidence = Record<SetupCapabilityId, boolean>;

/** `true` when the table has at least one row matching the (optional) filter. */
async function exists(db: DrizzleDB, query: Promise<unknown[]>): Promise<boolean> {
  const rows = await query;
  return rows.length > 0;
}

/**
 * Evidence per detection id. With no `projectId` the probes are instance-wide;
 * with one, the project-level detections (fixtures, backend logs, locator
 * healing, green samples, quarantine, markers, the SCM token, and the reporter
 * and clustering rows) are scoped through the project's runs and cases. The
 * instance-shaped detections (AI, notifications, tags) stay instance-wide
 * because they carry no project dimension.
 */
export async function getCapabilityEvidence(db: DrizzleDB, projectId?: number): Promise<CapabilityEvidence> {
  const scoped = typeof projectId === 'number';
  const pid = projectId as number;

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
    hasPrFeedback,
    hasAutoHeal,
    hasIntegrations,
  ] = await Promise.all([
    exists(
      db,
      scoped
        ? db.select({ id: testRuns.id }).from(testRuns).where(eq(testRuns.projectId, pid)).limit(1)
        : db.select({ id: testRuns.id }).from(testRuns).limit(1),
    ),
    exists(
      db,
      scoped
        ? db
            .select({ id: networkRequests.id })
            .from(networkRequests)
            .innerJoin(testRuns, eq(networkRequests.testRunId, testRuns.id))
            .where(eq(testRuns.projectId, pid))
            .limit(1)
        : db.select({ id: networkRequests.id }).from(networkRequests).limit(1),
    ),
    exists(
      db,
      scoped
        ? db
            .select({ id: locatorSnapshots.id })
            .from(locatorSnapshots)
            .innerJoin(testCases, eq(locatorSnapshots.testCaseId, testCases.id))
            .where(eq(testCases.projectId, pid))
            .limit(1)
        : db.select({ id: locatorSnapshots.id }).from(locatorSnapshots).limit(1),
    ),
    exists(
      db,
      scoped
        ? db
            .select({ id: networkRequests.id })
            .from(networkRequests)
            .innerJoin(testRuns, eq(networkRequests.testRunId, testRuns.id))
            .where(and(eq(testRuns.projectId, pid), isNotNull(networkRequests.serverTraces)))
            .limit(1)
        : db
            .select({ id: networkRequests.id })
            .from(networkRequests)
            .where(isNotNull(networkRequests.serverTraces))
            .limit(1),
    ),
    exists(
      db,
      scoped
        ? db.select({ id: failureClusters.id }).from(failureClusters).where(eq(failureClusters.projectId, pid)).limit(1)
        : db.select({ id: failureClusters.id }).from(failureClusters).limit(1),
    ),
    exists(db, db.select({ key: appSettings.key }).from(appSettings).where(eq(appSettings.key, 'ai')).limit(1)),
    exists(db, db.select({ id: notificationChannels.id }).from(notificationChannels).limit(1)),
    exists(
      db,
      scoped
        ? db
            .select({ id: projects.id })
            .from(projects)
            .where(and(eq(projects.id, pid), isNotNull(projects.scmToken)))
            .limit(1)
        : db.select({ id: projects.id }).from(projects).where(isNotNull(projects.scmToken)).limit(1),
    ),
    exists(db, db.select({ id: tags.id }).from(tags).limit(1)),
    exists(
      db,
      scoped
        ? db.select({ id: markers.id }).from(markers).where(eq(markers.projectId, pid)).limit(1)
        : db.select({ id: markers.id }).from(markers).limit(1),
    ),
    exists(
      db,
      scoped
        ? db
            .select({ id: quarantinedTests.id })
            .from(quarantinedTests)
            .where(eq(quarantinedTests.projectId, pid))
            .limit(1)
        : db.select({ id: quarantinedTests.id }).from(quarantinedTests).limit(1),
    ),
    exists(
      db,
      scoped
        ? db
            .select({ id: testRunsCases.id })
            .from(testRunsCases)
            .innerJoin(testRuns, eq(testRunsCases.testRunId, testRuns.id))
            .where(
              and(
                eq(testRuns.projectId, pid),
                eq(testRunsCases.status, 'passed'),
                or(isNotNull(testRunsCases.ariaSnapshotPayloadId), isNotNull(testRunsCases.ariaSnapshot)),
              ),
            )
            .limit(1)
        : db
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
    // Pull-request feedback and auto-heal read active from their stored settings
    // (the `enabled` flag the full getters resolve, read here directly so this
    // handler stays free of the SCM providers those getters pull in); issue
    // integrations from a single connection row. None has a project dimension, so
    // these stay instance-wide even when a project is scoped.
    getAppSetting<{ enabled?: boolean }>(db, PR_FEEDBACK_KEY).then((s) => s?.enabled === true),
    getAppSetting<{ enabled?: boolean }>(db, AUTO_HEAL_KEY).then((s) => s?.enabled === true),
    exists(db, db.select({ id: integrationConnections.id }).from(integrationConnections).limit(1)),
  ]);

  // AI also counts as active when pinned by environment — an env-configured
  // instance has no `ai` row in app_settings but is very much switched on.
  const aiFromEnv = Boolean(
    typeof process !== 'undefined' && (process.env?.PIWI_AI_API_KEY || process.env?.PIWI_AI_MODEL),
  );

  return {
    reporter: hasRuns,
    fixtures: hasNetwork,
    'locator-healing': hasLocators,
    'backend-logs': hasServerTraces,
    clustering: hasClusters,
    ai: hasAiSetting || aiFromEnv,
    // MCP has no evidence probe — it is always available, so the resolver marks
    // it configured rather than active.
    mcp: false,
    notifications: hasChannels,
    'pr-feedback': hasPrFeedback,
    'auto-heal': hasAutoHeal,
    integrations: hasIntegrations,
    scm: hasScm,
    tags: hasTags,
    markers: hasMarkers,
    quarantine: hasQuarantine,
    'green-samples': hasGreenSamples,
  };
}

/** Read and validate the stored instance decisions. */
export async function getInstanceDecisions(db: DrizzleDB): Promise<Partial<Record<CapabilityId, InstanceDecision>>> {
  return parseInstanceDecisions(await getAppSetting(db, CAPABILITIES_SETTING_KEY));
}

/** The detection ids that are core capabilities with no decline control. */
const CORE_LADDER_IDS = new Set<SetupCapabilityId>(['reporter', 'clustering']);

const SETUP_LADDER_ORDER: SetupCapabilityId[] = [
  'reporter',
  'fixtures',
  'locator-healing',
  'backend-logs',
  'clustering',
  'ai',
  'mcp',
  'notifications',
  'pr-feedback',
  'auto-heal',
  'integrations',
  'scm',
  'tags',
  'markers',
  'quarantine',
  'green-samples',
];

/**
 * Build the instance-level facts for one detection id from its evidence and the
 * stored instance decisions. `backend-logs` is applicable only where a server
 * trace has arrived; `mcp` is always available even with no evidence.
 */
function instanceFacts(
  id: CapabilityId,
  evidence: CapabilityEvidence,
  decisions: Partial<Record<CapabilityId, InstanceDecision>>,
): CapabilityFacts {
  const has = (evidence as Record<string, boolean>)[id] ?? false;
  return {
    evidence: has,
    configured: id === 'mcp' ? true : undefined,
    applicable: id === 'backend-logs' ? has : true,
    instanceDecision: decisions[id],
  };
}

/** Instance-level facts for every capability, ready for {@link resolveCapabilities}. */
export function buildInstanceFacts(
  evidence: CapabilityEvidence,
  decisions: Partial<Record<CapabilityId, InstanceDecision>>,
): Partial<Record<CapabilityId, CapabilityFacts>> {
  const facts: Partial<Record<CapabilityId, CapabilityFacts>> = {};
  for (const def of CAPABILITIES) facts[def.id] = instanceFacts(def.id, evidence, decisions);
  return facts;
}

/** The resolved instance state for every capability. */
export async function resolveInstanceStates(db: DrizzleDB): Promise<Record<CapabilityId, CapabilityState>> {
  const [evidence, decisions] = await Promise.all([getCapabilityEvidence(db), getInstanceDecisions(db)]);
  return resolveCapabilities(buildInstanceFacts(evidence, decisions));
}

/**
 * The Setup ladder for every capability, plus the two core rows.
 *
 * `appVersion` is the running app version; the first time it is supplied on an
 * instance the version is recorded under {@link FIRST_RUN_VERSION_KEY}, and every
 * later read marks a row `isNew` when its release is newer than that recorded
 * version, so a capability added after the instance started is flagged once.
 */
export async function getSetupStatus(db: DrizzleDB, appVersion?: string): Promise<SetupStatus> {
  const evidence = await getCapabilityEvidence(db);
  const decisions = await getInstanceDecisions(db);
  const states = resolveCapabilities(buildInstanceFacts(evidence, decisions));

  const firstRunVersion = await resolveFirstRunVersion(db, appVersion);
  const isNewSince = (since: string | null): boolean =>
    Boolean(since && firstRunVersion && compareVersions(since, firstRunVersion) > 0);

  const capabilities: SetupCapability[] = SETUP_LADDER_ORDER.map((id) => {
    const active = evidence[id];
    if (CORE_LADDER_IDS.has(id)) {
      return { id, active, state: active ? 'active' : 'undecided', decision: null, isNew: false };
    }
    const def = CAPABILITY_BY_ID[id as CapabilityId];
    return {
      id,
      active,
      state: states[id as CapabilityId],
      decision: decisions[id as CapabilityId] ?? null,
      isNew: isNewSince(def?.since ?? null),
    };
  });

  return { capabilities };
}

/**
 * Read the recorded first-run version, writing the current one the first time an
 * instance is asked. Returns the version to compare `since` against, or null
 * when none is known yet (a fresh instance with no version supplied).
 */
async function resolveFirstRunVersion(db: DrizzleDB, appVersion?: string): Promise<string | null> {
  const recorded = await getAppSetting<string>(db, FIRST_RUN_VERSION_KEY);
  if (recorded) return recorded;
  if (appVersion) {
    await setAppSetting(db, FIRST_RUN_VERSION_KEY, appVersion);
    return appVersion;
  }
  return null;
}
