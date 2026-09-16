/**
 * Client-side implementation of the wasted-time settings endpoints for demo
 * mode. Mirrors server/api/settings/wasted-waits.{get,put}.ts minus the
 * `PIWI_WASTED_WAIT_PATTERNS` env-var layer (`useRuntimeConfig` has no
 * browser/service-worker equivalent) — the demo is always `envManaged: false`.
 */

import { getDemoDb } from '../db.client';
import { getAppSetting, setAppSetting, deleteAppSetting } from '~~/server/utils/app-settings';
import {
  DEFAULT_WASTED_WAIT_PATTERNS,
  WASTED_WAIT_PATTERNS_KEY,
  parseWastedWaitPatterns,
  resolveStoredWastedPatterns,
} from '#shared/utils/wasted-waits';
import {
  DEFAULT_TIMEOUT_THRESHOLDS,
  TIMEOUT_THRESHOLDS_KEY,
  resolveTimeoutThresholds,
  type TimeoutThresholds,
} from '#shared/analytics/timeout-hygiene';
import {
  DEFAULT_PR_FEEDBACK,
  PR_FEEDBACK_KEY,
  resolvePrFeedbackSettings,
  type PrFeedbackSettings,
} from '#shared/pr-feedback';
import { AUTO_HEAL_KEY, DEFAULT_AUTO_HEAL, resolveAutoHealSettings, type AutoHealSettings } from '#shared/auto-heal';

/** GET /api/settings/wasted-waits */
export async function apiGetWastedWaits() {
  const db = await getDemoDb();
  const stored = await getAppSetting<{ value: string[] }>(db, WASTED_WAIT_PATTERNS_KEY);
  return { ...resolveStoredWastedPatterns(stored), envManaged: false, defaults: [...DEFAULT_WASTED_WAIT_PATTERNS] };
}

/** PUT /api/settings/wasted-waits */
export async function apiPutWastedWaits(body: { patterns?: string[] | string | null }) {
  const db = await getDemoDb();

  if (body.patterns === null) {
    await deleteAppSetting(db, WASTED_WAIT_PATTERNS_KEY);
  } else {
    const patterns = parseWastedWaitPatterns(body.patterns);
    await setAppSetting(db, WASTED_WAIT_PATTERNS_KEY, { value: patterns });
  }

  const stored = await getAppSetting<{ value: string[] }>(db, WASTED_WAIT_PATTERNS_KEY);
  return { ...resolveStoredWastedPatterns(stored), envManaged: false, defaults: [...DEFAULT_WASTED_WAIT_PATTERNS] };
}

/** GET /api/settings/timeout-hygiene */
export async function apiGetTimeoutHygiene() {
  const db = await getDemoDb();
  const stored = await getAppSetting<Partial<TimeoutThresholds>>(db, TIMEOUT_THRESHOLDS_KEY);
  return { thresholds: resolveTimeoutThresholds(stored), defaults: DEFAULT_TIMEOUT_THRESHOLDS };
}

/** PUT /api/settings/timeout-hygiene */
export async function apiPutTimeoutHygiene(body: { thresholds?: Partial<TimeoutThresholds> | null }) {
  const db = await getDemoDb();

  if (body.thresholds === null) {
    await deleteAppSetting(db, TIMEOUT_THRESHOLDS_KEY);
  } else {
    await setAppSetting(db, TIMEOUT_THRESHOLDS_KEY, resolveTimeoutThresholds(body.thresholds));
  }

  const stored = await getAppSetting<Partial<TimeoutThresholds>>(db, TIMEOUT_THRESHOLDS_KEY);
  return { thresholds: resolveTimeoutThresholds(stored), defaults: DEFAULT_TIMEOUT_THRESHOLDS };
}

/**
 * GET /api/settings/pr-feedback
 *
 * The demo has no SCM to post to, so `siteUrlConfigured` is always false —
 * the page renders its "nothing will be posted" notice, which is the honest
 * state for a dashboard running entirely in a browser tab.
 */
export async function apiGetPrFeedback() {
  const db = await getDemoDb();
  const stored = await getAppSetting<Partial<PrFeedbackSettings>>(db, PR_FEEDBACK_KEY);
  return {
    settings: stored ? resolvePrFeedbackSettings(stored) : { ...DEFAULT_PR_FEEDBACK },
    defaults: DEFAULT_PR_FEEDBACK,
    siteUrlConfigured: false,
  };
}

/** PUT /api/settings/pr-feedback */
export async function apiPutPrFeedback(body: { settings?: Partial<PrFeedbackSettings> | null }) {
  const db = await getDemoDb();

  if (body.settings === null) {
    await deleteAppSetting(db, PR_FEEDBACK_KEY);
  } else {
    await setAppSetting(db, PR_FEEDBACK_KEY, resolvePrFeedbackSettings(body.settings));
  }

  const stored = await getAppSetting<Partial<PrFeedbackSettings>>(db, PR_FEEDBACK_KEY);
  return {
    settings: stored ? resolvePrFeedbackSettings(stored) : { ...DEFAULT_PR_FEEDBACK },
    defaults: DEFAULT_PR_FEEDBACK,
    siteUrlConfigured: false,
  };
}

/**
 * GET /api/settings/auto-heal
 *
 * The demo has no SCM to open a PR against, so `siteUrlConfigured` is always
 * false — settings save, but nothing is ever pushed from a browser tab.
 */
export async function apiGetAutoHeal() {
  const db = await getDemoDb();
  const stored = await getAppSetting<Partial<AutoHealSettings>>(db, AUTO_HEAL_KEY);
  return {
    settings: stored ? resolveAutoHealSettings(stored) : { ...DEFAULT_AUTO_HEAL },
    defaults: DEFAULT_AUTO_HEAL,
    siteUrlConfigured: false,
  };
}

/** PUT /api/settings/auto-heal */
export async function apiPutAutoHeal(body: { settings?: Partial<AutoHealSettings> | null }) {
  const db = await getDemoDb();

  if (body.settings === null) {
    await deleteAppSetting(db, AUTO_HEAL_KEY);
  } else {
    await setAppSetting(db, AUTO_HEAL_KEY, resolveAutoHealSettings(body.settings));
  }

  const stored = await getAppSetting<Partial<AutoHealSettings>>(db, AUTO_HEAL_KEY);
  return {
    settings: stored ? resolveAutoHealSettings(stored) : { ...DEFAULT_AUTO_HEAL },
    defaults: DEFAULT_AUTO_HEAL,
    siteUrlConfigured: false,
  };
}

/**
 * GET /api/heal-actions
 *
 * Auto-heal opens PRs through the SCM, which the browser demo has no access to,
 * so there is never anything to list.
 */
export async function apiGetHealActions() {
  return { actions: [] as never[] };
}
