import { t } from '../shared/i18n.js';

/**
 * Share result: records a verdict on the bug report it came from, on the
 * connected instance. The button first shows what goes where (the verdict, the
 * site it ran on, the browser) and sends only on **Send**; the background
 * worker makes the request.
 */

export interface SharedVerdict {
  bugReportId: number;
  source: 'replay' | 'desktop';
  verdict: 'reproduced' | 'not-reproduced' | 'diverged';
  /** The step it diverged at, 0-based. */
  divergedAt: number | null;
  /** The site the steps ran on, for a replay; null for a desktop run. */
  origin: string | null;
}

/** The verdicts a report records: a replay that completed or stopped says nothing about the bug. */
export function shareable(kind: string): kind is SharedVerdict['verdict'] {
  return kind === 'reproduced' || kind === 'not-reproduced' || kind === 'diverged';
}

async function ask<T>(message: Record<string, unknown>, fallback: T): Promise<T> {
  try {
    return ((await chrome.runtime.sendMessage(message)) as T | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}

/** The Share result row, to append under a verdict. */
export function shareResultRow(shared: SharedVerdict): HTMLElement {
  const row = document.createElement('div');
  row.className = 'share';
  const say = (text: string, role: 'status' | 'alert' = 'status') => {
    const line = document.createElement('div');
    line.className = 'sub';
    line.setAttribute('role', role);
    line.textContent = text;
    return line;
  };
  const button = (label: string, onClick: () => void, className = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (className) b.className = className;
    b.addEventListener('click', onClick);
    return b;
  };

  const start = () =>
    row.replaceChildren(
      button(t('replay_share'), () => {
        void ask<{ instance: string | null }>({ type: 'piwi-share-target' }, { instance: null }).then(
          ({ instance }) => {
            if (!instance) return row.replaceChildren(say(t('common_notConnected'), 'alert'));
            const preview = shared.origin
              ? t('replay_sharePreview', { instance, origin: shared.origin })
              : t('replay_sharePreviewDesktop', { instance });
            row.replaceChildren(say(preview), send(), button(t('common_cancel'), start));
          },
        );
      }),
    );
  const send = () => {
    const b = button(
      t('replay_desktopSend'),
      () => {
        b.disabled = true;
        void ask<{ ok: boolean; error?: string }>(
          { type: 'piwi-share-reproduction', ...shared },
          { ok: false, error: t('common_workerNoAnswer') },
        ).then((answer) => {
          row.replaceChildren(
            answer.ok ? say(t('replay_shared')) : say(t('replay_shareFailed', { error: answer.error ?? '' }), 'alert'),
          );
        });
      },
      'primary',
    );
    return b;
  };
  start();
  return row;
}
