import { highlightLocator } from '@piwitests/picker-dom';
import { t, tn } from '../shared/i18n.js';
import { renderFixture, renderJson, renderMarkdown } from '../shared/session-export.js';
import { clearSessionPicks, getSessionPicks, removeSessionPick } from '../shared/session-storage.js';
import { copyText } from './inspected.js';
import { viewHead } from './panel-record.js';
import { button, el, emptyState, flash } from './ui.js';

/**
 * The Session tab: the elements named so far with Add to session in the
 * Elements sidebar, kept in session storage. Copies them as a page object, a
 * Markdown table or JSON.
 */

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export async function renderSessionTab(container: HTMLElement): Promise<void> {
  const picks = await getSessionPicks();
  if (picks.length === 0) {
    container.replaceChildren(emptyState('select', t('devtools_sessionEmpty')));
    return;
  }
  const copies = [
    [t('session_copyPageObject'), () => renderFixture(picks)],
    [t('session_copyMarkdown'), () => renderMarkdown(picks)],
    [t('session_copyJson'), () => renderJson(picks)],
  ] as const;
  const actions: HTMLElement[] = copies.map(([label, render], i) => {
    const copy = button(
      label,
      () => {
        void copyText(render()).then((copied) => {
          if (copied) flash(copy, t('common_copied'));
        });
      },
      i === 0 ? 'primary' : '',
    );
    return copy;
  });
  actions.push(button(t('session_clear'), () => void clearSessionPicks(), 'danger'));

  const list = el('ol', 'steps');
  for (const pick of picks) {
    const row = el('li');
    const code = el('code', 'piwi-loc');
    code.innerHTML = highlightLocator(pick.locator);
    row.append(
      el('span', 'glyph'),
      el('div', 'step-words', pick.name),
      code,
      el('div', 'detail', pathOf(pick.pageUrl)),
    );
    const remove = button(t('devtools_remove'), () => void removeSessionPick(pick.name), 'link reveal');
    remove.setAttribute('aria-label', t('session_remove', { name: pick.name }));
    row.appendChild(remove);
    list.appendChild(row);
  }
  container.replaceChildren(viewHead('', tn('devtools_sessionCount', picks.length), ...actions), list);
}
