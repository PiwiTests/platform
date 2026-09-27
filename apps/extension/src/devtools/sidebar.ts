import { highlightLocator, LOCATOR_SYNTAX_CSS } from '@piwitests/picker-dom';
import { COPY_MODES, copyModeLabel, renderCopyMode } from '../shared/copy-modes.js';
import { stabilityRulesText } from '../shared/core-words.js';
import { describeSelection, type SelectionLocator, type SelectionRanking } from '../shared/devtools-selection.js';
import { initI18n, localizeDocument, t, tn, uiLanguage } from '../shared/i18n.js';
import { isValidPickName } from '../shared/session-export.js';
import { addSessionPick, getSessionPicks } from '../shared/session-storage.js';
import { copyText, requestSiteAccess } from './inspected.js';
import { rankDevtoolsSelection, type RankOutcome } from './selection.js';

/**
 * The Piwi pane of the Elements panel: the ranked, verified locators of the
 * node selected in DevTools, with the Pick results' copy actions and Add to
 * session. It ranks again when the selection changes and after the page
 * navigates.
 */

const content = document.getElementById('content') as HTMLElement;
const refreshBtn = document.getElementById('refresh') as HTMLButtonElement;

let generation = 0;

async function refresh(): Promise<void> {
  const current = ++generation;
  content.replaceChildren(note(t('devtools_ranking')));
  const outcome = await rankDevtoolsSelection().catch(
    (err: unknown): RankOutcome => ({ kind: 'failed', message: err instanceof Error ? err.message : String(err) }),
  );
  if (current !== generation) return;
  render(outcome);
}

function note(text: string, className = 'note'): HTMLElement {
  const el = document.createElement('p');
  el.className = className;
  el.textContent = text;
  return el;
}

function render(outcome: RankOutcome): void {
  switch (outcome.kind) {
    case 'restricted':
      content.replaceChildren(note(t('devtools_restricted')));
      return;
    case 'failed':
      content.replaceChildren(
        note(outcome.message ? t('devtools_rankFailed', { error: outcome.message }) : t('devtools_rankFailedPlain')),
      );
      return;
    case 'no-access': {
      const allow = document.createElement('button');
      allow.type = 'button';
      allow.className = 'primary';
      allow.textContent = t('devtools_allowSite');
      allow.addEventListener('click', () => {
        void requestSiteAccess(outcome.pattern).then((granted) => {
          if (granted) void refresh();
        });
      });
      content.replaceChildren(note(t('devtools_noAccess', { site: outcome.pattern.replace(/\/\*$/, '') })), allow);
      return;
    }
    case 'ranked':
      renderRanking(outcome.ranking);
  }
}

function renderRanking(ranking: SelectionRanking): void {
  if (ranking.status === 'none') {
    content.replaceChildren(note(t('devtools_selectElement')));
    return;
  }
  if (ranking.status === 'frame') {
    content.replaceChildren(note(t('devtools_inFrame')));
    return;
  }
  if (ranking.status === 'extension') {
    content.replaceChildren(note(t('devtools_ownElement')));
    return;
  }
  const heading = document.createElement('h2');
  heading.className = 'selection';
  heading.textContent = describeSelection(ranking);
  if (ranking.locators.length === 0) {
    content.replaceChildren(heading, note(t('devtools_noLocator')));
    return;
  }
  const list = document.createElement('ul');
  list.className = 'locators';
  for (const locator of ranking.locators) list.appendChild(locatorRow(locator, ranking));
  content.replaceChildren(heading, list);
}

/** `✓ unique · stable`, `3 matches · brittle`. */
function verdictText(locator: SelectionLocator): { text: string; good: boolean } {
  const stability =
    locator.stability === 'stable'
      ? t('devtools_stable')
      : locator.stability === 'brittle'
        ? t('devtools_brittle', { rules: stabilityRulesText(locator.rules, ', ') })
        : t('devtools_watch', { rules: stabilityRulesText(locator.rules, ', ') });
  switch (locator.verdict) {
    case 'unique':
    case 'narrowed':
      return { text: `✓ ${t('devtools_unique')} · ${stability}`, good: locator.stability !== 'brittle' };
    case 'position':
      return { text: `✓ ${t('devtools_byPosition')} · ${stability}`, good: false };
    case 'ambiguous':
      return { text: `${tn('devtools_matches', locator.count ?? 0)} · ${stability}`, good: false };
    case 'unchecked':
      return { text: `${t('devtools_unchecked')} · ${stability}`, good: false };
  }
}

function locatorRow(locator: SelectionLocator, ranking: Extract<SelectionRanking, { status: 'ranked' }>): HTMLElement {
  const row = document.createElement('li');
  row.className = 'locator';
  const code = document.createElement('code');
  code.className = 'piwi-loc';
  code.innerHTML = highlightLocator(locator.locator);
  const verdict = verdictText(locator);
  const badge = document.createElement('div');
  badge.className = verdict.good ? 'verdict good' : 'verdict warn';
  badge.textContent = verdict.text;

  const actions = document.createElement('div');
  actions.className = 'actions';
  for (const mode of COPY_MODES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = copyModeLabel(mode);
    btn.title = renderCopyMode(locator, mode);
    btn.addEventListener('click', () => {
      void copyText(renderCopyMode(locator, mode)).then((copied) => {
        if (copied) flash(btn, t('common_copied'));
      });
    });
    actions.appendChild(btn);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.textContent = t('devtools_addToSession');
  add.addEventListener('click', () => openSessionForm(row, locator.locator, ranking.pageUrl));
  actions.appendChild(add);

  row.append(code, badge, actions);
  return row;
}

function flash(btn: HTMLButtonElement, text: string): void {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
}

function openSessionForm(row: HTMLElement, locator: string, pageUrl: string): void {
  row.querySelector('form')?.remove();
  const form = document.createElement('form');
  form.className = 'session-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = t('session_namePlaceholder');
  input.setAttribute('aria-label', t('session_nameLabel'));
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'primary';
  save.textContent = t('common_save');
  const message = document.createElement('div');
  message.className = 'form-message';
  message.setAttribute('role', 'status');
  form.append(input, save, message);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const name = input.value.trim();
      if (!name) return void (message.textContent = t('session_nameRequired'));
      if (!isValidPickName(name)) return void (message.textContent = t('session_nameInvalid'));
      const picks = await getSessionPicks();
      if (picks.some((pick) => pick.name === name))
        return void (message.textContent = t('session_nameTaken', { name }));
      await addSessionPick({ name, locator, pageUrl });
      form.remove();
      row.appendChild(note(t('devtools_addedToSession', { name }), 'note added'));
    })();
  });
  row.appendChild(form);
  input.focus();
}

async function start(): Promise<void> {
  await initI18n();
  document.documentElement.lang = uiLanguage();
  const style = document.createElement('style');
  style.textContent = LOCATOR_SYNTAX_CSS;
  document.head.appendChild(style);
  localizeDocument();
  refreshBtn.addEventListener('click', () => void refresh());
  chrome.devtools.panels.elements.onSelectionChanged.addListener(() => void refresh());
  chrome.devtools.network.onNavigated.addListener(() => void refresh());
  await refresh();
}

void start();
