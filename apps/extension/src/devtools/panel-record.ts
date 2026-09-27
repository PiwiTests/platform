import { describeStepInWords } from '@piwitests/core/bug-report';
import { renderSpec } from '@piwitests/core/codegen';
import { buildSession, normalizeSteps, type RecordedStep } from '@piwitests/core/recording';
import { toStepsDocument } from '@piwitests/core/steps';
import { highlightLocator } from '@piwitests/picker-dom';
import { getActiveProjectOverride, resolveActiveProject } from '../shared/active-project.js';
import { getCachedCatalog } from '../shared/catalog-cache.js';
import { requestCatalogRefresh } from '../shared/catalog-refresh.js';
import { getConnectionSettings } from '../shared/connection-settings.js';
import { interfacePhrases } from '../shared/core-words.js';
import { t, tn } from '../shared/i18n.js';
import {
  discardRecording,
  getRecordingState,
  recordingMode,
  stopRecording,
  type RecordingState,
} from '../shared/recording-storage.js';
import { copyText, evalInPage } from './inspected.js';

/** A step in words, as the replay's panel says it, and the locator it was recorded with. */
export function stepRow(step: RecordedStep, prefix = ''): HTMLLIElement {
  const item = document.createElement('li');
  const words = document.createElement('div');
  words.className = 'step-words';
  words.textContent = `${prefix}${describeStepInWords(step, interfacePhrases()).replace(/`+/g, '')}`;
  item.appendChild(words);
  const locator = step.target?.alternatives[0]?.locator;
  if (locator) {
    const code = document.createElement('code');
    code.className = 'piwi-loc';
    code.innerHTML = highlightLocator(locator);
    item.appendChild(code);
  }
  return item;
}

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function flash(btn: HTMLButtonElement): void {
  const original = btn.textContent;
  btn.textContent = t('common_copied');
  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
}

function originOf(pattern: string | null): string {
  return pattern ? pattern.replace(/\/\*$/, '') : '';
}

/** The spec the review panel copies, with the active project's functions when the extension is connected. */
async function specFor(state: RecordingState): Promise<string> {
  const session = buildSession(normalizeSteps(state.events), state.events[0]?.timestamp ?? Date.now());
  const href = await evalInPage<string>('location.href');
  const pageUrl = href.ok && typeof href.value === 'string' ? href.value : (session.startUrl ?? '');
  const [connection, override] = await Promise.all([getConnectionSettings(), getActiveProjectOverride()]);
  const project = resolveActiveProject(connection, override, pageUrl);
  await requestCatalogRefresh(project?.projectId ?? null);
  const catalog = await getCachedCatalog(project?.projectId ?? null);
  return renderSpec(session, { catalog, urlChecks: true }).code;
}

function download(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function fileStamp(time: number): string {
  return new Date(time || Date.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-');
}

/**
 * The Record tab: the recording's steps as they are captured, with the review
 * panel's actions once it stops. It stops a recording the way the popup does;
 * a bug report is finished from its panel on the page, which collects the
 * evidence.
 */
export async function renderRecordTab(container: HTMLElement): Promise<void> {
  const state = await getRecordingState();
  const steps = normalizeSteps(state.events);
  const bug = recordingMode(state) === 'bug';
  if (!state.active && state.events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'note';
    empty.textContent = t('devtools_noRecording');
    container.replaceChildren(empty);
    return;
  }

  const status = document.createElement('p');
  status.className = 'status';
  status.setAttribute('role', 'status');
  const count = steps.length;
  status.textContent = state.active
    ? tn(bug ? 'devtools_bugRecordingOn' : 'devtools_recordingOn', count, {
        site: originOf(state.grantedOriginPattern),
      })
    : tn('devtools_recordingStopped', count);

  const controls = document.createElement('div');
  controls.className = 'controls';
  if (state.active && bug) {
    const hint = document.createElement('span');
    hint.className = 'note';
    hint.textContent = t('devtools_finishBugOnPage');
    controls.appendChild(hint);
  } else if (state.active) {
    controls.appendChild(
      button(
        t('devtools_stopRecording'),
        () => {
          void stopRecording().then(() =>
            chrome.runtime.sendMessage({ type: 'piwi-recording-stopped' }).catch(() => undefined),
          );
        },
        'stop',
      ),
    );
  } else if (!bug) {
    const copy = button(
      t('record_copyCode'),
      () => {
        void specFor(state).then((spec) => copyText(spec).then((copied) => copied && flash(copy)));
      },
      'primary',
    );
    const save = button(t('record_downloadSteps'), () => {
      const session = buildSession(steps, state.events[0]?.timestamp ?? Date.now());
      const doc = toStepsDocument(session);
      download(JSON.stringify(doc, null, 2), `piwi-steps-${fileStamp(doc.recordedAt)}.json`);
    });
    save.title = t('record_downloadStepsTitle');
    const discard = button(t('common_discard'), () => void discardRecording());
    controls.append(copy, save, discard);
  }

  const list = document.createElement('ol');
  list.className = 'steps';
  for (const step of steps) list.appendChild(stepRow(step));
  container.replaceChildren(status, controls, list);
}
