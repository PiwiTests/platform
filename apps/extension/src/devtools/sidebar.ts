import { highlightLocator, LOCATOR_SYNTAX_CSS } from '@piwitests/picker-dom';
import { COPY_MODES, copyModeLabel, renderCopyMode } from '../shared/copy-modes.js';
import { stabilityRulesText } from '../shared/core-words.js';
import { describeSelection, type SelectionLocator, type SelectionRanking } from '../shared/devtools-selection.js';
import { initI18n, localizeDocument, t, tn, uiLanguage } from '../shared/i18n.js';
import { isValidPickName } from '../shared/session-export.js';
import { addSessionPick, getSessionPicks } from '../shared/session-storage.js';
import { copyText, requestSiteAccess } from './inspected.js';
import { button, el, emptyState, flash, type IconName } from './ui.js';
import { rankDevtoolsSelection, type RankOutcome } from './selection.js';

/**
 * The Piwi pane of the Elements panel: the ranked, verified locators of the
 * node selected in DevTools, with the Pick results' copy actions and Add to
 * session. It ranks again when the selection changes and after the page
 * navigates.
 */

const content = document.getElementById('content') as HTMLElement;
const selection = document.getElementById('selection') as HTMLElement;
const refreshBtn = document.getElementById('refresh') as HTMLButtonElement;

let generation = 0;

async function refresh(): Promise<void> {
  const current = ++generation;
  refreshBtn.disabled = true;
  content.setAttribute('aria-busy', 'true');
  const outcome = await rankDevtoolsSelection().catch(
    (err: unknown): RankOutcome => ({ kind: 'failed', message: err instanceof Error ? err.message : String(err) }),
  );
  if (current !== generation) return;
  refreshBtn.disabled = false;
  content.removeAttribute('aria-busy');
  render(outcome);
}

function show(heading: SelectionRanking | null, ...nodes: HTMLElement[]): void {
  if (heading?.status === 'ranked') {
    const kind = el('span', 'role', heading.role ?? heading.tag);
    selection.replaceChildren(kind);
    if (heading.name) selection.append(el('span', 'sep', ' · '), el('span', '', heading.name));
    selection.title = describeSelection(heading);
  } else {
    selection.replaceChildren();
    selection.removeAttribute('title');
  }
  content.replaceChildren(...nodes);
}

function empty(name: IconName, text: string, ...actions: HTMLElement[]): HTMLElement {
  const box = emptyState(name, text, ...actions);
  box.classList.add('pane-empty');
  return box;
}

function render(outcome: RankOutcome): void {
  switch (outcome.kind) {
    case 'restricted':
      show(null, empty('blocked', t('devtools_restricted')));
      return;
    case 'failed':
      show(
        null,
        empty(
          'blocked',
          outcome.message ? t('devtools_rankFailed', { error: outcome.message }) : t('devtools_rankFailedPlain'),
        ),
      );
      return;
    case 'no-access': {
      const allow = button(
        t('devtools_allowSite'),
        () => {
          void requestSiteAccess(outcome.pattern).then((granted) => {
            if (granted) void refresh();
          });
        },
        'primary',
      );
      show(null, empty('lock', t('devtools_noAccess', { site: outcome.pattern.replace(/\/\*$/, '') }), allow));
      return;
    }
    case 'ranked':
      renderRanking(outcome.ranking);
  }
}

function renderRanking(ranking: SelectionRanking): void {
  if (ranking.status === 'none') return show(null, empty('select', t('devtools_selectElement')));
  if (ranking.status === 'frame') return show(null, empty('blocked', t('devtools_inFrame')));
  if (ranking.status === 'extension') return show(null, empty('blocked', t('devtools_ownElement')));
  if (ranking.locators.length === 0) return show(ranking, empty('blocked', t('devtools_noLocator')));
  const list = el('ul', 'locators');
  ranking.locators.forEach((locator, i) => list.appendChild(locatorRow(locator, ranking, i === 0)));
  show(ranking, list);
}

/** `✓ unique · stable`, `3 matches · brittle: CSS class`, and whether it reads as good or as a warning. */
function verdictText(locator: SelectionLocator): { text: string; tone: 'good' | 'warn' } {
  const stability =
    locator.stability === 'stable'
      ? t('devtools_stable')
      : locator.stability === 'brittle'
        ? t('devtools_brittle', { rules: stabilityRulesText(locator.rules, ', ') })
        : t('devtools_watch', { rules: stabilityRulesText(locator.rules, ', ') });
  switch (locator.verdict) {
    case 'unique':
    case 'narrowed':
      return {
        text: `✓ ${t('devtools_unique')} · ${stability}`,
        tone: locator.stability === 'brittle' ? 'warn' : 'good',
      };
    case 'position':
      return { text: `✓ ${t('devtools_byPosition')} · ${stability}`, tone: 'warn' };
    case 'ambiguous':
      return { text: `${tn('devtools_matches', locator.count ?? 0)} · ${stability}`, tone: 'warn' };
    case 'unchecked':
      return { text: `${t('devtools_unchecked')} · ${stability}`, tone: 'warn' };
  }
}

function locatorRow(
  locator: SelectionLocator,
  ranking: Extract<SelectionRanking, { status: 'ranked' }>,
  best: boolean,
): HTMLElement {
  const row = el('li', best && locator.verdict !== 'ambiguous' ? 'locator best' : 'locator');
  const code = el('code', 'piwi-loc');
  code.innerHTML = highlightLocator(locator.locator);
  const verdict = verdictText(locator);
  const badge = el('div', `locator-verdict badge ${verdict.tone}`, verdict.text);

  const actions = el('div', 'row-actions');
  actions.appendChild(el('span', 'copy-label', t('devtools_copyAs')));
  for (const mode of COPY_MODES) {
    const copy = button(
      copyModeLabel(mode),
      () => {
        void copyText(renderCopyMode(locator, mode)).then((copied) => {
          if (copied) flash(copy, t('common_copied'));
        });
      },
      'link',
    );
    copy.title = renderCopyMode(locator, mode);
    actions.appendChild(copy);
  }
  actions.appendChild(
    button(
      t('devtools_addToSession'),
      () => openSessionForm(row, locator.locator, ranking.pageUrl),
      'link add-to-session',
    ),
  );

  row.append(code, badge, actions);
  return row;
}

function openSessionForm(row: HTMLElement, locator: string, pageUrl: string): void {
  row.querySelector('form')?.remove();
  row.querySelector('.confirm')?.remove();
  const form = el('form', 'session-form');
  const input = el('input');
  input.type = 'text';
  input.placeholder = t('session_namePlaceholder');
  input.setAttribute('aria-label', t('session_nameLabel'));
  const save = el('button', 'primary', t('common_save'));
  save.type = 'submit';
  const cancel = button(t('common_cancel'), () => form.remove());
  const message = el('div', 'form-message');
  message.setAttribute('role', 'status');
  form.append(input, save, cancel, message);
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') form.remove();
  });
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
      row.appendChild(el('p', 'confirm', t('devtools_addedToSession', { name })));
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
