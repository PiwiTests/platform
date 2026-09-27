import { sessionFromSteps } from '@piwitests/core/steps';
import { t } from '../shared/i18n.js';
import {
  getReplayState,
  updateReplayState,
  type ReplayState,
  type ReplayStepResult,
} from '../shared/replay-storage.js';
import { replayVerdict, verdictText } from '../content/replay-core.js';
import { stepRow } from './panel-record.js';

/** The message the replay script answers in each page of the replayed site: redraw its panel, and go on when `wake`. */
export const REPLAY_WAKE_MESSAGE = 'piwi-replay-wake';

/**
 * Tells the replay script, in every tab of the replayed site, that the state
 * changed. `wake` releases a wait for Next or Continue; a pause only redraws,
 * so the wake is not taken for a Next later.
 */
async function notifyReplay(origin: string, wake: boolean): Promise<void> {
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({ url: `${origin}/*` });
  } catch {
    return;
  }
  await Promise.all(
    tabs.map((tab) =>
      tab.id == null
        ? undefined
        : chrome.tabs.sendMessage(tab.id, { type: REPLAY_WAKE_MESSAGE, wake }).catch(() => undefined),
    ),
  );
}

function glyph(result: ReplayStepResult | undefined, current: boolean): string {
  if (current) return '▸ ';
  switch (result?.status) {
    case 'done':
    case 'passed':
      return '✓ ';
    case 'failed':
      return '✗ ';
    case 'diverged':
      return '! ';
    default:
      return '· ';
  }
}

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

async function change(state: ReplayState, next: Partial<ReplayState>, wake: boolean): Promise<void> {
  await updateReplayState((s) => ({ ...s, ...next }));
  await notifyReplay(state.origin, wake);
}

/**
 * The Replay tab: the replay's steps with their results, the locator each was
 * recorded with, and the verdict. Pause, Continue, Next step and Stop change
 * the stored state as the replay's panel on the page does, then tell that
 * panel.
 */
export async function renderReplayTab(container: HTMLElement): Promise<void> {
  const state = await getReplayState();
  if (!state) {
    const empty = document.createElement('p');
    empty.className = 'note';
    empty.textContent = t('devtools_noReplay');
    container.replaceChildren(empty);
    return;
  }
  const steps = sessionFromSteps(state.steps, state.origin).steps;
  const done = state.status === 'done' || state.status === 'stopped';

  const status = document.createElement('p');
  status.className = 'status';
  status.setAttribute('role', 'status');
  status.textContent = `${t(
    done ? 'replay_statusDone' : state.status === 'paused' ? 'replay_statusPaused' : 'replay_statusRunning',
  )} · ${state.origin}`;

  const controls = document.createElement('div');
  controls.className = 'controls';
  if (!done) {
    const paused = state.status === 'paused';
    controls.appendChild(
      button(paused ? t('replay_continue') : t('replay_pause'), () => {
        void change(state, { status: paused ? 'running' : 'paused' }, paused);
      }),
    );
    if (state.stepMode) {
      controls.appendChild(button(t('replay_nextStep'), () => void notifyReplay(state.origin, true), 'primary'));
    }
    controls.appendChild(button(t('common_stop'), () => void change(state, { status: 'stopped' }, true), 'stop'));
  }

  const parts: HTMLElement[] = [status, controls];
  if (done) {
    const verdict = verdictText(replayVerdict(steps, state.results, state.status === 'stopped'), steps);
    const box = document.createElement('div');
    box.className = 'verdict';
    const title = document.createElement('strong');
    title.textContent = verdict.title;
    const detail = document.createElement('div');
    detail.textContent = verdict.detail;
    box.append(title, detail);
    parts.push(box);
  }

  const list = document.createElement('ol');
  list.className = 'steps';
  steps.forEach((step, index) => {
    const result = state.results[index];
    const row = stepRow(step, glyph(result, !done && index === state.position));
    if (result?.status) row.dataset.status = result.status;
    if (result?.detail) {
      const detail = document.createElement('div');
      detail.className = 'detail';
      detail.textContent = result.detail;
      row.appendChild(detail);
    }
    list.appendChild(row);
  });
  parts.push(list);
  container.replaceChildren(...parts);
}
