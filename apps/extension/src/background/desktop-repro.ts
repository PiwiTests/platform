import { parseSteps } from '@piwitests/core/steps';
import { getConnectionSettings } from '../shared/connection-settings.js';
import { getDesktopSettings } from '../shared/desktop-settings.js';
import { fetchReproRequest, sendReproRequest, type ReproRequestState } from '../shared/piwi-client.js';
import { sessionArea } from '../shared/session-area.js';
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

/** The reports sent to the desktop app in this browser session, most recent last: their verdicts may be shared. */
const DESKTOP_REPORTS_KEY = 'piwiDesktopRunReports';
const DESKTOP_REPORTS_KEPT = 20;

export async function desktopRunReports(): Promise<number[]> {
  const value = (await sessionArea().get(DESKTOP_REPORTS_KEY))[DESKTOP_REPORTS_KEY];
  return Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id)) : [];
}

async function keepDesktopRunReport(id: number): Promise<void> {
  const kept = (await desktopRunReports()).filter((other) => other !== id);
  await sessionArea().set({ [DESKTOP_REPORTS_KEY]: [...kept, id].slice(-DESKTOP_REPORTS_KEPT) });
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
    if (bugReportId) await keepDesktopRunReport(bugReportId).catch(() => undefined);
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
