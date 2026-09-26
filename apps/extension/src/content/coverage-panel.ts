/**
 * The coverage overlay's side panel: the page's summary (interactive elements
 * reached by a test, the untested ones, the tests reaching the page), three
 * lists to explore it — tested elements, tests, untested elements — and the
 * display toggles. Collapses to a pill that keeps the summary in view.
 */
import { highlightLocator } from '@piwitests/picker-dom';
import { ALL_BRANCHES } from '@piwitests/core/locator-index';
import type { CoveredElement, UncoveredElement } from './coverage-scan.js';
import {
  ageLabel,
  isScoped,
  kindShown,
  plural,
  statusLabel,
  testTitle,
  worstStatus,
  type CoverageContext,
  type CoverageTab,
  type ViewState,
} from './coverage-view.js';
import { testCaseUrl } from '../shared/piwi-client.js';

export type PanelStatus = 'loading' | 'not-connected' | 'no-project' | 'error' | 'ready';

export interface PanelModel {
  status: PanelStatus;
  /** The page shows a modal dialog, which makes everything outside it inert, this panel included. */
  modalOpen: boolean;
  message: string | null;
  projectLabel: string | null;
  context: CoverageContext | null;
  fetchedAt: number | null;
  refreshing: boolean;
  refreshError: string | null;
  scanning: { done: number; total: number } | null;
  state: ViewState;
  /** The branch asked for: a name, `*` for every branch, null for the default branch. */
  branch: string | null;
  /** How the element the view is limited to reads in the lists. */
  scopeLabel: string | null;
  /** The view can widen to a container of that element before reaching the whole page. */
  canWiden: boolean;
}

export interface PanelCallbacks {
  onClose(): void;
  onCollapse(collapsed: boolean): void;
  onDock(): void;
  onRefresh(): void;
  /** '' for the default branch, `*` for every branch, else a branch. */
  onBranch(value: string): void;
  onOpenSettings(): void;
  onTab(tab: CoverageTab): void;
  onQuery(query: string): void;
  onToggle(key: 'showOperated' | 'showChecked' | 'showUncovered' | 'heatmap'): void;
  onElementHover(element: Element | null): void;
  onElementSelect(element: Element): void;
  onTestHover(test: number | null): void;
  onTestSelect(test: number): void;
  onChooseScope(): void;
  onCancelChoosing(): void;
  onWidenScope(): void;
  onClearScope(): void;
  onContainerHover(element: Element | null): void;
  onContainerSelect(element: Element): void;
  suggestLocator(element: Element): string | null;
}

/** Containers listed around the element the view is limited to. */
const AROUND_ROWS = 3;

/** Rows rendered per list, so a page with thousands of matches stays fast; the search narrows the rest. */
const MAX_ROWS = 300;
/** Untested rows that get a generated locator. */
const MAX_SUGGESTIONS = 60;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function copyText(text: string, button: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  const original = button.textContent;
  button.textContent = 'Copied';
  setTimeout(() => (button.textContent = original), 1200);
}

export class CoveragePanel {
  private readonly panel: HTMLElement;
  private readonly pill: HTMLButtonElement;
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly body: HTMLElement;
  private readonly foot: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly toggles = new Map<string, HTMLInputElement>();

  constructor(
    parent: ShadowRoot,
    private readonly callbacks: PanelCallbacks,
  ) {
    this.panel = el('aside', 'panel');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Piwi tested elements');

    const head = el('div', 'head');
    const titles = el('div');
    this.titleEl = el('div', 'title', 'Tested elements');
    this.subEl = el('div', 'sub');
    titles.append(this.titleEl, this.subEl);
    const icons = el('div', 'icons');
    const dock = this.iconButton('⇆', 'Move the panel to the other side', () => callbacks.onDock());
    const collapse = this.iconButton('–', 'Collapse to a summary pill', () => callbacks.onCollapse(true));
    const close = this.iconButton('×', 'Close (Esc)', () => callbacks.onClose());
    icons.append(dock, collapse, close);
    head.append(titles, icons);

    this.body = el('div', 'body');
    this.search = el('input', 'search');
    this.search.type = 'search';
    this.search.placeholder = 'Filter by element, test or file';
    this.search.setAttribute('aria-label', 'Filter the list');
    this.search.addEventListener('input', () => callbacks.onQuery(this.search.value));
    this.search.addEventListener('keydown', (e) => {
      // Escape clears the filter before it closes the overlay.
      if (e.key === 'Escape' && this.search.value) {
        e.stopPropagation();
        this.search.value = '';
        callbacks.onQuery('');
      }
    });

    this.foot = el('div', 'foot');
    const toggles = el('div', 'toggles');
    for (const [key, label, title] of [
      ['showOperated', 'Operated', 'Elements tests click, fill or otherwise act on'],
      ['showChecked', 'Checked', 'Elements tests only assert on'],
      ['showUncovered', 'Not tested', 'Interactive elements no test reaches'],
      ['heatmap', 'Heatmap', 'Shade each box by how many tests reach it'],
    ] as const) {
      const wrap = el('label');
      wrap.title = title;
      const input = el('input');
      input.type = 'checkbox';
      input.addEventListener('change', () => callbacks.onToggle(key));
      this.toggles.set(key, input);
      wrap.append(input, label);
      toggles.appendChild(wrap);
    }
    const legend = el('div', 'legend');
    for (const [cls, label] of [
      ['swatch operated', 'operated by tests'],
      ['swatch checked', 'checked only'],
      ['swatch uncovered', 'not tested'],
      ['dotted', 'ambiguous'],
    ] as const) {
      const item = el('span');
      item.append(el('span', cls), label);
      legend.appendChild(item);
    }
    this.foot.append(toggles, legend);

    this.panel.append(head, this.body, this.foot);
    parent.appendChild(this.panel);

    this.pill = el('button', 'pill');
    this.pill.type = 'button';
    this.pill.title = 'Expand the Piwi tested-elements panel';
    this.pill.addEventListener('click', () => callbacks.onCollapse(false));
    parent.appendChild(this.pill);
  }

  private iconButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = el('button', 'icon', text);
    button.type = 'button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', onClick);
    return button;
  }

  destroy(): void {
    this.panel.remove();
    this.pill.remove();
  }

  render(model: PanelModel): void {
    const { state } = model;
    this.panel.classList.toggle('left', state.dock === 'left');
    this.pill.classList.toggle('left', state.dock === 'left');
    this.panel.style.display = state.collapsed ? 'none' : '';
    this.pill.style.display = state.collapsed ? '' : 'none';
    for (const [key, input] of this.toggles) input.checked = state[key as keyof ViewState] === true;

    this.subEl.replaceChildren(model.projectLabel ? `${model.projectLabel} · Esc to close` : 'Esc to close');
    this.renderPill(model);

    const children: Node[] = [];
    if (model.status !== 'ready' || !model.context) {
      this.foot.style.display = 'none';
      children.push(...this.renderMessage(model));
      this.body.replaceChildren(...children);
      return;
    }
    this.foot.style.display = '';
    const context = model.context;
    if (model.modalOpen) {
      children.push(
        el(
          'p',
          'message',
          'The page shows a modal dialog: the boxes stay visible, but this panel can only be used once it closes.',
        ),
      );
    }
    children.push(...this.renderSummary(model, context));
    const around = this.renderAround(context);
    if (around) children.push(around);
    children.push(this.renderTabs(state.tab, context));
    children.push(this.search);
    if (this.search.value !== state.query) this.search.value = state.query;
    children.push(this.renderList(state, context));
    const notes = this.renderNotes(context);
    if (notes) children.push(notes);
    this.body.replaceChildren(...children);
  }

  private renderPill(model: PanelModel): void {
    const scan = model.context?.scan;
    this.pill.replaceChildren();
    const swatch = el('span', 'swatch');
    swatch.style.background = '#10b981';
    this.pill.appendChild(swatch);
    if (scan) {
      const total = scan.coveredInteractive + scan.uncoveredCount;
      this.pill.append(`Piwi · ${scan.coveredInteractive}/${total} tested · ${plural(scan.tests.length, 'test')}`);
    } else {
      this.pill.append('Piwi · tested elements');
    }
  }

  private renderMessage(model: PanelModel): Node[] {
    const out: Node[] = [];
    const message = el('p', model.status === 'error' ? 'message error' : 'message', model.message ?? '');
    out.push(message);
    if (model.status === 'not-connected' || model.status === 'no-project') {
      const button = el('button', 'primary', 'Open Piwi Picker settings');
      button.type = 'button';
      button.addEventListener('click', () => this.callbacks.onOpenSettings());
      out.push(button);
    } else if (model.status === 'error') {
      const button = el('button', 'primary', 'Try again');
      button.type = 'button';
      button.addEventListener('click', () => this.callbacks.onRefresh());
      out.push(button);
    }
    return out;
  }

  private renderSummary(model: PanelModel, context: CoverageContext): Node[] {
    const { scan, index } = context;
    const out: Node[] = [];
    const status = el('div', 'status-line');
    status.append(this.renderBranchSelect(model, context));
    status.append(`${plural(index.locators.length, 'locator')} from ${plural(index.tests.length, 'test')}`);
    if (model.fetchedAt) status.append(` · updated ${ageLabel(model.fetchedAt)}`);
    const refresh = el('button', 'link-button', model.refreshing ? 'Refreshing…' : 'Refresh');
    refresh.type = 'button';
    refresh.disabled = model.refreshing;
    refresh.title = 'Download the locator index again from Piwi';
    refresh.addEventListener('click', () => this.callbacks.onRefresh());
    status.append(' · ', refresh);
    out.push(status);
    if (model.refreshError) out.push(el('p', 'message error', `Couldn't refresh: ${model.refreshError}`));
    if (model.scanning) {
      const bar = el('div', 'progress');
      const fill = el('span');
      fill.style.width = `${model.scanning.total ? Math.round((model.scanning.done / model.scanning.total) * 100) : 0}%`;
      bar.appendChild(fill);
      bar.title = 'Checking the locators against this page';
      out.push(bar);
    }

    out.push(this.renderScopeBar(model));

    const where = isScoped(scan) ? 'inside it' : 'here';
    const total = scan.coveredInteractive + scan.uncoveredCount;
    const summary = el('div', 'summary');
    const tile = (cls: string, n: number, label: string, title: string) => {
      const t = el('div', `tile ${cls}`);
      t.title = title;
      t.append(el('div', 'n', String(n)), el('div', 'l', label));
      return t;
    };
    summary.append(
      tile(
        'operated',
        scan.coveredInteractive,
        'interactive tested',
        `Buttons, links and fields ${where} a test reaches`,
      ),
      tile('uncovered', scan.uncoveredCount, 'not tested', `Visible interactive elements ${where} no test reaches`),
      tile(
        'tests',
        scan.tests.length,
        scan.tests.length === 1 ? `test ${where}` : `tests ${where}`,
        `Tests whose locators resolve ${where === 'here' ? 'on this page' : where}`,
      ),
    );
    out.push(summary);
    const meter = el('div', 'meter');
    const fill = el('span');
    const percent = total ? Math.round((scan.coveredInteractive / total) * 100) : 0;
    fill.style.width = `${percent}%`;
    meter.appendChild(fill);
    meter.setAttribute('role', 'img');
    meter.setAttribute('aria-label', `${percent}% of interactive elements reached by a test`);
    out.push(meter);
    const checkedOnly = scan.covered.filter((c) => c.kind === 'checked').length;
    out.push(
      el(
        'div',
        'meter-label',
        total
          ? `${percent}% of the ${plural(total, 'interactive element')} ${where} · ${plural(scan.covered.length, 'element')} matched, ${checkedOnly} by assertions only`
          : `No interactive element ${where === 'here' ? 'on this page' : where} · ${plural(scan.covered.length, 'element')} matched`,
      ),
    );
    return out;
  }

  private renderBranchSelect(model: PanelModel, context: CoverageContext): HTMLSelectElement {
    const { index } = context;
    const select = el('select', 'branch-select');
    select.setAttribute('aria-label', 'Branch');
    select.title = 'The branch whose tests to show: tests that ran on it count with what they did there';
    const option = (value: string, label: string) => {
      const o = el('option', undefined, label);
      o.value = value;
      select.appendChild(o);
    };
    option('', index.defaultBranch ? `${index.defaultBranch} (default)` : 'Default branch');
    option(ALL_BRANCHES, 'All branches');
    for (const b of index.branches) option(b.name, `${b.name} · ${plural(b.tests, 'test')}`);
    const current = model.branch ?? '';
    if (![...select.options].some((o) => o.value === current)) option(current, current);
    select.value = current;
    select.addEventListener('change', () => this.callbacks.onBranch(select.value));
    return select;
  }

  private renderScopeBar(model: PanelModel): HTMLElement {
    const bar = el('div', 'scope-bar');
    const button = (text: string, title: string, onClick: () => void, disabled = false) => {
      const b = el('button', undefined, text);
      b.type = 'button';
      b.title = title;
      b.disabled = disabled;
      b.addEventListener('click', onClick);
      return b;
    };
    if (model.state.choosingScope) {
      const keys = el('span', 'keys');
      keys.append(
        el('kbd', undefined, '↑'),
        ' wider · ',
        el('kbd', undefined, '↓'),
        ' narrower · ',
        el('kbd', undefined, 'Esc'),
        ' cancels',
      );
      bar.append(
        el('span', 'what', 'Click a part of the page'),
        button('Cancel', 'Keep looking at the whole page (Esc)', () => this.callbacks.onCancelChoosing()),
        keys,
      );
      bar.dataset.mode = 'choosing';
    } else if (model.scopeLabel) {
      const what = el('span', 'what', `Inside ${model.scopeLabel}`);
      what.title = model.scopeLabel;
      bar.append(
        what,
        button('Container ↑', 'Look at the element around it', () => this.callbacks.onWidenScope(), !model.canWiden),
        button('Whole page', 'Look at the whole page again (Esc)', () => this.callbacks.onClearScope()),
      );
      bar.dataset.mode = 'scoped';
    } else {
      bar.append(
        el('span', 'what', 'Whole page'),
        button('Limit to an element', 'Pick a form, a card or a menu, and see only what is inside it', () =>
          this.callbacks.onChooseScope(),
        ),
      );
      bar.dataset.mode = 'page';
    }
    return bar;
  }

  /** The tested containers of the element the view is limited to: a test checking the card around a button. */
  private renderAround(context: CoverageContext): HTMLElement | null {
    const { scan } = context;
    if (!isScoped(scan) || scan.containers.length === 0) return null;
    const block = el('div', 'around');
    block.appendChild(el('div', 'hint', 'Around it: tests reach these containers'));
    const list = el('ul', 'rows');
    for (const c of scan.containers.slice(0, AROUND_ROWS)) {
      const row = this.row(
        (on) => this.callbacks.onContainerHover(on ? c.element : null),
        () => this.callbacks.onContainerSelect(c.element),
      );
      row.dataset.kind = c.kind;
      row.title = 'Look at this container';
      row.appendChild(el('span', `swatch ${c.kind}`));
      const label = el('span', 'label', c.description);
      row.appendChild(label);
      row.appendChild(el('span', 'count', plural(c.tests.length, 'test')));
      list.appendChild(row);
    }
    if (scan.containers.length > AROUND_ROWS) {
      list.appendChild(el('li', 'empty', `${scan.containers.length - AROUND_ROWS} more further out`));
    }
    block.appendChild(list);
    return block;
  }

  private renderTabs(tab: CoverageTab, context: CoverageContext): HTMLElement {
    const tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'What to list');
    const { scan } = context;
    for (const [id, label] of [
      ['elements', `Elements ${scan.covered.length}`],
      ['tests', `Tests ${scan.tests.length}`],
      ['untested', `Not tested ${scan.uncoveredCount}`],
    ] as const) {
      const button = el('button', 'tab', label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(tab === id));
      button.addEventListener('click', () => this.callbacks.onTab(id));
      tabs.appendChild(button);
    }
    return tabs;
  }

  private renderList(state: ViewState, context: CoverageContext): HTMLElement {
    const query = state.query.trim().toLowerCase();
    if (state.tab === 'tests') return this.renderTests(state, context, query);
    if (state.tab === 'untested') return this.renderUncovered(context.scan.uncovered, query, isScoped(context.scan));
    return this.renderCovered(state, context, query);
  }

  private rowsOrEmpty(rows: HTMLLIElement[], empty: string, total: number): HTMLElement {
    if (rows.length === 0) return el('div', 'empty', empty);
    const list = el('ul', 'rows');
    list.append(...rows);
    if (total > rows.length) {
      const more = el('li', 'empty', `${total - rows.length} more — filter to narrow the list`);
      list.appendChild(more);
    }
    return list;
  }

  private row(onHover: (on: boolean) => void, onSelect: () => void): HTMLLIElement {
    const row = el('li', 'row');
    row.tabIndex = 0;
    row.addEventListener('mouseenter', () => onHover(true));
    row.addEventListener('mouseleave', () => onHover(false));
    row.addEventListener('focus', () => onHover(true));
    row.addEventListener('blur', () => onHover(false));
    row.addEventListener('click', onSelect);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect();
      }
    });
    return row;
  }

  private renderCovered(state: ViewState, context: CoverageContext, query: string): HTMLElement {
    const { index, scan } = context;
    const matches = (c: CoveredElement) =>
      !query ||
      c.description.toLowerCase().includes(query) ||
      c.tests.some(
        (t) =>
          testTitle(index.tests[t]!).toLowerCase().includes(query) ||
          index.tests[t]!.file.toLowerCase().includes(query),
      ) ||
      c.matches.some((m) => index.locators[m.entry]!.locator.toLowerCase().includes(query));
    const shown = scan.covered.filter((c) => kindShown(state, c) && matches(c));
    const rows = shown.slice(0, MAX_ROWS).map((c) => {
      const row = this.row(
        (on) => this.callbacks.onElementHover(on ? c.element : null),
        () => this.callbacks.onElementSelect(c.element),
      );
      if (state.pinned === c.element) row.classList.add('active');
      row.dataset.kind = c.kind;
      row.appendChild(el('span', `swatch ${c.kind}`));
      const label = el('span', 'label', c.description);
      label.title = c.description;
      row.appendChild(label);
      const count = el('span', 'count', plural(c.tests.length, 'test'));
      const health = worstStatus(index, c.tests);
      if (health) count.title = health === 'failed' ? 'A test reaching it is failing' : 'A test reaching it is flaky';
      if (health) count.prepend(el('span', `dot ${health}`), ' ');
      row.appendChild(count);
      const first = index.locators[c.matches[0]!.entry]!.locator;
      const detail = el(
        'span',
        'detail mono',
        `${c.visible ? '' : 'hidden right now · '}${first}${c.matches.length > 1 ? ` +${c.matches.length - 1}` : ''}`,
      );
      detail.title = c.matches.map((m) => index.locators[m.entry]!.locator).join('\n');
      row.appendChild(detail);
      return row;
    });
    return this.rowsOrEmpty(
      rows,
      scan.covered.length === 0
        ? isScoped(scan)
          ? 'None of the project’s locators resolve inside it.'
          : 'None of the project’s locators resolve on this page. Its tests may use other pages, or this page in another state.'
        : 'Nothing matches the filter.',
      shown.length,
    );
  }

  private renderTests(state: ViewState, context: CoverageContext, query: string): HTMLElement {
    const { index, scan } = context;
    const shown = scan.tests.filter(({ test }) => {
      const t = index.tests[test]!;
      return !query || testTitle(t).toLowerCase().includes(query) || t.file.toLowerCase().includes(query);
    });
    const rows = shown.slice(0, MAX_ROWS).map(({ test, elements }) => {
      const t = index.tests[test]!;
      const row = this.row(
        (on) => this.callbacks.onTestHover(on ? test : null),
        () => this.callbacks.onTestSelect(test),
      );
      if (state.focusTest === test) row.classList.add('focused');
      const dot = el('span', `swatch dot ${t.status ?? 'unknown'}`);
      dot.style.borderRadius = '50%';
      dot.title = statusLabel(t.status);
      row.appendChild(dot);
      const label = el('span', 'label', testTitle(t));
      label.title = testTitle(t);
      row.appendChild(label);
      row.appendChild(el('span', 'count', plural(elements.length, 'element')));
      const detail = el('span', 'detail mono');
      const link = el('a', undefined, t.file);
      link.href = testCaseUrl(context.instanceUrl, t.id);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = 'Open this test in Piwi';
      link.style.color = 'inherit';
      link.addEventListener('click', (e) => e.stopPropagation());
      detail.appendChild(link);
      if (state.focusTest === test) detail.append(' · showing only its elements');
      row.appendChild(detail);
      return row;
    });
    return this.rowsOrEmpty(
      rows,
      scan.tests.length === 0
        ? isScoped(scan)
          ? 'No test reaches inside it.'
          : 'No test reaches this page.'
        : 'Nothing matches the filter.',
      shown.length,
    );
  }

  private renderUncovered(uncovered: UncoveredElement[], query: string, scoped: boolean): HTMLElement {
    const shown = uncovered.filter((u) => !query || u.description.toLowerCase().includes(query));
    const rows = shown.slice(0, MAX_ROWS).map((u, i) => {
      const row = this.row(
        (on) => this.callbacks.onElementHover(on ? u.element : null),
        () => this.callbacks.onElementSelect(u.element),
      );
      row.dataset.kind = 'uncovered';
      row.appendChild(el('span', 'swatch uncovered'));
      const label = el('span', 'label', u.description);
      label.title = u.description;
      row.appendChild(label);
      row.appendChild(el('span', 'count'));
      const suggestion = i < MAX_SUGGESTIONS ? this.callbacks.suggestLocator(u.element) : null;
      if (suggestion) {
        const code = el('code', 'piwi-loc');
        code.innerHTML = highlightLocator(suggestion);
        row.appendChild(code);
        const actions = el('div', 'row-actions');
        const copy = el('button', undefined, 'Copy locator');
        copy.type = 'button';
        copy.title = 'Copy this locator to write a test for the element';
        copy.addEventListener('click', (e) => {
          e.stopPropagation();
          void copyText(suggestion, copy);
        });
        actions.appendChild(copy);
        row.appendChild(actions);
      }
      return row;
    });
    return this.rowsOrEmpty(
      rows,
      uncovered.length === 0
        ? `Every visible interactive element ${scoped ? 'inside it' : 'here'} is reached by a test.`
        : 'Nothing matches the filter.',
      shown.length,
    );
  }

  private renderNotes(context: CoverageContext): HTMLElement | null {
    const { scan, index } = context;
    const items: Node[] = [];
    if (scan.unmatched) {
      items.push(
        el(
          'li',
          undefined,
          `${plural(scan.unmatched, 'locator')} match nothing here: they target other pages, or this page in another state.`,
        ),
      );
    }
    if (index.truncated)
      items.push(
        el('li', undefined, 'The project has more locators than the index carries; the least used are left out.'),
      );
    if (index.testIdAttributes?.length) {
      items.push(el('li', undefined, `getByTestId reads ${index.testIdAttributes.join(', ')} in this project.`));
    }
    items.push(
      el(
        'li',
        undefined,
        `Checked ${plural(scan.evaluated, 'locator')} in ${scan.durationMs} ms. Locators are matched on this page whatever page their test used them on.`,
      ),
    );
    if (scan.errors.length) {
      const errorItem = el('li', undefined, `${plural(scan.errors.length, 'locator')} could not be evaluated here:`);
      const list = el('ul');
      for (const error of scan.errors.slice(0, 20)) {
        const li = el('li');
        li.append(el('code', undefined, index.locators[error.entry]!.locator), ` — ${error.message}`);
        list.appendChild(li);
      }
      errorItem.appendChild(list);
      items.push(errorItem);
    }
    const details = el('details', 'notes');
    const summary = el(
      'summary',
      undefined,
      scan.errors.length ? `Notes · ${plural(scan.errors.length, 'locator')} not evaluated` : 'Notes',
    );
    const list = el('ul');
    list.append(...items);
    details.append(summary, list);
    return details;
  }
}
