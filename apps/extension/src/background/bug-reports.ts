import { parseBugReport } from '@piwitests/core/bug-report';
import { parseSteps, type PiwiSteps } from '@piwitests/core/steps';
import { getConnectionSettings, type ConnectionSettings } from '../shared/connection-settings.js';
import { getActiveProjectOverride, resolveActiveProject, type ActiveProject } from '../shared/active-project.js';
import {
  fetchBugReportIntake,
  fetchBugReports,
  fetchBugReportSteps,
  sendBugReport,
  type BugReportIntake,
  type BugReportSummary,
  type SentIssue,
} from '../shared/piwi-client.js';
import { dataUrlBytes } from '../shared/zip.js';
import { t } from '../shared/i18n.js';

/**
 * The bug-report requests to the connected instance, made here for the tab's
 * content scripts: they never hold the API key and never reach the network.
 * The project is always resolved again from the sending tab's URL.
 */

/** Set once a report has been sent from this browser profile, so the preview explains sending only the first time. */
const SEND_EXPLAINED_KEY = 'piwiBugSendExplained';

interface Target {
  settings: ConnectionSettings;
  project: ActiveProject | null;
}

async function targetFor(tab: chrome.tabs.Tab | undefined): Promise<Target | null> {
  const settings = await getConnectionSettings();
  if (!settings.instanceUrl.trim()) return null;
  const url = tab?.url ?? '';
  return { settings, project: resolveActiveProject(settings, await getActiveProjectOverride(), url) };
}

function instanceHost(settings: ConnectionSettings): string {
  try {
    return new URL(settings.instanceUrl).host;
  } catch {
    return settings.instanceUrl;
  }
}

export interface SendTargetAnswer {
  connected: boolean;
  project: { id: number; label: string } | null;
  instance: string | null;
  /** True until a report has been sent from this browser profile. */
  firstSend: boolean;
  /** What the project does with its tracker; null when it files nowhere or the tab maps to no project. */
  intake: BugReportIntake | null;
}

/** Where Send to Piwi would send a report from this tab, for the finish panel and its preview. */
export async function handleBugSendTarget(tab: chrome.tabs.Tab | undefined): Promise<SendTargetAnswer> {
  const target = await targetFor(tab);
  if (!target) return { connected: false, project: null, instance: null, firstSend: false, intake: null };
  const stored = await chrome.storage.local.get(SEND_EXPLAINED_KEY);
  const intake = target.project ? await fetchBugReportIntake(target.settings, target.project.projectId) : null;
  return {
    connected: true,
    project: target.project ? { id: target.project.projectId, label: target.project.projectLabel } : null,
    instance: instanceHost(target.settings),
    firstSend: stored[SEND_EXPLAINED_KEY] !== true,
    intake: intake?.tracker ? intake : null,
  };
}

export type SendBugReportAnswer =
  | { ok: true; id: number; url: string; issue: SentIssue | null }
  | { ok: false; error: string };

/** Sends the report the reporter confirmed in the preview, as it was shown. */
export async function handleSendBugReport(
  message: { report?: unknown; language?: unknown; screenshots?: unknown; createIssue?: unknown },
  tab: chrome.tabs.Tab | undefined,
): Promise<SendBugReportAnswer> {
  const target = await targetFor(tab);
  if (!target) return { ok: false, error: t('common_notConnected') };
  if (!target.project) return { ok: false, error: t('bug_sendNoProject') };
  const parsed = parseBugReport(message.report);
  if (!parsed.ok) return { ok: false, error: parsed.errors[0] ?? '' };
  const screenshots = (Array.isArray(message.screenshots) ? message.screenshots : []).flatMap((shot: unknown) => {
    const s = shot as { name?: unknown; dataUrl?: unknown };
    return typeof s.name === 'string' && typeof s.dataUrl === 'string' && s.dataUrl.startsWith('data:image/png;base64,')
      ? [{ name: s.name, bytes: dataUrlBytes(s.dataUrl) }]
      : [];
  });
  try {
    const sent = await sendBugReport(target.settings, target.project.projectId, {
      report: parsed.report,
      language: typeof message.language === 'string' ? message.language : null,
      createIssue: message.createIssue === true,
      screenshots,
    });
    await chrome.storage.local.set({ [SEND_EXPLAINED_KEY]: true });
    return { ok: true, ...sent };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type ListBugReportsAnswer =
  | { ok: true; project: { id: number; label: string } | null; items: BugReportSummary[] }
  | { ok: false; error: string };

/** The bug reports of the project this tab maps to, for Replay's chooser. */
export async function handleListBugReports(tab: chrome.tabs.Tab | undefined): Promise<ListBugReportsAnswer> {
  const target = await targetFor(tab);
  if (!target || !target.project) return { ok: true, project: null, items: [] };
  try {
    const items = await fetchBugReports(target.settings, target.project.projectId);
    return { ok: true, project: { id: target.project.projectId, label: target.project.projectLabel }, items };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type GetBugReportAnswer = { ok: true; steps: PiwiSteps } | { ok: false; error: string };

/** One report's steps, checked like a steps file from anywhere else. */
export async function handleGetBugReport(id: unknown): Promise<GetBugReportAnswer> {
  const settings = await getConnectionSettings();
  if (!settings.instanceUrl.trim()) return { ok: false, error: t('common_notConnected') };
  if (typeof id !== 'number' || !Number.isInteger(id)) return { ok: false, error: t('common_noProject') };
  try {
    const parsed = parseSteps(await fetchBugReportSteps(settings, id));
    if (!parsed.ok) return { ok: false, error: t('common_replayNotSteps', { error: parsed.errors[0] ?? '' }) };
    return { ok: true, steps: parsed.steps };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
