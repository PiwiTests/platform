import { getDatabase } from '../../database';
import {
  capDiagnosisVersions,
  deleteRunsOlderThan,
  pruneHealActions,
  pruneIntegrationActions,
  pruneNotificationDeliveries,
  reclaimSpace,
  sweepOrphans,
} from '../../utils/retention';

function envInt(name: string): number | null {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export default defineTask({
  meta: {
    name: 'retention:sweep',
    description:
      'Prune old test runs (opt-in via PIWI_RETENTION_DAYS), settled notification deliveries, and excess diagnosis versions',
  },
  async run() {
    const db = await getDatabase();
    const result: Record<string, unknown> = {};

    // Destructive run pruning is strictly opt-in: unset or 0 = keep everything.
    const retentionDays = envInt('PIWI_RETENTION_DAYS');
    if (retentionDays && retentionDays > 0) {
      const { deletedRuns, deletedCases } = await deleteRunsOlderThan(db, retentionDays);
      result.deletedRuns = deletedRuns;
      result.deletedCases = deletedCases;
    }

    const orphans = await sweepOrphans(db);
    const orphanTotal = Object.values(orphans).reduce((a, b) => a + b, 0);
    if (orphanTotal > 0) result.orphansRemoved = orphanTotal;

    const notificationDays = envInt('PIWI_RETENTION_NOTIFICATION_DAYS') ?? 30;
    if (notificationDays > 0) {
      const pruned = await pruneNotificationDeliveries(db, notificationDays);
      if (pruned > 0) result.deliveriesPruned = pruned;
    }

    const keepVersions = envInt('PIWI_RETENTION_DIAGNOSIS_VERSIONS') ?? 20;
    if (keepVersions > 0) {
      const pruned = await capDiagnosisVersions(db, keepVersions);
      if (pruned > 0) result.diagnosisVersionsPruned = pruned;
    }

    // Reuse the notification-outbox horizon for settled heal actions.
    if (notificationDays > 0) {
      const pruned = await pruneHealActions(db, notificationDays);
      if (pruned > 0) result.healActionsPruned = pruned;
    }

    // …and for settled integration actions.
    if (notificationDays > 0) {
      const pruned = await pruneIntegrationActions(db, notificationDays);
      if (pruned > 0) result.integrationActionsPruned = pruned;
    }

    const space = await reclaimSpace(db);
    if (space.attempted) result.spaceReclaim = space.note;

    if (Object.keys(result).length > 0) {
      console.info(`[retention:sweep] ${JSON.stringify(result)}`);
    }
    return { result };
  },
});
