import { describeStepInWords } from '@piwitests/core/bug-report';
import { sessionFromSteps, type PiwiSteps } from '@piwitests/core/steps';
import { interfacePhrases } from '../shared/core-words.js';
import { formatNumber, t, uiLanguage } from '../shared/i18n.js';
import { DESKTOP_DIALOG_HOST_ID } from './record-ui.js';
import { verdictText, type ReplayVerdict } from './replay-core.js';
import { attachPanelShadow } from './panel-root.js';

/**
 * Run with Playwright: sends a report's steps to the paired desktop app, which
 * runs them in the developer's project once they confirm it in its window, and
 * shows the verdict here. The dialog first shows exactly what is sent (the
 * title and the steps, with their typed values) and sends nothing before
 * **Send**. The background worker makes the requests.
 */

type DesktopTarget = { paired: boolean; url: string | null };
type SendAnswer = { ok: true; id: string; windowOpen: boolean } | { ok: false; error: string };
type StatusAnswer =
  | {
      ok: true;
      status: 'waiting' | 'running' | 'done' | 'declined' | 'expired';
      verdict:
        | { kind: 'reproduced'; step: number; found: string | null }
        | { kind: 'not-reproduced' }
        | { kind: 'diverged'; step: number; reason: string }
        | { kind: 'completed' }
        | { kind: 'stopped' }
        | null;
    }
  | { ok: false; error: string };

/** How often the dialog asks the desktop app how the request stands. */
const POLL_MS = 2000;

async function ask<T>(message: Record<string, unknown>, fallback: T): Promise<T> {
  try {
    return ((await chrome.runtime.sendMessage(message)) as T | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}

/** The desktop app's verdict as Replay words its own. */
export function asReplayVerdict(verdict: NonNullable<Extract<StatusAnswer, { ok: true }>['verdict']>): ReplayVerdict {
  switch (verdict.kind) {
    case 'reproduced':
      return { kind: 'reproduced', step: verdict.step, found: verdict.found ?? '', sameAsReported: false };
    case 'diverged':
      return { kind: 'diverged', step: verdict.step, reason: verdict.reason };
    case 'stopped':
      return { kind: 'stopped', step: 0 };
    default:
      return verdict;
  }
}

export function openDesktopRun(steps: PiwiSteps, bugReportId: number | null, style: string): void {
  document.getElementById(DESKTOP_DIALOG_HOST_ID)?.remove();
  const host = document.createElement('div');
  host.id = DESKTOP_DIALOG_HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
  document.documentElement.appendChild(host);
  const root = attachPanelShadow(host, { mode: 'closed' });
  const css = document.createElement('style');
  css.textContent = `${style}
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: flex-start; justify-content: center; padding-top: 8vh; }
    pre { max-height: 180px; overflow: auto; font-size: 11px; white-space: pre-wrap; }`;
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';
  const panel = document.createElement('div');
  panel.className = 'box';
  panel.style.cssText = 'padding:16px;width:min(520px,92vw);';
  panel.setAttribute('role', 'dialog');
  panel.lang = uiLanguage();
  panel.setAttribute('aria-label', t('replay_desktopTitle'));
  let polling = true;
  const close = () => {
    polling = false;
    host.remove();
  };

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = t('replay_desktopTitle');
  const body = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'row';
  row.style.marginTop = '12px';
  const message = document.createElement('div');
  message.className = 'message';
  message.setAttribute('role', 'status');
  panel.append(title, body, row, message);

  const button = (label: string, onClick: () => void, className = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (className) b.className = className;
    b.addEventListener('click', onClick);
    return b;
  };
  const line = (text: string, className = 'sub') => {
    const d = document.createElement('div');
    d.className = className;
    d.textContent = text;
    return d;
  };

  const recorded = sessionFromSteps(steps, steps.origin ?? location.origin).steps;
  const phrases = interfacePhrases();

  const showVerdict = (answer: Extract<StatusAnswer, { ok: true }>) => {
    body.replaceChildren();
    row.replaceChildren(button(t('common_close'), close));
    if (answer.status === 'declined') body.append(line(t('replay_desktopDeclined')));
    else if (answer.status === 'expired') body.append(line(t('replay_desktopExpired')));
    else if (answer.verdict) {
      const verdict = asReplayVerdict(answer.verdict);
      const { title: verdictTitle, detail } = verdictText(verdict, recorded);
      const box = document.createElement('div');
      box.className = `verdict ${verdict.kind}`;
      box.append(line(verdictTitle, 'title'), line(detail, ''));
      body.append(line(t('replay_desktopRanIn')), box);
    }
  };

  const poll = async (id: string) => {
    while (polling && host.isConnected) {
      const answer = await ask<StatusAnswer>(
        { type: 'piwi-desktop-repro-status', id },
        {
          ok: false,
          error: t('common_workerNoAnswer'),
        },
      );
      if (!polling || !host.isConnected) return;
      if (!answer.ok) {
        message.textContent = answer.error;
      } else if (answer.status === 'done' || answer.status === 'declined' || answer.status === 'expired') {
        message.textContent = '';
        showVerdict(answer);
        return;
      } else {
        message.textContent = '';
        body.replaceChildren(line(t(answer.status === 'running' ? 'replay_desktopRunning' : 'replay_desktopWaiting')));
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  };

  const showPreview = (url: string) => {
    body.append(line(t('replay_desktopPreview', { url })));
    const list = document.createElement('div');
    list.className = 'steps';
    recorded.forEach((step, i) => {
      list.append(line(`${formatNumber(i + 1)}. ${describeStepInWords(step, phrases).replace(/`+/g, '')}`, 'step'));
    });
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = t('replay_desktopShowPayload');
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify({ title: steps.title, steps }, null, 2);
    details.append(summary, pre);
    body.append(list, details);
    const send = button(
      t('replay_desktopSend'),
      () => {
        send.disabled = true;
        void ask<SendAnswer>(
          { type: 'piwi-desktop-repro', steps, bugReportId },
          {
            ok: false,
            error: t('common_workerNoAnswer'),
          },
        ).then((answer) => {
          if (!answer.ok) {
            send.disabled = false;
            message.textContent = answer.error;
            return;
          }
          body.replaceChildren(line(t(answer.windowOpen ? 'replay_desktopWaiting' : 'replay_desktopNoWindow')));
          row.replaceChildren(button(t('common_close'), close));
          void poll(answer.id);
        });
      },
      'primary',
    );
    row.append(send, button(t('common_cancel'), close));
  };

  void ask<DesktopTarget>({ type: 'piwi-desktop-target' }, { paired: false, url: null }).then((target) => {
    if (target.paired && target.url) {
      showPreview(target.url);
      return;
    }
    body.append(line(t('replay_desktopNotPaired')));
    row.append(
      button(
        t('replay_desktopOpenOptions'),
        () => {
          void ask({ type: 'piwi-open-options' }, null);
          close();
        },
        'primary',
      ),
      button(t('common_cancel'), close),
    );
  });

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.appendChild(panel);
  root.append(css, backdrop);
}
