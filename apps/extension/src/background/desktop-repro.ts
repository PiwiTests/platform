import { parseSteps } from '@piwitests/core/steps';
import { getConnectionSettings } from '../shared/connection-settings.js';
import { getDesktopSettings } from '../shared/desktop-settings.js';
import { fetchReproRequest, sendReproRequest, type ReproRequestState } from '../shared/piwi-client.js';
import { t } from '../shared/i18n.js';

/**
 * Run with Playwright: the requests to the paired desktop app, made here for
 * Replay's panels, which never hold its token and never reach the network. A
 * request carries steps, never code; the app shows it in its window and runs
 * nothing before the developer's click.
 */

export interface DesktopTargetAnswer {
  paired: boolean;
  url: string | null;
}

export async function handleDesktopTarget(): Promise<DesktopTargetAnswer> {
  const desktop = await getDesktopSettings();
  return { paired: !!desktop, url: desktop?.url ?? null };
}

export type DesktopReproAnswer = { ok: true; id: string; windowOpen: boolean } | { ok: false; error: string };

/** Sends the steps the developer confirmed in the preview, as they were shown. */
export async function handleDesktopRepro(message: {
  steps?: unknown;
  bugReportId?: unknown;
}): Promise<DesktopReproAnswer> {
  const desktop = await getDesktopSettings();
  if (!desktop) return { ok: false, error: t('replay_desktopNotPaired') };
  const parsed = parseSteps(message.steps);
  if (!parsed.ok) return { ok: false, error: t('common_replayNotSteps', { error: parsed.errors[0] ?? '' }) };
  const bugReportId =
    typeof message.bugReportId === 'number' && Number.isInteger(message.bugReportId) ? message.bugReportId : null;
  const instanceUrl = bugReportId ? (await getConnectionSettings()).instanceUrl.trim() || null : null;
  try {
    const sent = await sendReproRequest(desktop, {
      steps: parsed.steps,
      title: parsed.steps.title,
      options: { headed: true, trace: true },
      bugReportId,
      instanceUrl,
    });
    return { ok: true, ...sent };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type DesktopReproStatusAnswer = ({ ok: true } & ReproRequestState) | { ok: false; error: string };

export async function handleDesktopReproStatus(id: unknown): Promise<DesktopReproStatusAnswer> {
  const desktop = await getDesktopSettings();
  if (!desktop) return { ok: false, error: t('replay_desktopNotPaired') };
  if (typeof id !== 'string' || !/^[0-9a-f]{1,32}$/.test(id)) return { ok: false, error: t('replay_desktopExpired') };
  try {
    return { ok: true, ...(await fetchReproRequest(desktop, id)) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
