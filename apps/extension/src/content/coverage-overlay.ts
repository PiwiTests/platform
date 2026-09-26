/**
 * "Tested elements": draws over the live page which elements the project's
 * tests reach and through which tests, and which interactive elements no test
 * reaches at all. Connected mode only — the locator index comes from the Piwi
 * instance through the background worker, never from this content script.
 *
 * Injected from the popup; injecting it again toggles it off. Stays live while
 * open: page changes trigger a rescan (throttled), scrolling and resizing move
 * the boxes, and a newer index from the instance replaces the cached one.
 */
import type { LocatorIndex } from '@piwitests/core/locator-index';
import { startTool, endTool, toolIsCurrent, installEscapeToCancel } from '../shared/tool-session.js';
import { ensureSessionAccess } from '../shared/session-access.js';
import { getConnectionSettings, isConnected } from '../shared/connection-settings.js';
import { getActiveProjectOverride, resolveActiveProject, type ActiveProject } from '../shared/active-project.js';
import { getCachedLocatorIndex } from '../shared/locator-index-cache.js';
import { requestLocatorIndex } from '../shared/locator-index-refresh.js';
import { scanCoverage, type CoverageScan } from './coverage-scan.js';
import { CoverageLayer, type Drawable } from './coverage-layer.js';
import { CoveragePanel, type PanelStatus } from './coverage-panel.js';
import { COVERAGE_CSS } from './coverage-style.js';
import {
  initialViewState,
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
  /** Set by the test suite (page world) to render into an open shadow root it can inspect. */
  __piwiTestOpenShadow?: boolean;
}

function isOwnElement(element: Element): boolean {
  const id = element.getAttribute('id');
  return !!id && id.startsWith('piwi-');
}

function isOwnNode(node: Node): boolean {
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  return !!element?.closest('[id^="piwi-"]');
}

function startCoverageOverlay(): void {
  const g = globalThis as unknown as CoverageGlobals;
  if (g.__piwiCoverageOff) {
    g.__piwiCoverageOff();
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

  const state: ViewState = initialViewState();
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
    suggestLocator,
  });

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

  function redraw(): void {
    layer.setContext(context);
    layer.draw(drawables());
    if (state.pinned) layer.showPinned(state.pinned);
    bridge();
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
    g.__piwiCoverage = {
      status,
      message,
      projectLabel: project?.projectLabel ?? null,
      scans: scanCount,
      drawn: drawables().length,
      covered:
        scan?.covered.map((c) => ({
          description: c.description,
          eid: c.element.getAttribute('data-eid'),
          kind: c.kind,
          ambiguous: c.ambiguous,
          visible: c.visible,
          tests: c.tests.map((t) => idx!.tests[t]!.title),
          locators: c.matches.map((m) => idx!.locators[m.entry]!.locator),
        })) ?? [],
      uncovered:
        scan?.uncovered.map((u) => ({ description: u.description, eid: u.element.getAttribute('data-eid') })) ?? [],
      tests: scan?.tests.map((t) => ({ title: idx!.tests[t.test]!.title, elements: t.elements.length })) ?? [],
      coveredInteractive: scan?.coveredInteractive ?? 0,
      uncoveredCount: scan?.uncoveredCount ?? 0,
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
      context = {
        index: scanIndex,
        scan: result,
        instanceUrl,
        projectId: project.projectId,
        projectLabel: project.projectLabel,
      };
      status = 'ready';
      message = null;
      if (
        state.pinned &&
        !result.covered.some((c) => c.element === state.pinned) &&
        !result.uncovered.some((u) => u.element === state.pinned)
      ) {
        state.pinned = null;
        layer.showPinned(null);
      }
      if (state.focusTest != null && !result.tests.some((t) => t.test === state.focusTest)) state.focusTest = null;
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
  // Window capture runs before the tool session's document-level Escape, so an open card closes first.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !state.pinned) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    pin(null);
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
    scanSeq++;
    layer.destroy();
    panel.destroy();
    host.remove();
    delete g.__piwiCoverageOff;
    g.__piwiCoverage = { status: 'closed' };
    endTool(toolEpoch);
  };
  g.__piwiCoverageOff = off;
  toolEpoch = startTool('coverage-overlay', off);
  installEscapeToCancel();
  bridge();
  void boot();
}

startCoverageOverlay();
