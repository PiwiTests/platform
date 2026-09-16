import { getAppSetting } from '../app-settings';
import { AUTO_HEAL_KEY, DEFAULT_AUTO_HEAL, resolveAutoHealSettings, type AutoHealSettings } from '#shared/auto-heal';
import type { DbClient } from '../../database';

/** Read the resolved auto-heal settings, falling back to the (disabled) defaults. */
export async function getAutoHealSettings(db: DbClient): Promise<AutoHealSettings> {
  const stored = await getAppSetting<Partial<AutoHealSettings>>(db, AUTO_HEAL_KEY);
  return stored ? resolveAutoHealSettings(stored) : { ...DEFAULT_AUTO_HEAL };
}

/** The dashboard's public URL (for links in the PR body), or null when unset. */
export function resolveHealSiteUrl(): string | null {
  const configured = process.env.PIWI_SITE_URL?.trim();
  return configured ? configured.replace(/\/$/, '') : null;
}
