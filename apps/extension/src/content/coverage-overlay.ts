/**
 * "Tested elements": draws over the live page which elements the project's
 * tests reach and through which tests, and which interactive elements no test
 * reaches at all. Connected mode only — the locator index comes from the Piwi
 * instance through the background worker, never from this content script.
 *
 * Injected from the popup; injecting it again toggles it off. Stays live while
 * open: page changes trigger a rescan (throttled), scrolling and resizing move
 * the boxes, and a newer index from the instance replaces the cached one.
 *
 * The view can be limited to one element and what is inside it — chosen on
 * the page, or handed over by the pick results through
 * `__piwiCoverageScopeRequest` — with the tested containers around it listed
 * apart.
 */
import type { LocatorIndex } from '@piwitests/core/locator-index';
import { startTool, endTool, toolIsCurrent, installEscapeToCancel } from '../shared/tool-session.js';
import { ensureSessionAccess } from '../shared/session-access.js';
import { getConnectionSettings, isConnected } from '../shared/connection-settings.js';
import { getActiveProjectOverride, resolveActiveProject, type ActiveProject } from '../shared/active-project.js';
import { getCachedLocatorIndex } from '../shared/locator-index-cache.js';
import { requestLocatorIndex } from '../shared/locator-index-refresh.js';
import { isElementNode } from './engine-aria.js';
import { scanCoverage, scopeScan, widerScope, type CoverageScan } from './coverage-scan.js';
import { CoverageLayer, type Drawable, type Frame } from './coverage-layer.js';
import { CoveragePanel, type PanelStatus } from './coverage-panel.js';
import { COVERAGE_CSS } from './coverage-style.js';
import {
  initialViewState,
  isScoped,
  kindShown,
  spotlightTest,
  worstStatus,
  type CoverageContext,
  type ViewState,
} from './coverage-view.js';
import { deriveTopLocator } from './top-locator.js';

const HOST_ID = 'piwi-coverage-host';
/** Wait after the last page change before rescanning. */
const MUTATION_DEBOUNCE_MS = 450;
/** Never rescan more often than this, however busy the page. */
const MIN_SCAN_GAP_MS = 1200;
/** Boxes drawn at most, so a page with thousands of matches stays smooth. */
const MAX_DRAWN = 1500;
const OBSERVED_ATTRIBUTES = [
  'class',
  'style',
  'hidden',
  'open',
  'id',
  'role',
  'type',
  'name',
  'value',
  'href',
  'for',
  'title',
  'alt',
  'placeholder',
  'disabled',
  'readonly',
  'contenteditable',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-hidden',
  'aria-disabled',
  'aria-checked',
  'aria-selected',
  'aria-expanded',
  'aria-pressed',
  'aria-level',
  'data-testid',
  'data-test-id',
  'data-test',
  'data-qa',
  'data-cy',
];

interface CoverageGlobals {
  __piwiCoverageOff?: () => void;
  __piwiCoverage?: unknown;
  /** Set by the pick results before asking for the overlay: open it limited to this element. */
  __piwiCoverageScopeRequest?: unknown;
  /** Limits an open overlay to an element. */
  __piwiCoverageSetScope?: (element: Element) => void;
  /** Set by the test suite (page world) to render into an open shadow root it can inspect. */
  __piwiTestOpenShadow?: boolean;
}

function isOwnElement(element: Element): boolean {
  const id = element.getAttribute('id');
  return !!id && id.startsWith('piwi-');
}

/** Whether `inner` sits inside `outer`, across shadow roots. */
function containsAcross(outer: Element, inner: Element): boolean {
  for (let node: Node | null = inner; node; node = node.parentNode ?? (node as ShadowRoot).host ?? null) {
    if (node === outer) return true;
  }
  return false;
}

function isOwnNode(node: Node): boolean {
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return !!element?.closest('[id^="piwi-"]');
}

/** Mouse events the page must not see while the reader chooses an element. */
const CHOOSING_BLOCKED_EVENTS = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
];

function startCoverageOverlay(): void {
  const g = globalThis as unknown as CoverageGlobals;
  const requested = g.__piwiCoverageScopeRequest;
  delete g.__piwiCoverageScopeRequest;
  const scopeRequest = requested && isElementNode(requested as Node) ? (requested as Element) : null;
  if (g.__piwiCoverageOff) {
    if (scopeRequest && g.__piwiCoverageSetScope) g.__piwiCoverageSetScope(scopeRequest);
    else g.__piwiCoverageOff();
    return;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'all:initial;position:fixed;inset:0;width:auto;height:auto;margin:0;padding:0;border:0;background:transparent;overflow:visible;max-width:none;max-height:none;z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: g.__piwiTestOpenShadow === true ? 'open' : 'closed' });
  const style = document.createElement('style');
  style.textContent = COVERAGE_CSS;
  shadow.appendChild(style);

  // The top layer puts the overlay above modal dialogs and popovers opened by the page.
  const canUseTopLayer = typeof (host as HTMLElement & { showPopover?: () => void }).showPopover === 'function';
  const bringToFront = () => {
    if (!canUseTopLayer) return;
    try {
      if (host.matches(':popover-open')) host.hidePopover();
      host.showPopover();
    } catch {
      // Not in the document any more, or the browser refused; the z-index still applies.
    }
  };
  if (canUseTopLayer) host.setAttribute('popover', 'manual');
  bringToFront();

  const state: ViewState = { ...initialViewState(), scope: scopeRequest };
  let status: PanelStatus = 'loading';
  let message: string | null = 'Loading the locator index…';
  let project: ActiveProject | null = null;
  let instanceUrl = '';
  let index: LocatorIndex | null = null;
  let fetchedAt: number | null = null;
  let refreshing = false;
  let refreshError: string | null = null;
  let scan: CoverageScan | null = null;
  let context: CoverageContext | null = null;
  let scanning: { done: number; total: number } | null = null;
  let scanCount = 0;
  const suggestions = new WeakMap<Element, string | null>();
  /** While choosing: the element that would be chosen, and the narrower ones ↑ walked out of. */
  let choosingTarget: Element | null = null;
  let choosingNarrower: Element[] = [];
  /** A container hovered in the panel's "Around it" list. */
  let aroundHover: Element | null = null;

  const suggestLocator = (element: Element): string | null => {
    if (suggestions.has(element)) return suggestions.get(element)!;
    let locator: string | null = null;
    try {
      locator = deriveTopLocator(element).locator;
    } catch {
      locator = null;
    }
    suggestions.set(element, locator);
    return locator;
  };

  const layer = new CoverageLayer(shadow, {
    onPin: (element) => pin(element),
    onClosePinned: () => pin(null),
    suggestLocator,
  });
  const panel = new CoveragePanel(shadow, {
    onClose: () => off(),
    onCollapse: (collapsed) => {
      state.collapsed = collapsed;
      renderPanel();
    },
    onDock: () => {
      state.dock = state.dock === 'right' ? 'left' : 'right';
      renderPanel();
    },
    onRefresh: () => void loadIndex(true),
    onOpenSettings: () => void chrome.runtime.sendMessage({ type: 'piwi-open-options' }).catch(() => undefined),
    onTab: (tab) => {
      state.tab = tab;
      renderPanel();
    },
    onQuery: (query) => {
      state.query = query;
      renderPanel();
    },
    onToggle: (key) => {
      state[key] = !state[key];
      redraw();
      renderPanel();
    },
    onElementHover: (element) => {
      state.hoverElement = element;
      layer.setHovered(element);
    },
    onElementSelect: (element) => select(element),
    onTestHover: (test) => {
      state.hoverTest = test;
      redraw();
    },
    onTestSelect: (test) => {
      state.focusTest = state.focusTest === test ? null : test;
      state.hoverTest = null;
      redraw();
      renderPanel();
    },
    onChooseScope: () => startChoosing(),
    onCancelChoosing: () => stopChoosing(),
    onWidenScope: () => {
      if (state.scope) setScope(widerScope(state.scope));
    },
    onClearScope: () => setScope(null),
    onContainerHover: (element) => {
      aroundHover = element;
      layer.setFrames(frames());
    },
    onContainerSelect: (element) => {
      aroundHover = null;
      setScope(element);
    },
    suggestLocator,
  });

  function describe(element: Element): string {
    return scan?.describe(element) ?? element.tagName.toLowerCase();
  }

  function renderPanel(): void {
    panel.render({
      status,
      modalOpen: !!openModal(),
      message,
      projectLabel: project?.projectLabel ?? null,
      context,
      fetchedAt,
      refreshing,
      refreshError,
      scanning,
      state,
      scopeLabel: state.scope ? describe(state.scope) : null,
      canWiden: !!state.scope && widerScope(state.scope) !== null,
    });
  }

  let panelFrame = 0;
  function renderPanelSoon(): void {
    if (panelFrame) return;
    panelFrame = requestAnimationFrame(() => {
      panelFrame = 0;
      renderPanel();
    });
  }

  /** The page's open modal dialog: everything outside it is behind its backdrop and inert. */
  function openModal(): Element | null {
    try {
      return document.querySelector('dialog:modal');
    } catch {
      return null;
    }
  }

  function drawables(): Drawable[] {
    if (!context) return [];
    const { scan: current, index: idx } = context;
    const spotlight = spotlightTest(state);
    const lit = spotlight != null ? new Set(current.tests.find((t) => t.test === spotlight)?.elements ?? []) : null;
    const modal = openModal();
    const behindModal = (element: Element) => !!modal && !modal.contains(element);
    const maxTests = Math.max(1, ...current.covered.map((c) => c.tests.length));
    const out: Drawable[] = [];
    for (const covered of current.covered) {
      if (!covered.visible || !kindShown(state, covered)) continue;
      out.push({
        element: covered.element,
        kind: covered.kind,
        covered,
        uncovered: null,
        health: worstStatus(idx, covered.tests),
        heat: state.heatmap ? Math.log1p(covered.tests.length) / Math.log1p(maxTests) : 0,
        emphasis: lit ? (lit.has(covered.element) ? 'strong' : 'dim') : behindModal(covered.element) ? 'dim' : 'normal',
      });
    }
    if (state.showUncovered) {
      for (const uncovered of current.uncovered) {
        out.push({
          element: uncovered.element,
          kind: 'uncovered',
          covered: null,
          uncovered,
          health: null,
          heat: 0,
          emphasis: lit || behindModal(uncovered.element) ? 'dim' : 'normal',
        });
      }
    }
    return out.slice(0, MAX_DRAWN);
  }

  function frames(): Frame[] {
    const out: Frame[] = [];
    if (state.scope && !state.choosingScope)
      out.push({ element: state.scope, kind: 'scope', label: `Inside ${describe(state.scope)}` });
    if (state.choosingScope && choosingTarget) {
      out.push({
        element: choosingTarget,
        kind: 'choosing',
        label: `${describe(choosingTarget)} · click to look inside`,
      });
    }
    if (aroundHover) out.push({ element: aroundHover, kind: 'around', label: describe(aroundHover) });
    return out;
  }

  function redraw(): void {
    layer.setContext(context);
    layer.draw(state.choosingScope ? [] : drawables());
    layer.setFrames(frames());
    if (state.pinned) layer.showPinned(state.pinned);
    bridge();
  }

  /** The context the panel and the boxes draw from: the scan, limited to the chosen element when there is one. */
  function buildContext(): void {
    if (!scan || !index || !project) {
      context = null;
      return;
    }
    if (state.scope && !state.scope.isConnected) state.scope = null;
    context = {
      index,
      scan: state.scope ? scopeScan(scan, state.scope) : scan,
      instanceUrl,
      projectId: project.projectId,
      projectLabel: project.projectLabel,
    };
  }

  function setScope(element: Element | null): void {
    state.scope = element;
    state.focusTest = null;
    state.hoverTest = null;
    state.pinned = null;
    layer.showPinned(null);
    layer.showPreview(null);
    buildContext();
    redraw();
    renderPanel();
  }

  // ── Choosing the element to look inside ───────────────────────────────
  /** The page element under a viewport point, inside open shadow roots; null over the overlay itself. */
  function elementAt(x: number, y: number): Element | null {
    let element = document.elementFromPoint(x, y);
    while (element?.shadowRoot) {
      const inner = element.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === element) break;
      element = inner;
    }
    if (!element || element === host || isOwnElement(element)) return null;
    if (element === document.documentElement || element === document.body) return null;
    return element;
  }

  function startChoosing(): void {
    state.choosingScope = true;
    state.pinned = null;
    choosingTarget = pointer ? elementAt(pointer.x, pointer.y) : null;
    choosingNarrower = [];
    layer.showPinned(null);
    layer.showPreview(null);
    for (const type of CHOOSING_BLOCKED_EVENTS) window.addEventListener(type, onChoosingEvent, true);
    redraw();
    renderPanel();
  }

  function stopChoosing(chosen: Element | null = null): void {
    if (!state.choosingScope) return;
    state.choosingScope = false;
    choosingTarget = null;
    choosingNarrower = [];
    for (const type of CHOOSING_BLOCKED_EVENTS) window.removeEventListener(type, onChoosingEvent, true);
    if (chosen) setScope(chosen);
    else {
      redraw();
      renderPanel();
    }
  }

  function setChoosingTarget(element: Element | null): void {
    if (element === choosingTarget) return;
    choosingTarget = element;
    layer.setFrames(frames());
    bridge();
  }

  /** Keeps the page from reacting to the click that chooses; clicks on the overlay go through. */
  function onChoosingEvent(e: Event): void {
    if (e.composedPath().includes(host)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type !== 'click') return;
    const mouse = e as MouseEvent;
    const target = choosingTarget ?? elementAt(mouse.clientX, mouse.clientY);
    if (target) stopChoosing(target);
  }

  function pin(element: Element | null): void {
    state.pinned = element;
    layer.showPinned(element);
    renderPanel();
  }

  function select(element: Element): void {
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    schedulePosition();
    setTimeout(() => {
      if (!toolIsCurrent(toolEpoch)) return;
      layer.position();
      layer.flash(element);
      pin(element);
    }, 350);
  }

  /** A structured copy of what is shown, for the test suite (it lives in the content script's world, never the page's). */
  function bridge(): void {
    const idx = index;
    const view = context?.scan ?? scan;
    g.__piwiCoverage = {
      status,
      message,
      projectLabel: project?.projectLabel ?? null,
      scans: scanCount,
      drawn: state.choosingScope ? 0 : drawables().length,
      scope: state.scope ? describe(state.scope) : null,
      choosing: state.choosingScope ? (choosingTarget ? describe(choosingTarget) : '') : null,
      containers:
        view && isScoped(view)
          ? view.containers.map((c) => ({
              description: c.description,
              tests: c.tests.map((t) => idx!.tests[t]!.title),
            }))
          : [],
      covered:
        view?.covered.map((c) => ({
          description: c.description,
          eid: c.element.getAttribute('data-eid'),
          kind: c.kind,
          ambiguous: c.ambiguous,
          visible: c.visible,
          tests: c.tests.map((t) => idx!.tests[t]!.title),
          locators: c.matches.map((m) => idx!.locators[m.entry]!.locator),
        })) ?? [],
      uncovered:
        view?.uncovered.map((u) => ({ description: u.description, eid: u.element.getAttribute('data-eid') })) ?? [],
      tests: view?.tests.map((t) => ({ title: idx!.tests[t.test]!.title, elements: t.elements.length })) ?? [],
      coveredInteractive: view?.coveredInteractive ?? 0,
      uncoveredCount: view?.uncoveredCount ?? 0,
      unmatched: scan?.unmatched ?? 0,
      errors: scan?.errors.map((e) => ({ locator: idx!.locators[e.entry]!.locator, message: e.message })) ?? [],
      durationMs: scan?.durationMs ?? null,
    };
  }

  // ── Scanning ───────────────────────────────────────────────────────────
  let scanSeq = 0;
  let scanRunning = false;
  let scanDirty = false;
  let lastScanEnd = 0;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;

  function requestScan(delay = 0): void {
    if (scanTimer !== undefined) return;
    const wait = Math.max(delay, lastScanEnd + MIN_SCAN_GAP_MS - performance.now(), 0);
    scanTimer = setTimeout(() => {
      scanTimer = undefined;
      void runScan();
    }, wait);
  }

  async function runScan(): Promise<void> {
    if (!index || !project) return;
    if (scanRunning) {
      scanDirty = true;
      return;
    }
    scanRunning = true;
    scanDirty = false;
    const seq = ++scanSeq;
    const scanIndex = index;
    scanning = { done: 0, total: scanIndex.locators.length };
    renderPanelSoon();
    const result = await scanCoverage(scanIndex, document, {
      testIdAttributes: scanIndex.testIdAttributes ?? undefined,
      ignore: isOwnElement,
      keepGoing: () => seq === scanSeq && toolIsCurrent(toolEpoch),
      onProgress: (done, total) => {
        scanning = { done, total };
        renderPanelSoon();
      },
    });
    scanRunning = false;
    lastScanEnd = performance.now();
    scanning = null;
    if (!toolIsCurrent(toolEpoch)) return;
    if (result && seq === scanSeq && scanIndex === index) {
      scan = result;
      scanCount++;
      buildContext();
      const view = context!.scan;
      status = 'ready';
      message = null;
      if (
        state.pinned &&
        !view.covered.some((c) => c.element === state.pinned) &&
        !view.uncovered.some((u) => u.element === state.pinned)
      ) {
        state.pinned = null;
        layer.showPinned(null);
      }
      if (state.focusTest != null && !view.tests.some((t) => t.test === state.focusTest)) state.focusTest = null;
      observeRoots();
      bringToFront();
      redraw();
    }
    renderPanel();
    if (scanDirty) requestScan(MUTATION_DEBOUNCE_MS);
  }

  // ── Index ──────────────────────────────────────────────────────────────
  function useIndex(next: LocatorIndex, at: number): void {
    index = next;
    fetchedAt = at;
    scanSeq++;
    scanDirty = true;
    if (!scanRunning) requestScan(0);
  }

  async function loadIndex(force: boolean): Promise<void> {
    if (!project) return;
    refreshing = true;
    refreshError = null;
    renderPanel();
    const answer = await requestLocatorIndex(project.projectId, { force });
    if (!toolIsCurrent(toolEpoch)) return;
    refreshing = false;
    if (answer.ok) {
      if (answer.refreshed) useIndex(answer.index, Date.now());
      else if (!index) {
        const cached = await getCachedLocatorIndex(project.projectId);
        if (cached) useIndex(cached.index, cached.fetchedAt);
      }
    } else if (index) {
      refreshError = answer.error;
    } else {
      status = 'error';
      message = `Couldn't load the locator index of ${project.projectLabel}: ${answer.error}`;
    }
    renderPanel();
    bridge();
  }

  async function boot(): Promise<void> {
    renderPanel();
    await ensureSessionAccess();
    const [settings, override] = await Promise.all([
      getConnectionSettings(),
      getActiveProjectOverride().catch(() => null),
    ]);
    if (!toolIsCurrent(toolEpoch)) return;
    instanceUrl = settings.instanceUrl;
    if (!isConnected(settings)) {
      status = 'not-connected';
      message =
        'Connect Piwi Picker to your Piwi instance to see which elements of this page your tests use: add the instance URL, an API key and a URL pattern for this site in the settings.';
      renderPanel();
      bridge();
      return;
    }
    project = resolveActiveProject(settings, override, location.href);
    if (!project) {
      status = 'no-project';
      message =
        'No project is mapped to this page. Add a URL pattern for it in the settings, or pick a project from the popup.';
      renderPanel();
      bridge();
      return;
    }
    message = `Loading the locator index of ${project.projectLabel}…`;
    renderPanel();
    const cached = await getCachedLocatorIndex(project.projectId);
    if (!toolIsCurrent(toolEpoch)) return;
    if (cached) useIndex(cached.index, cached.fetchedAt);
    await loadIndex(false);
  }

  // ── Live updates ───────────────────────────────────────────────────────
  const observerOptions: MutationObserverInit = {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: OBSERVED_ATTRIBUTES,
  };
  const observer = new MutationObserver((records) => {
    if (records.some((r) => !isOwnNode(r.target))) {
      scanDirty = true;
      requestScan(MUTATION_DEBOUNCE_MS);
    }
  });
  observer.observe(document.documentElement, observerOptions);

  /** Page changes inside open shadow roots and same-origin frames trigger rescans too. */
  function observeRoots(): void {
    if (!context) return;
    const seen = new Set<Node>();
    const watch = (root: Node) => {
      if (seen.has(root)) return;
      seen.add(root);
      observer.observe(root, observerOptions);
    };
    for (const c of context.scan.covered) {
      const root = c.element.getRootNode();
      if (root !== document) watch(root);
    }
    for (const u of context.scan.uncovered) {
      const root = u.element.getRootNode();
      if (root !== document) watch(root);
    }
  }

  let positionFrame = 0;
  function schedulePosition(): void {
    if (positionFrame) return;
    positionFrame = requestAnimationFrame(() => {
      positionFrame = 0;
      layer.position();
    });
  }
  const positionTimer = setInterval(schedulePosition, 600);

  let pointer: { x: number; y: number } | null = null;
  let hoverFrame = 0;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let hovered: Element | null = null;
  function hitTest(): void {
    hoverFrame = 0;
    if (state.choosingScope) {
      const under = pointer ? elementAt(pointer.x, pointer.y) : null;
      // The target follows the pointer, except inside a container ↑ widened to.
      const widened = choosingNarrower.length > 0 && choosingTarget;
      if (under && !(widened && containsAcross(choosingTarget!, under))) {
        choosingNarrower = [];
        setChoosingTarget(under);
      }
      return;
    }
    const target = pointer ? layer.hitTest(pointer.x, pointer.y) : null;
    if (target === hovered) return;
    hovered = target;
    if (state.hoverElement == null) layer.setHovered(target);
    clearTimeout(hoverTimer);
    layer.showPreview(null);
    if (target) hoverTimer = setTimeout(() => layer.showPreview(target), 180);
  }
  const onPointerMove = (e: MouseEvent) => {
    pointer = e.target === host ? null : { x: e.clientX, y: e.clientY };
    if (!hoverFrame) hoverFrame = requestAnimationFrame(hitTest);
  };
  const onPointerOut = (e: MouseEvent) => {
    if (e.relatedTarget) return;
    pointer = null;
    if (!hoverFrame) hoverFrame = requestAnimationFrame(hitTest);
  };
  // Window capture runs before the tool session's document-level Escape: an open card closes first,
  // then the limit to an element, then the overlay.
  const onKeyDown = (e: KeyboardEvent) => {
    if (state.choosingScope) {
      const handled = ['Escape', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.key);
      if (!handled) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') stopChoosing();
      else if (e.key === 'Enter') stopChoosing(choosingTarget);
      else if (e.key === 'ArrowUp' && choosingTarget) {
        const wider = widerScope(choosingTarget);
        if (wider) {
          choosingNarrower.push(choosingTarget);
          setChoosingTarget(wider);
        }
      } else if (e.key === 'ArrowDown') {
        const narrower = choosingNarrower.pop();
        if (narrower) setChoosingTarget(narrower);
      }
      return;
    }
    if (e.key !== 'Escape' || (!state.pinned && !state.scope)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (state.pinned) pin(null);
    else setScope(null);
  };

  let lastUrl = location.href;
  const urlTimer = setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    void (async () => {
      const [settings, override] = await Promise.all([
        getConnectionSettings(),
        getActiveProjectOverride().catch(() => null),
      ]);
      if (!toolIsCurrent(toolEpoch)) return;
      const next = resolveActiveProject(settings, override, location.href);
      if (next?.projectId !== project?.projectId) {
        project = next;
        index = null;
        scan = null;
        context = null;
        redraw();
        if (!project) {
          status = 'no-project';
          message =
            'No project is mapped to this page. Add a URL pattern for it in the settings, or pick a project from the popup.';
          renderPanel();
          return;
        }
        status = 'loading';
        message = `Loading the locator index of ${project.projectLabel}…`;
        const cached = await getCachedLocatorIndex(project.projectId);
        if (cached) useIndex(cached.index, cached.fetchedAt);
        await loadIndex(false);
      } else {
        scanDirty = true;
        requestScan(MUTATION_DEBOUNCE_MS);
      }
    })();
  }, 800);

  window.addEventListener('scroll', schedulePosition, { capture: true, passive: true });
  window.addEventListener('resize', schedulePosition, { passive: true });
  document.addEventListener('mousemove', onPointerMove, { capture: true, passive: true });
  document.addEventListener('mouseout', onPointerOut, { capture: true, passive: true });
  window.addEventListener('keydown', onKeyDown, true);

  let toolEpoch = 0;
  const off = () => {
    observer.disconnect();
    clearInterval(positionTimer);
    clearInterval(urlTimer);
    clearTimeout(scanTimer);
    clearTimeout(hoverTimer);
    window.removeEventListener('scroll', schedulePosition, true);
    window.removeEventListener('resize', schedulePosition);
    document.removeEventListener('mousemove', onPointerMove, true);
    document.removeEventListener('mouseout', onPointerOut, true);
    window.removeEventListener('keydown', onKeyDown, true);
    for (const type of CHOOSING_BLOCKED_EVENTS) window.removeEventListener(type, onChoosingEvent, true);
    scanSeq++;
    layer.destroy();
    panel.destroy();
    host.remove();
    delete g.__piwiCoverageOff;
    delete g.__piwiCoverageSetScope;
    g.__piwiCoverage = { status: 'closed' };
    endTool(toolEpoch);
  };
  g.__piwiCoverageOff = off;
  g.__piwiCoverageSetScope = (element) => {
    if (state.choosingScope) stopChoosing();
    setScope(element);
  };
  toolEpoch = startTool('coverage-overlay', off);
  installEscapeToCancel();
  bridge();
  void boot();
}

startCoverageOverlay();
