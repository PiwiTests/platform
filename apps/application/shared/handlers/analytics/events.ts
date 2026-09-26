import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsEvents } from '../../analytics/types';
import { markersOptionsSchema } from '../../analytics/registry';
import type { ProjectAccess } from './common';
import { getAnalyticsScopeSummary } from './scope-summary';

/**
 * The timeline markers of the period, the ones the trends draw: every marker
 * with one project in scope, across projects the release, infra and incident
 * ones, optionally narrowed to some categories.
 */
export async function getAnalyticsEvents(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
  rawOptions: unknown = {},
): Promise<AnalyticsEvents> {
  const { categories } = markersOptionsSchema.parse(rawOptions ?? {});
  const { markers } = await getAnalyticsScopeSummary(db, scope, access);
  const wanted = new Set(categories);
  return { markers: (wanted.size > 0 ? markers.filter((m) => wanted.has(m.category)) : markers).slice().reverse() };
}
