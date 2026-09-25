/**
 * What the server supplies to the shared report-schedule handlers: the zone
 * schedules run in, a schedule owner's project access at run time, the
 * dashboard's public address and the Piwi version.
 */
import { eq } from 'drizzle-orm';
import type { H3Event } from 'h3';
import { users, type User } from '../../database/schema';
import type { DbClient } from '../../database';
import { getProjectScope } from '../project-access';
import { isAuthEnabled } from '../auth';
import { resolveLocaleSettings } from '../locale-settings';
import { scheduleTimeZone } from '#shared/reports/schedule';
import type { ProjectAccess } from '#shared/handlers/analytics/common';
import type { ReportActor } from '#shared/handlers/reports';
import { Role } from '#shared/types';

/** The instance time zone, or UTC when the instance leaves it to each browser. */
export async function reportScheduleTimeZone(db: DbClient): Promise<string> {
  return scheduleTimeZone((await resolveLocaleSettings(db)).timeZone);
}

/** A schedule owner's project access now; a global schedule (no owner) sees every project. */
export async function scheduleOwnerAccess(db: DbClient, userId: number | null): Promise<ProjectAccess> {
  if (userId === null) return 'all';
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return new Set<number>();
  return getProjectScope(db, user);
}

/** The public address of the dashboard, for the links in a delivered report. */
export function reportBaseUrl(): string {
  const config = useRuntimeConfig().public as { siteUrl?: string };
  return (config.siteUrl || process.env.PIWI_SITE_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function reportPiwiVersion(): string | null {
  return ((useRuntimeConfig().public as { appVersion?: string })?.appVersion as string) || null;
}

export function reportActor(event: H3Event, user: User): ReportActor {
  const authEnabled = isAuthEnabled(event);
  return {
    id: authEnabled ? user.id : null,
    isAdmin: !authEnabled || (user.role as Role) === Role.ADMINISTRATOR,
    authEnabled,
  };
}
