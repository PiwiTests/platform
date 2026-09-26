import { eq } from 'drizzle-orm';
import { integrationConnections, projectIntegrations } from '../../server/database/schema';
import { getAppSetting } from '../../server/utils/app-settings';
import { LOCALE_SETTING_KEY } from '../i18n/locale-format';
import type { DrizzleDB } from '../handlers/db';
import { isReportLanguage, type ReportLanguage } from './format';

function fromLocale(locale: unknown): ReportLanguage | null {
  if (typeof locale !== 'string') return null;
  const lang = locale.trim().toLowerCase().slice(0, 2);
  return isReportLanguage(lang) ? lang : null;
}

/**
 * The default language of a quality report, reusing the ticket language of the
 * tracker integration: with one project in scope, its binding's language, then
 * its connection's default; otherwise the instance locale (`PIWI_LOCALE`, then
 * Settings → Localization) when it is French; else English.
 */
export async function resolveReportLanguage(db: DrizzleDB, projectIds: 'all' | number[]): Promise<ReportLanguage> {
  if (projectIds !== 'all' && projectIds.length === 1) {
    const [binding] = await db
      .select({ locale: projectIntegrations.locale, config: integrationConnections.config })
      .from(projectIntegrations)
      .innerJoin(integrationConnections, eq(projectIntegrations.connectionId, integrationConnections.id))
      .where(eq(projectIntegrations.projectId, projectIds[0]!))
      .limit(1);
    const bound = fromLocale(binding?.locale) ?? fromLocale((binding?.config as { locale?: string } | null)?.locale);
    if (bound) return bound;
  }
  const env = typeof process !== 'undefined' ? process.env?.PIWI_LOCALE : undefined;
  const stored = (await getAppSetting<{ value: string }>(db, LOCALE_SETTING_KEY))?.value;
  return fromLocale(env) ?? fromLocale(stored) ?? 'en';
}
