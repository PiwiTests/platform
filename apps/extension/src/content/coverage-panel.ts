/**
 * The coverage overlay's side panel: the page's summary (interactive elements
 * reached by a test, the untested ones, the tests reaching the page), three
 * lists to explore it — tested elements, tests, untested elements — and the
 * display toggles. Collapses to a pill that keeps the summary in view.
 */
import { highlightLocator } from '@piwitests/picker-dom';
import { ALL_BRANCHES } from '@piwitests/core/locator-index';
import { actionLabel, stabilityText } from '../shared/core-words.js';
import { editText, type BrittleRow, type PageRiskRow, type Replacement } from './coverage-risk.js';
import type { CoveredElement, UncoveredElement } from './coverage-scan.js';
import {
  ageLabel,
  isScoped,
  isSingular,
  kindShown,
  riskCount,
  statusLabel,
  testTitle,
  worstStatus,
  type CoverageContext,
  type CoverageTab,
  type ViewState,
} from './coverage-view.js';
import { testCaseUrl } from '../shared/piwi-client.js';
import { formatNumber, t, tn, tNodes, uiLanguage } from '../shared/i18n.js';

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
  onToggle(key: 'showOperated' | 'showChecked' | 'showUncovered' | 'heatmap' | 'showBrittle'): void;
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
  /** A replacement for the chain at `entry`, which finds only `element` here. */
  replacementFor(element: Element, entry: number): Replacement | null;
  /** Count what tests do on this page only, or on every page. */
  onPageScope(scope: 'page' | 'all'): void;
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
  button.textContent = t('common_copied');
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
    this.panel.lang = uiLanguage();
    this.panel.setAttribute('aria-label', t('coverage_panelLabel'));

    const head = el('div', 'head');
    const titles = el('div');
    this.titleEl = el('div', 'title', t('coverage_title'));
    this.subEl = el('div', 'sub');
    titles.append(this.titleEl, this.subEl);
    const icons = el('div', 'icons');
    const dock = this.iconButton('⇆', t('coverage_dock'), () => callbacks.onDock());
    const collapse = this.iconButton('–', t('coverage_collapse'), () => callbacks.onCollapse(true));
    const close = this.iconButton('×', t('coverage_closeEsc'), () => callbacks.onClose());
    icons.append(dock, collapse, close);
    head.append(titles, icons);

    this.body = el('div', 'body');
    this.search = el('input', 'search');
    this.search.type = 'search';
    this.search.placeholder = t('coverage_search');
    this.search.setAttribute('aria-label', t('coverage_searchLabel'));
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
      ['showOperated', t('coverage_toggleActed'), t('coverage_toggleActedTitle')],
      ['showChecked', t('coverage_toggleChecked'), t('coverage_toggleCheckedTitle')],
      ['showUncovered', t('coverage_toggleUntested'), t('coverage_toggleUntestedTitle')],
      ['heatmap', t('coverage_toggleHeat'), t('coverage_toggleHeatTitle')],
      ['showBrittle', t('coverage_toggleBrittle'), t('coverage_toggleBrittleTitle')],
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
      ['swatch operated', t('coverage_legendActed')],
      ['swatch checked', t('coverage_legendChecked')],
      ['swatch uncovered', t('coverage_legendUntested')],
      ['dotted', t('coverage_legendAmbiguous')],
      ['swatch brittle', t('coverage_legendBrittle')],
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
    this.pill.lang = uiLanguage();
    this.pill.title = t('coverage_expand');
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

    const page =
      model.context?.pageKey && model.context.prefixRemoved
        ? t('coverage_subtitleWithoutPrefix', { page: model.context.pageKey, prefix: model.context.prefixRemoved })
        : model.context?.pageKey;
    const where = [model.projectLabel, page].filter(Boolean).join(' · ');
    this.subEl.replaceChildren(where ? `${where} · ${t('common_escToClose')}` : t('common_escToClose'));
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
      children.push(el('p', 'message', t('coverage_modalOpen')));
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
      this.pill.append(
        tn('coverage_pill', scan.coveredInteractive, {
          total: formatNumber(total),
          tests: tn('coverage_testCount', scan.tests.length),
        }),
      );
      // Tests find these as soon as the page loads: the strongest sign a test will fail here.
      const missing = model.context!.missing.filter((row) => row.arrival).length;
      if (missing) this.pill.append(` · ${tn('coverage_pillMissing', missing)}`);
    } else {
      this.pill.append(t('coverage_pillIdle'));
    }
  }

  private renderMessage(model: PanelModel): Node[] {
    const out: Node[] = [];
    const message = el('p', model.status === 'error' ? 'message error' : 'message', model.message ?? '');
    out.push(message);
    if (model.status === 'not-connected' || model.status === 'no-project') {
      const button = el('button', 'primary', t('coverage_openSettings'));
      button.type = 'button';
      button.addEventListener('click', () => this.callbacks.onOpenSettings());
      out.push(button);
    } else if (model.status === 'error') {
      const button = el('button', 'primary', t('coverage_tryAgain'));
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
    status.append(
      tn('coverage_indexSize', index.locators.length, { tests: tn('coverage_testCount', index.tests.length) }),
    );
    if (model.fetchedAt) status.append(` · ${t('coverage_updated', { age: ageLabel(model.fetchedAt) })}`);
    const refresh = el('button', 'link-button', model.refreshing ? t('common_refreshing') : t('common_refresh'));
    refresh.type = 'button';
    refresh.disabled = model.refreshing;
    refresh.title = t('coverage_refreshTitle');
    refresh.addEventListener('click', () => this.callbacks.onRefresh());
    status.append(' · ', refresh);
    out.push(status);
    if (model.refreshError)
      out.push(el('p', 'message error', t('coverage_refreshFailed', { error: model.refreshError })));
    if (model.scanning) {
      const bar = el('div', 'progress');
      const fill = el('span');
      fill.style.width = `${model.scanning.total ? Math.round((model.scanning.done / model.scanning.total) * 100) : 0}%`;
      bar.appendChild(fill);
      bar.title = t('coverage_checking');
      out.push(bar);
    }

    const pageSwitch = this.renderPageSwitch(model, context);
    if (pageSwitch) out.push(pageSwitch);
    out.push(this.renderScopeBar(model));

    const inside = isScoped(scan);
    const total = scan.coveredInteractive + scan.uncoveredCount;
    const summary = el('div', 'summary');
    const tile = (cls: string, n: number, label: string, title: string) => {
      const box = el('div', `tile ${cls}`);
      box.title = title;
      box.append(el('div', 'n', formatNumber(n)), el('div', 'l', label));
      return box;
    };
    const oneTest = isSingular(scan.tests.length);
    summary.append(
      tile(
        'operated',
        scan.coveredInteractive,
        t('coverage_tileTested'),
        inside ? t('coverage_tileTestedTitleInside') : t('coverage_tileTestedTitle'),
      ),
      tile(
        'uncovered',
        scan.uncoveredCount,
        t('coverage_tileUntested'),
        inside ? t('coverage_tileUntestedTitleInside') : t('coverage_tileUntestedTitle'),
      ),
      tile(
        'tests',
        scan.tests.length,
        inside
          ? t(oneTest ? 'coverage_tileTestInside' : 'coverage_tileTestsInside')
          : t(oneTest ? 'coverage_tileTestHere' : 'coverage_tileTestsHere'),
        inside ? t('coverage_tileTestsTitleInside') : t('coverage_tileTestsTitle'),
      ),
    );
    out.push(summary);
    const meter = el('div', 'meter');
    const fill = el('span');
    const percent = total ? Math.round((scan.coveredInteractive / total) * 100) : 0;
    fill.style.width = `${percent}%`;
    meter.appendChild(fill);
    meter.setAttribute('role', 'img');
    meter.setAttribute('aria-label', t('coverage_meterLabel', { percent: formatNumber(percent) }));
    out.push(meter);
    const checkedOnly = scan.covered.filter((c) => c.kind === 'checked').length;
    const brittle = context.brittleElements.size;
    const parts = total
      ? [
          tn(inside ? 'coverage_meterShareInside' : 'coverage_meterShare', total, { percent: formatNumber(percent) }),
          tn('coverage_meterFound', scan.covered.length, { checked: formatNumber(checkedOnly) }),
        ]
      : [
          inside ? t('coverage_meterNoneInside') : t('coverage_meterNone'),
          tn('coverage_meterFoundOnly', scan.covered.length),
        ];
    if (brittle) parts.push(tn('coverage_meterBrittle', brittle));
    out.push(el('div', 'meter-label', parts.join(' · ')));
    return out;
  }

  /** This page / All pages, when the index records the page each use was made on. */
  private renderPageSwitch(model: PanelModel, context: CoverageContext): HTMLElement | null {
    if (!context.hasPages) return null;
    const bar = el('div', 'page-switch');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', t('coverage_pageSwitch'));
    for (const [scope, label, title] of [
      ['page', t('coverage_thisPage'), t('coverage_thisPageTitle')],
      ['all', t('coverage_allPages'), t('coverage_allPagesTitle')],
    ] as const) {
      const button = el('button', 'tab', label);
      button.type = 'button';
      button.title = title;
      button.setAttribute('aria-pressed', String(model.state.pageScope === scope));
      button.addEventListener('click', () => this.callbacks.onPageScope(scope));
      bar.appendChild(button);
    }
    return bar;
  }

  private renderBranchSelect(model: PanelModel, context: CoverageContext): HTMLSelectElement {
    const { index } = context;
    const select = el('select', 'branch-select');
    select.setAttribute('aria-label', t('coverage_branch'));
    select.title = t('coverage_branchTitle');
    const option = (value: string, label: string) => {
      const o = el('option', undefined, label);
      o.value = value;
      select.appendChild(o);
    };
    option(
      '',
      index.defaultBranch
        ? t('coverage_branchDefaultNamed', { branch: index.defaultBranch })
        : t('coverage_branchDefault'),
    );
    option(ALL_BRANCHES, t('coverage_branchAll'));
    for (const b of index.branches) option(b.name, `${b.name} · ${tn('coverage_testCount', b.tests)}`);
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
        ...tNodes('coverage_choosingKeys', {
          up: el('kbd', undefined, '↑'),
          down: el('kbd', undefined, '↓'),
          esc: el('kbd', undefined, t('coverage_escKey')),
        }),
      );
      bar.append(
        el('span', 'what', t('coverage_clickPart')),
        button(t('common_cancel'), t('coverage_cancelChoosingTitle'), () => this.callbacks.onCancelChoosing()),
        keys,
      );
      bar.dataset.mode = 'choosing';
    } else if (model.scopeLabel) {
      const what = el('span', 'what', t('coverage_inside', { element: model.scopeLabel }));
      what.title = model.scopeLabel;
      bar.append(
        what,
        button(t('coverage_widen'), t('coverage_widenTitle'), () => this.callbacks.onWidenScope(), !model.canWiden),
        button(t('coverage_wholePage'), t('coverage_wholePageTitle'), () => this.callbacks.onClearScope()),
      );
      bar.dataset.mode = 'scoped';
    } else {
      bar.append(
        el('span', 'what', t('coverage_wholePage')),
        button(t('coverage_limit'), t('coverage_limitTitle'), () => this.callbacks.onChooseScope()),
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
    block.appendChild(el('div', 'hint', t('coverage_aroundHint')));
    const list = el('ul', 'rows');
    for (const c of scan.containers.slice(0, AROUND_ROWS)) {
      const row = this.row(
        (on) => this.callbacks.onContainerHover(on ? c.element : null),
        () => this.callbacks.onContainerSelect(c.element),
      );
      row.dataset.kind = c.kind;
      row.title = t('coverage_aroundRowTitle');
      row.appendChild(el('span', `swatch ${c.kind}`));
      const label = el('span', 'label', c.description);
      row.appendChild(label);
      row.appendChild(el('span', 'count', tn('coverage_testCount', c.tests.length)));
      list.appendChild(row);
    }
    if (scan.containers.length > AROUND_ROWS) {
      list.appendChild(el('li', 'empty', tn('coverage_aroundMore', scan.containers.length - AROUND_ROWS)));
    }
    block.appendChild(list);
    return block;
  }

  private renderTabs(tab: CoverageTab, context: CoverageContext): HTMLElement {
    const tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', t('coverage_tabs'));
    const { scan } = context;
    for (const [id, label] of [
      ['elements', t('coverage_tabElements', { count: formatNumber(scan.covered.length) })],
      ['tests', t('coverage_tabTests', { count: formatNumber(scan.tests.length) })],
      ['untested', t('coverage_tabUntested', { count: formatNumber(scan.uncoveredCount) })],
      ['risk', t('coverage_tabRisk', { count: formatNumber(riskCount(context)) })],
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
    if (state.tab === 'untested') return this.renderUncovered(context, query);
    if (state.tab === 'risk') return this.renderRisk(context, query);
    return this.renderCovered(state, context, query);
  }

  private rowsOrEmpty(rows: HTMLLIElement[], empty: string, total: number): HTMLElement {
    if (rows.length === 0) return el('div', 'empty', empty);
    const list = el('ul', 'rows');
    list.append(...rows);
    if (total > rows.length) {
      const more = el('li', 'empty', tn('coverage_listMore', total - rows.length));
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
        (test) =>
          testTitle(index.tests[test]!).toLowerCase().includes(query) ||
          index.tests[test]!.file.toLowerCase().includes(query),
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
      const count = el('span', 'count', tn('coverage_testCount', c.tests.length));
      const health = worstStatus(index, c.tests);
      if (health) count.title = health === 'failed' ? t('coverage_reachFailing') : t('coverage_reachFlaky');
      if (health) count.prepend(el('span', `dot ${health}`), ' ');
      row.appendChild(count);
      const first = index.locators[c.matches[0]!.entry]!.locator;
      const detail = el(
        'span',
        'detail mono',
        `${c.visible ? '' : `${t('coverage_hiddenNow')} · `}${first}${c.matches.length > 1 ? ` +${c.matches.length - 1}` : ''}`,
      );
      detail.title = c.matches.map((m) => index.locators[m.entry]!.locator).join('\n');
      row.appendChild(detail);
      return row;
    });
    return this.rowsOrEmpty(
      rows,
      scan.covered.length === 0
        ? isScoped(scan)
          ? t('coverage_emptyElementsInside')
          : t('coverage_emptyElements')
        : t('coverage_noMatch'),
      shown.length,
    );
  }

  private renderTests(state: ViewState, context: CoverageContext, query: string): HTMLElement {
    const { index, scan } = context;
    const shown = scan.tests.filter(({ test }) => {
      const entry = index.tests[test]!;
      return !query || testTitle(entry).toLowerCase().includes(query) || entry.file.toLowerCase().includes(query);
    });
    const rows = shown.slice(0, MAX_ROWS).map(({ test, elements }) => {
      const entry = index.tests[test]!;
      const row = this.row(
        (on) => this.callbacks.onTestHover(on ? test : null),
        () => this.callbacks.onTestSelect(test),
      );
      if (state.focusTest === test) row.classList.add('focused');
      const dot = el('span', `swatch dot ${entry.status ?? 'unknown'}`);
      dot.style.borderRadius = '50%';
      dot.title = statusLabel(entry.status);
      row.appendChild(dot);
      const label = el('span', 'label', testTitle(entry));
      label.title = testTitle(entry);
      row.appendChild(label);
      row.appendChild(el('span', 'count', tn('coverage_elementCount', elements.length)));
      const detail = el('span', 'detail mono');
      const link = el('a', undefined, entry.file);
      link.href = testCaseUrl(context.instanceUrl, entry.id);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = t('coverage_openTest');
      link.style.color = 'inherit';
      link.addEventListener('click', (e) => e.stopPropagation());
      detail.appendChild(link);
      if (state.focusTest === test) detail.append(` · ${t('coverage_onlyItsElements')}`);
      row.appendChild(detail);
      return row;
    });
    return this.rowsOrEmpty(
      rows,
      scan.tests.length === 0
        ? isScoped(scan)
          ? t('coverage_emptyTestsInside')
          : t('coverage_emptyTests')
        : t('coverage_noMatch'),
      shown.length,
    );
  }

  private renderUncovered(context: CoverageContext, query: string): HTMLElement {
    const uncovered: UncoveredElement[] = context.scan.uncovered;
    const scoped = isScoped(context.scan);
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
      // This page: a locator tests use on other pages finds it. Perhaps the same component, perhaps a lookalike.
      const elsewhere = context.elsewhere.get(u.element);
      if (elsewhere?.length) {
        const entry = context.index.locators[elsewhere[0]!]!;
        const pages = [...new Set(entry.uses.flatMap((use) => (use.pages ?? []).map((p) => context.index.pages?.[p])))]
          .filter(Boolean)
          .slice(0, 2);
        const hint = el(
          'span',
          'detail',
          pages.length
            ? t('coverage_foundElsewhere', { locator: entry.locator, pages: pages.join(', ') })
            : t('coverage_foundElsewhereOther', { locator: entry.locator }),
        );
        hint.title = elsewhere.map((e) => context.index.locators[e]!.locator).join('\n');
        row.appendChild(hint);
      }
      const suggestion = i < MAX_SUGGESTIONS ? this.callbacks.suggestLocator(u.element) : null;
      if (suggestion) {
        const code = el('code', 'piwi-loc');
        code.innerHTML = highlightLocator(suggestion);
        row.appendChild(code);
        const actions = el('div', 'row-actions');
        const copy = el('button', undefined, t('coverage_copyLocator'));
        copy.type = 'button';
        copy.title = t('coverage_copyLocatorTitle');
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
        ? scoped
          ? t('coverage_emptyUntestedInside')
          : t('coverage_emptyUntested')
        : t('coverage_noMatch'),
      shown.length,
    );
  }

  /** The locators likely to break, most urgent first. */
  private renderRisk(context: CoverageContext, query: string): HTMLElement {
    const block = el('div', 'risk');
    if (context.pageScoped) {
      block.appendChild(this.renderMissing(context, query));
      block.appendChild(this.renderSeveral(context, query));
    }
    block.appendChild(this.renderBrittle(context, query));
    return block;
  }

  private pageRiskMatches(context: CoverageContext, query: string): (row: PageRiskRow) => boolean {
    const { index } = context;
    return (row) =>
      !query ||
      index.locators[row.entry]!.locator.toLowerCase().includes(query) ||
      row.callSites.some((site) => site.toLowerCase().includes(query)) ||
      row.tests.some((test) => testTitle(index.tests[test]!).toLowerCase().includes(query));
  }

  /** Chains a test uses on this page that find nothing now: the test will fail here, or the page is in another state. */
  private renderMissing(context: CoverageContext, query: string): HTMLElement {
    const section = el('section', 'risk-section');
    section.appendChild(
      el('h3', 'section-head', t('coverage_missingHead', { count: formatNumber(context.missing.length) })),
    );
    section.appendChild(el('p', 'section-hint', t('coverage_missingHint')));
    const shown = context.missing.filter(this.pageRiskMatches(context, query));
    const rows = shown.slice(0, MAX_ROWS).map((row) => this.pageRiskRow(context, row));
    section.appendChild(
      this.rowsOrEmpty(
        rows,
        context.missing.length === 0 ? t('coverage_missingEmpty') : t('coverage_noMatch'),
        shown.length,
      ),
    );
    return section;
  }

  /** Chains a test clicks or fills on this page that find several elements: strict mode refuses that. */
  private renderSeveral(context: CoverageContext, query: string): HTMLElement {
    const section = el('section', 'risk-section');
    section.appendChild(
      el('h3', 'section-head', t('coverage_severalHead', { count: formatNumber(context.several.length) })),
    );
    section.appendChild(el('p', 'section-hint', t('coverage_severalHint')));
    const shown = context.several.filter(this.pageRiskMatches(context, query));
    const rows = shown.slice(0, MAX_ROWS).map((row) => this.pageRiskRow(context, row));
    section.appendChild(
      this.rowsOrEmpty(
        rows,
        context.several.length === 0 ? t('coverage_severalEmpty') : t('coverage_noMatch'),
        shown.length,
      ),
    );
    return section;
  }

  private pageRiskRow(context: CoverageContext, row: PageRiskRow): HTMLLIElement {
    const { index } = context;
    const locator = index.locators[row.entry]!.locator;
    const item = el('li', 'row static');
    item.dataset.kind = row.count === 0 ? 'missing' : 'several';
    item.appendChild(el('span', `swatch ${row.count === 0 ? 'missing' : 'brittle'}`));
    const label = el(
      'span',
      'label',
      row.count === 0
        ? row.arrival
          ? t('coverage_notFoundOnLoad')
          : t('coverage_notFoundNow')
        : tn('coverage_findsCount', row.count),
    );
    item.appendChild(label);
    const count = el('span', 'count', tn('coverage_testCount', row.tests.length));
    const health = worstStatus(index, row.tests);
    if (health) count.prepend(el('span', `dot ${health}`), ' ');
    item.appendChild(count);
    const chain = el('code', 'piwi-loc');
    chain.innerHTML = highlightLocator(locator);
    item.appendChild(chain);
    const parts = [row.actions.slice(0, 3).map(actionLabel).join(', ')];
    if (row.callSites.length)
      parts.push(`${row.callSites[0]}${row.callSites.length > 1 ? ` +${row.callSites.length - 1}` : ''}`);
    if (row.projects.length) parts.push(row.projects.join(', '));
    const stability = context.stabilities[row.entry];
    if (stability?.level === 'brittle')
      parts.push(t('coverage_brittleRules', { rules: stabilityText(stability, ', ') }));
    const detail = el('span', 'detail', parts.filter(Boolean).join(' · '));
    detail.title = row.tests.map((test) => testTitle(index.tests[test]!)).join('\n');
    item.appendChild(detail);
    return item;
  }

  private renderBrittle(context: CoverageContext, query: string): HTMLElement {
    const { index, scan } = context;
    const section = el('section', 'risk-section');
    section.appendChild(
      el('h3', 'section-head', t('coverage_brittleHead', { count: formatNumber(context.brittle.length) })),
    );
    section.appendChild(el('p', 'section-hint', t('coverage_brittleHint')));
    const matches = (row: BrittleRow) =>
      !query ||
      index.locators[row.entry]!.locator.toLowerCase().includes(query) ||
      row.elements.some((e) => scan.describe(e).toLowerCase().includes(query)) ||
      row.callSites.some((site) => site.toLowerCase().includes(query)) ||
      row.tests.some((test) => testTitle(index.tests[test]!).toLowerCase().includes(query));
    const shown = context.brittle.filter(matches);
    const rows = shown.slice(0, MAX_ROWS).map((row, i) => this.brittleRow(context, row, i < MAX_SUGGESTIONS));
    section.appendChild(
      this.rowsOrEmpty(
        rows,
        context.brittle.length === 0
          ? isScoped(scan)
            ? t('coverage_brittleEmptyInside')
            : t('coverage_brittleEmpty')
          : t('coverage_noMatch'),
        shown.length,
      ),
    );
    return section;
  }

  private brittleRow(context: CoverageContext, row: BrittleRow, suggest: boolean): HTMLLIElement {
    const { index, scan } = context;
    const locator = index.locators[row.entry]!.locator;
    const first = row.elements[0]!;
    const item = this.row(
      (on) => this.callbacks.onElementHover(on ? first : null),
      () => this.callbacks.onElementSelect(first),
    );
    item.dataset.kind = 'brittle';
    item.appendChild(el('span', 'swatch brittle'));
    const label = el('span', 'label', row.count > 1 ? tn('coverage_elementCount', row.count) : scan.describe(first));
    label.title = row.elements.map((e) => scan.describe(e)).join('\n');
    item.appendChild(label);
    const count = el('span', 'count', tn('coverage_testCount', row.tests.length));
    const health = worstStatus(index, row.tests);
    if (health) {
      count.prepend(el('span', `dot ${health}`), ' ');
      count.title = health === 'failed' ? t('coverage_useFailing') : t('coverage_useFlaky');
    }
    item.appendChild(count);
    const chain = el('code', 'piwi-loc');
    chain.innerHTML = highlightLocator(locator);
    item.appendChild(chain);
    const why = el('span', 'detail', stabilityText(row.stability));
    why.title = row.stability.findings.map((f) => f.detail).join('\n');
    if (row.callSites.length)
      why.append(` · ${row.callSites[0]}${row.callSites.length > 1 ? ` +${row.callSites.length - 1}` : ''}`);
    item.appendChild(why);

    if (row.count > 1) {
      item.appendChild(el('span', 'detail wrap', tn('coverage_severalNoReplacement', row.count)));
      return item;
    }
    const replacement = suggest ? this.callbacks.replacementFor(first, row.entry) : null;
    if (replacement?.kind === 'add-test-id') {
      item.appendChild(el('span', 'detail wrap', t('coverage_addTestId')));
    } else if (replacement?.kind === 'replace') {
      const next = replacement.recommended.locator;
      const code = el('code', 'piwi-loc suggestion');
      code.innerHTML = `→ ${highlightLocator(next)}`;
      code.title = t('coverage_replacementTitle');
      item.appendChild(code);
      if (replacement.durable) {
        const durable = el('span', 'detail', t('coverage_mostStable', { locator: replacement.durable.locator }));
        durable.title = replacement.durable.locator;
        item.appendChild(durable);
      }
      const actions = el('div', 'row-actions');
      const copy = el('button', undefined, t('coverage_copyLocator'));
      copy.type = 'button';
      copy.title = t('coverage_copyReplacementTitle');
      copy.addEventListener('click', (e) => {
        e.stopPropagation();
        void copyText(next, copy);
      });
      const edit = el('button', undefined, t('coverage_copyEdit'));
      edit.type = 'button';
      edit.title = t('coverage_copyEditTitle');
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        void copyText(editText(row.callSites, locator, next), edit);
      });
      actions.append(copy, edit);
      item.appendChild(actions);
    }
    return item;
  }

  private renderNotes(context: CoverageContext): HTMLElement | null {
    const { scan, index } = context;
    const items: Node[] = [];
    if (scan.unmatched) {
      items.push(el('li', undefined, tn('coverage_notesUnmatched', scan.unmatched)));
    }
    if (index.truncated) items.push(el('li', undefined, t('coverage_notesTruncated')));
    if (index.testIdAttributes?.length) {
      items.push(el('li', undefined, t('coverage_notesTestIds', { attributes: index.testIdAttributes.join(', ') })));
    }
    const counted = context.pageScoped
      ? context.pageKey
        ? t('coverage_notesPageScoped', { page: context.pageKey })
        : t('coverage_notesPageScopedHere')
      : t('coverage_notesAllPages');
    items.push(
      el(
        'li',
        undefined,
        `${tn('coverage_notesChecked', scan.evaluated, { ms: formatNumber(scan.durationMs) })} ${counted}`,
      ),
    );
    if (context.prefixRemoved) {
      items.push(el('li', undefined, t('coverage_notesPrefixRemoved', { prefix: context.prefixRemoved })));
    }
    if (scan.errors.length) {
      const errorItem = el('li', undefined, tn('coverage_notesErrors', scan.errors.length));
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
      scan.errors.length ? tn('coverage_notesWithErrors', scan.errors.length) : t('coverage_notes'),
    );
    const list = el('ul');
    list.append(...items);
    details.append(summary, list);
    return details;
  }
}
