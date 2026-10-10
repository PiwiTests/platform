import type { Config, Driver, DriveStep, PopoverDOM } from 'driver.js';
import { docsUrl } from '#shared/docs';
import { stopCopy, tourCopyFor, type TourCopy } from '~/utils/demo-tour/copy';
import { DEFAULT_TOUR_LANGUAGE, pickTourLanguage, type TourLanguage } from '~/utils/demo-tour/languages';
import { escapeTourHtml, tourMarkup } from '~/utils/demo-tour/markup';
import { TOUR_PROFILES } from '~/utils/demo-tour/profiles';
import { readTourPromptState, TOUR_PROMPT_STORAGE_KEY, type TourPromptState } from '~/utils/demo-tour/prompt-state';
import type { TourProfile, TourProfileId, TourStop } from '~/utils/demo-tour/types';

/** A key of the tour's own words, the `ui` block of the copy files. */
type TourUiKey = keyof TourCopy['ui'];

/** How long a stop waits for its target to render before it shows centered. */
const TARGET_WAIT_MS = 8000;
/** How long a move to another page waits for Nuxt to show it (`page:finish`). */
const PAGE_WAIT_MS = 4000;
/** How long a stop waits for the folded section holding its target to render. */
const UNFOLD_WAIT_MS = 4000;
/** Where a target's top edge lands below the top of the panel that scrolls it. */
const TARGET_OFFSET = 72;
/** The closest a target's top edge comes to its panel's top to make room for the popover under it. */
const MIN_TARGET_OFFSET = 4;
/** The space driver.js leaves around a target: its cutout padding. */
const STAGE_PADDING = 6;
/** Between a target and a popover above it: the stage padding, driver.js's 10 px popover offset, and a margin. */
const POPOVER_GAP = STAGE_PADDING + 10 + 8;
/** The height a popover is assumed to have before the tour has shown one. */
const POPOVER_HEIGHT_GUESS = 240;
/** From this width up, a stop's `side` and `align` place its popover; below it, driver.js puts it where it fits. */
const WIDE_QUERY = '(min-width: 640px)';
/** On `<body>` while the tour moves to another stop: the popover is hidden until the next one renders. */
const MOVING_CLASS = 'piwi-tour-moving';
/** On `<body>` while the tour moves to another page: the overlay is a plain wash, with no cutout. */
const PAGING_CLASS = 'piwi-tour-paging';
/** On the popover once its stop is fully shown: the cutout on the target, the popover in place. */
const SETTLED_ATTRIBUTE = 'data-tour-settled';
/** How often the shown target is checked for having moved, or been replaced by the page. */
const TARGET_CHECK_MS = 250;
/** The element driver.js highlights for a stop it shows centered. */
const CENTERED_ELEMENT_ID = 'driver-dummy-element';
/** The class driver.js gives a highlighted element's parent while it stops that parent from scrolling. */
const PARENT_NO_SCROLL_CLASS = 'driver-active-element-parent-no-scroll';
/** The attributes driver.js writes on a highlighted element and removes when the tour moves on. */
const DRIVER_ARIA = ['aria-haspopup', 'aria-expanded', 'aria-controls'] as const;
/** The toggle of a folded section: a `<button>`, or a `role="button"` header such as `CollapsibleSectionCard`'s. */
const FOLDED_TOGGLE = 'button[aria-expanded="false"], [role="button"][aria-expanded="false"]';
/** The path drawing the spotlight's edge, beside driver.js's own in its overlay. */
const RING_CLASS = 'piwi-tour-ring';
/** On the ring while the stop shows centered, with nothing to outline. */
const RING_OFF_CLASS = 'piwi-tour-ring-off';

const SVG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
/** Lucide's `x`, for the popover's close button. */
const CLOSE_ICON = `<svg ${SVG_ATTRS}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
/** Lucide's `arrow-up-right`, after the docs link, which opens a new tab. */
const EXTERNAL_ICON = `<svg ${SVG_ATTRS}><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>`;

/** A tour in progress; one at a time, in the browser only. */
interface RunningTour {
  profile: TourProfile;
  language: TourLanguage;
  driver?: Driver;
  /** A move to another stop is under way: Next, Back and the arrow keys wait for its popover. */
  moving: boolean;
  /** The tour is navigating: the route guard lets that navigation through. */
  navigating: boolean;
  /** The cutout is travelling to its target: scrolling does not redraw the stop meanwhile. */
  travelling: boolean;
  /** The height of the last popover shown, for making room above the next target. */
  popoverHeight: number;
  /** The stop shown has no target: the popover is centered. */
  centered: boolean;
  /** The spotlight's edge, once driver.js has drawn its overlay. */
  ring?: SVGPathElement;
  /** The `DRIVER_ARIA` values of each highlighted element before driver.js changed them. */
  savedAria: Map<Element, (string | null)[]>;
  /** Removes the listeners the tour added. */
  cleanups: (() => void)[];
}

let running: RunningTour | null = null;
let engine: Promise<typeof import('driver.js')> | null = null;

/** driver.js and the two stylesheets, loaded once, when the first tour starts. */
function loadEngine(): Promise<typeof import('driver.js')> {
  engine ??= Promise.all([
    import('driver.js'),
    import('driver.js/dist/driver.css'),
    import('~/assets/css/demo-tour.css'),
  ]).then(
    ([module]) => module,
    (error: unknown) => {
      engine = null;
      throw error;
    },
  );
  return engine;
}

function readStoredState(): TourPromptState {
  try {
    return readTourPromptState(localStorage.getItem(TOUR_PROMPT_STORAGE_KEY));
  } catch {
    return {};
  }
}

/** Merges `patch` into the stored state. */
function remember(patch: TourPromptState): void {
  try {
    localStorage.setItem(TOUR_PROMPT_STORAGE_KEY, JSON.stringify({ ...readStoredState(), ...patch }));
  } catch {
    // No storage (private browsing, blocked site data): the choice lasts for this visit.
  }
}

/** The stored tour language, else the first tour language the browser prefers. */
function preferredTourLanguage(): TourLanguage {
  const stored = readStoredState().language;
  if (stored) return stored;
  return pickTourLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

function isWide(): boolean {
  return window.matchMedia(WIDE_QUERY).matches;
}

/** The elements that scroll `element` vertically, nearest first, then the document when it scrolls. */
function scrollPanels(element: Element): Element[] {
  const panels: Element[] = [];
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (node.scrollHeight <= node.clientHeight) continue;
    if (/auto|scroll/.test(getComputedStyle(node).overflowY) || node.classList.contains(PARENT_NO_SCROLL_CLASS)) {
      panels.push(node);
    }
  }
  const page = document.scrollingElement;
  if (page && page.scrollHeight > page.clientHeight && !panels.includes(page)) panels.push(page);
  return panels;
}

/**
 * Scrolls each panel holding `element`, nearest first, so its top edge sits
 * `TARGET_OFFSET` px below the panel's top, and at least `minTop` px below the
 * top of the viewport.
 */
function scrollToTarget(element: Element, minTop: number): void {
  for (const panel of scrollPanels(element)) {
    const panelTop = panel === document.scrollingElement ? 0 : panel.getBoundingClientRect().top;
    const goal = Math.max(panelTop + TARGET_OFFSET, minTop);
    panel.scrollTop += element.getBoundingClientRect().top - goal;
  }
}

/** Scrolls the panels holding `element` up until a popover `height` px tall fits above it. */
function makeRoomAbove(element: Element, height: number): void {
  let missing = height + POPOVER_GAP - element.getBoundingClientRect().top;
  for (const panel of scrollPanels(element)) {
    if (missing <= 0) return;
    const step = Math.min(missing, panel.scrollTop);
    panel.scrollTop -= step;
    missing -= step;
  }
}

/**
 * Scrolls the panels holding `element` down until a popover `height` px tall
 * fits under it, as far as each panel scrolls and with the target's top edge
 * kept `MIN_TARGET_OFFSET` px below the panel's top.
 */
function makeRoomBelow(element: Element, height: number): void {
  let missing = element.getBoundingClientRect().bottom + POPOVER_GAP + height - window.innerHeight;
  for (const panel of scrollPanels(element)) {
    if (missing <= 0) return;
    const panelTop = panel === document.scrollingElement ? 0 : panel.getBoundingClientRect().top;
    const above = element.getBoundingClientRect().top - panelTop - MIN_TARGET_OFFSET;
    const left = panel.scrollHeight - panel.clientHeight - panel.scrollTop;
    const step = Math.max(0, Math.min(missing, above, left));
    panel.scrollTop += step;
    missing -= step;
  }
}

/** The first element `selector` matches once it renders, or `null` after `timeoutMs`. */
async function rendered(selector: string, timeoutMs: number): Promise<Element | null> {
  const deadline = Date.now() + timeoutMs;
  let found = document.querySelector(selector);
  while (!found && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    found = document.querySelector(selector);
  }
  return found;
}

/** Opens the folded section `section` (a `data-tour` value), when it is folded. */
async function unfold(section: string): Promise<void> {
  const host = await rendered(`[data-tour="${section}"]`, UNFOLD_WAIT_MS);
  const toggle = host?.matches(FOLDED_TOGGLE) ? host : host?.querySelector(FOLDED_TOGGLE);
  if (!(toggle instanceof HTMLElement)) return;
  toggle.click();
  await nextTick();
}

function docsLink(doc: string, label: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'piwi-tour-docs';
  link.href = docsUrl(doc);
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = label;
  link.insertAdjacentHTML('beforeend', EXTERNAL_ICON);
  return link;
}

/** Remembers the `DRIVER_ARIA` values of `element` before driver.js highlights it. */
function saveAria(run: RunningTour, element: Element): void {
  if (run.savedAria.has(element)) return;
  run.savedAria.set(
    element,
    DRIVER_ARIA.map((name) => element.getAttribute(name)),
  );
}

/** Puts back the `DRIVER_ARIA` values of every element driver.js no longer highlights, or of all of them. */
function restoreAria(run: RunningTour, highlighted?: Element): void {
  for (const [element, values] of run.savedAria) {
    if (element === highlighted) continue;
    DRIVER_ARIA.forEach((name, i) => {
      const value = values[i];
      if (value == null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    });
    run.savedAria.delete(element);
  }
}

/**
 * Makes driver.js's `scrollIntoView` call on `element`, for a target not
 * entirely in view, do nothing during the highlight starting now: the tour
 * scrolls the target's panels itself (`scrollToTarget`), never the layout
 * around them.
 */
function holdScrollIntoView(element: Element): void {
  element.scrollIntoView = () => {};
  queueMicrotask(() => Reflect.deleteProperty(element, 'scrollIntoView'));
}

/**
 * Draws the spotlight's edge (`RING_CLASS`, styled in demo-tour.css) in
 * driver.js's overlay, once the overlay exists: a second path that copies the
 * cutout's outline from the overlay's path on every change, so it follows the
 * cutout as it moves, and no `overflow` of the page clips it.
 */
function attachRing(run: RunningTour): void {
  if (running !== run || run.ring?.isConnected) return;
  const overlayPath = document.querySelector('svg.driver-overlay > path');
  if (!overlayPath) return;
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  ring.classList.add(RING_CLASS);
  ring.classList.toggle(RING_OFF_CLASS, run.centered);
  overlayPath.after(ring);
  // The overlay's path is the screen-wide rectangle, closed with `Z`, then the cutout.
  const follow = () => {
    const d = overlayPath.getAttribute('d') ?? '';
    ring.setAttribute('d', d.slice(d.indexOf('Z') + 1));
  };
  follow();
  const observer = new MutationObserver(follow);
  observer.observe(overlayPath, { attributes: true, attributeFilter: ['d'] });
  run.ring = ring;
  run.cleanups.push(() => observer.disconnect());
}

/** Whether the router is on `path` already: the same path, with each query value `path` names. */
function isOnRoute(path: string, router: ReturnType<typeof useRouter>): boolean {
  const target = router.resolve(path);
  const current = router.currentRoute.value;
  return (
    target.path === current.path &&
    Object.entries(target.query).every(([key, value]) => String(current.query[key]) === String(value))
  );
}

/**
 * The demo's guided tour: the prompt's state, what the browser decided about it
 * (`localStorage['piwi-demo-tour']`), the tour language, and the tour itself,
 * which drives driver.js across the pages of a role's stops.
 */
export function useDemoTour() {
  const router = useRouter();
  const nuxtApp = useNuxtApp();
  const toast = useToast();

  const language = useState<TourLanguage>('demo-tour-language', () =>
    import.meta.client ? preferredTourLanguage() : DEFAULT_TOUR_LANGUAGE,
  );
  const promptOpen = useState('demo-tour-prompt-open', () => false);
  const activeProfileId = useState<TourProfileId | null>('demo-tour-profile', () => null);

  const copy = computed(() => tourCopyFor(language.value));
  const isRunning = computed(() => activeProfileId.value !== null);

  /** One of the tour's own words, in the tour language. */
  function t(key: TourUiKey): string {
    return copy.value.ui[key];
  }

  /** Takes the stored language, or the browser's; the server renders in English. */
  function restoreLanguage(): void {
    language.value = preferredTourLanguage();
  }

  function setLanguage(next: TourLanguage): void {
    language.value = next;
    remember({ language: next });
  }

  /** Shows the prompt, ending a running tour. */
  function openPrompt(): void {
    stop();
    promptOpen.value = true;
  }

  /** **Later**: closes the prompt, which opens by itself again on a visit a day later. */
  function snooze(): void {
    promptOpen.value = false;
    remember({ decision: 'snoozed', decidedAt: Date.now() });
  }

  /** **×**: closes the prompt for good; the banner button still opens it. */
  function dismiss(): void {
    promptOpen.value = false;
    remember({ decision: 'dismissed', decidedAt: Date.now() });
  }

  /** Starts a role's tour at its first stop. */
  async function start(profileId: TourProfileId): Promise<void> {
    const profile = TOUR_PROFILES.find((p) => p.id === profileId);
    if (import.meta.server || !profile) return;
    stop();
    promptOpen.value = false;
    remember({ decision: 'started', decidedAt: Date.now() });
    const run: RunningTour = {
      profile,
      language: language.value,
      moving: false,
      navigating: false,
      travelling: false,
      popoverHeight: POPOVER_HEIGHT_GUESS,
      centered: false,
      savedAria: new Map(),
      cleanups: [],
    };
    running = run;
    activeProfileId.value = profileId;
    watchPage(run);
    await goTo(run, 0);
  }

  /** Ends the running tour, if any. */
  function stop(): void {
    const run = running;
    if (!run) return;
    running = null;
    activeProfileId.value = null;
    for (const cleanup of run.cleanups.splice(0)) cleanup();
    document.body.classList.remove(MOVING_CLASS, PAGING_CLASS);
    if (run.driver?.isActive()) run.driver.destroy();
    restoreAria(run);
  }

  /** **Done** on the last stop: ends the tour and says where the other tours are. */
  function finish(run: RunningTour): void {
    const words = tourCopyFor(run.language).ui;
    stop();
    toast.add({
      title: words.finishedTitle,
      description: words.finishedBody,
      color: 'neutral',
      icon: 'i-lucide-compass',
    });
  }

  /**
   * Shows stop `index`: opens its page first when it is on another one, then
   * its folded section, then highlights it. The tour makes every move itself,
   * Next and Back included.
   */
  async function goTo(run: RunningTour, index: number): Promise<void> {
    const tourStop = run.profile.stops[index];
    if (running !== run || run.moving || !tourStop) return;
    run.moving = true;
    document.body.classList.add(MOVING_CLASS);
    run.driver?.getState('popover')?.wrapper.removeAttribute(SETTLED_ATTRIBUTE);
    try {
      if (tourStop.route && !isOnRoute(tourStop.route, router)) {
        if (run.driver?.isActive()) document.body.classList.add(PAGING_CLASS);
        await navigate(run, tourStop.route);
      }
      if (running === run && tourStop.unfold) await unfold(tourStop.unfold);
      if (running !== run) return;
      const instance = run.driver ?? (run.driver = (await loadEngine()).driver(configFor(run)));
      if (running !== run) return;
      instance.setConfig({ ...instance.getConfig(), steps: stepsFor(run) });
      if (instance.isActive()) instance.moveTo(index);
      else instance.drive(index);
    } catch (error) {
      if (running === run) stop();
      console.error('[demo tour]', error);
    }
  }

  /** Navigates to `path` and, when that opens another page, waits for Nuxt to show it. */
  async function navigate(run: RunningTour, path: string): Promise<void> {
    const opensPage = router.resolve(path).path !== router.currentRoute.value.path;
    const shown = opensPage ? pageShown() : Promise.resolve();
    run.navigating = true;
    try {
      await router.push(path);
    } finally {
      run.navigating = false;
    }
    await shown;
  }

  /** Resolves on Nuxt's next `page:finish`, or after `PAGE_WAIT_MS`. */
  function pageShown(): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        unhook();
        resolve();
      };
      const timer = setTimeout(done, PAGE_WAIT_MS);
      const unhook = nuxtApp.hook('page:finish', done);
    });
  }

  /**
   * Ends the tour on a navigation it did not make (the back button, a
   * shortcut); redraws the stop when a panel scrolls (driver.js follows the
   * window's scrolling only), once per frame; and every `TARGET_CHECK_MS`,
   * redraws it when its target moved without a scroll (content loading above
   * it) and looks the target up again when the page replaced it.
   */
  function watchPage(run: RunningTour): void {
    const removeGuard = router.afterEach((to, from, failure) => {
      if (!failure && !run.navigating && to.path !== from.path) stop();
    });
    const onHistory = () => stop();
    let redrawn = false;
    const onScroll = () => {
      if (redrawn || run.travelling || !run.driver?.isActive()) return;
      redrawn = true;
      run.driver.refresh();
      requestAnimationFrame(() => {
        redrawn = false;
      });
    };
    let lastBox = '';
    const checkTarget = () => {
      const instance = run.driver;
      const element = instance?.getActiveElement();
      if (!instance?.isActive() || run.moving || run.travelling || !element) return;
      if (element.id === CENTERED_ELEMENT_ID) return;
      if (!element.isConnected) {
        void goTo(run, instance.getActiveIndex() ?? 0);
        return;
      }
      const { top, left, width, height } = element.getBoundingClientRect();
      const box = `${top} ${left} ${width} ${height}`;
      if (box !== lastBox) instance.refresh();
      lastBox = box;
    };
    window.addEventListener('popstate', onHistory);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    const timer = window.setInterval(checkTarget, TARGET_CHECK_MS);
    run.cleanups.push(
      removeGuard,
      () => window.removeEventListener('popstate', onHistory),
      () => document.removeEventListener('scroll', onScroll, { capture: true }),
      () => window.clearInterval(timer),
    );
  }

  /** The driver.js steps of `run`, with the popover sides that apply at the current width. */
  function stepsFor(run: RunningTour): DriveStep[] {
    const wide = isWide();
    return run.profile.stops.map((tourStop) => {
      const words = stopCopy(run.language, run.profile.id, tourStop.id);
      const selector = tourStop.target ? `[data-tour="${tourStop.target}"]` : undefined;
      return {
        // Looked up again on every move; driver.js shows the stop centered when it finds nothing.
        element: selector ? () => document.querySelector(selector) as Element : undefined,
        waitForElement: selector ? TARGET_WAIT_MS : 0,
        popover: {
          title: tourMarkup(words?.title ?? ''),
          description: tourMarkup(words?.body ?? ''),
          side: wide ? tourStop.side : undefined,
          align: wide ? tourStop.align : undefined,
        },
      };
    });
  }

  function configFor(run: RunningTour): Config {
    const words = tourCopyFor(run.language).ui;
    const activeIndex = () => run.driver?.getActiveIndex() ?? 0;
    return {
      animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      smoothScroll: false,
      allowClose: true,
      overlayClickBehavior: () => {},
      // Its opacity, which depends on the color mode, is set in demo-tour.css.
      overlayColor: '#000',
      stagePadding: STAGE_PADDING,
      stageRadius: 8,
      disableActiveInteraction: true,
      popoverClass: 'piwi-tour',
      showProgress: true,
      progressText: escapeTourHtml(words.progress),
      nextBtnText: escapeTourHtml(words.next),
      prevBtnText: escapeTourHtml(words.back),
      doneBtnText: escapeTourHtml(words.done),
      onNextClick: () => void goTo(run, activeIndex() + 1),
      onPrevClick: () => void goTo(run, activeIndex() - 1),
      onDoneClick: () => finish(run),
      // On × and Escape.
      onDestroyStarted: () => stop(),
      onHighlightStarted: (element, step) => {
        run.travelling = true;
        run.centered = !element;
        run.ring?.classList.toggle(RING_OFF_CLASS, run.centered);
        // driver.js draws its overlay on the frame after the tour's first highlight starts.
        requestAnimationFrame(() => requestAnimationFrame(() => attachRing(run)));
        // driver.js moves its attributes from the last target to this one right after this hook.
        queueMicrotask(() => restoreAria(run, element));
        if (!element) return;
        saveAria(run, element);
        const opensAbove = step.popover?.side === 'top';
        scrollToTarget(element, opensAbove ? run.popoverHeight + POPOVER_GAP : 0);
        holdScrollIntoView(element);
      },
      onHighlighted: () => {
        run.travelling = false;
        attachRing(run);
        run.driver?.getState('popover')?.wrapper.setAttribute(SETTLED_ATTRIBUTE, '');
        run.driver?.refresh();
      },
      onPopoverRender: (popover, { state }) => {
        const index = state.activeIndex;
        decorate(run, popover, index === undefined ? undefined : run.profile.stops[index], state.activeElement);
      },
    };
  }

  /**
   * Finishes a popover driver.js just rendered: what the built-demo check reads
   * (`lang`, `data-tour-profile`, `data-tour-stop`, `data-tour-target`, empty
   * for a stop shown centered), the localized close button, the docs link, room
   * above the target for a popover that opens above it, room under it for one
   * that opens below it (every popover below `sm`), and focus on Next.
   */
  function decorate(run: RunningTour, popover: PopoverDOM, tourStop: TourStop | undefined, element?: Element): void {
    const words = tourCopyFor(run.language).ui;
    const { wrapper, closeButton, description, nextButton } = popover;
    const centered = !element || element.id === CENTERED_ELEMENT_ID;
    wrapper.lang = run.language;
    wrapper.dataset.tourProfile = run.profile.id;
    wrapper.dataset.tourStop = tourStop?.id ?? '';
    wrapper.dataset.tourTarget = centered ? '' : (tourStop?.target ?? '');
    // The popover is fixed: driver.js's scrollIntoView call on it does nothing.
    wrapper.scrollIntoView = () => {};
    closeButton.innerHTML = CLOSE_ICON;
    closeButton.setAttribute('aria-label', words.close);
    closeButton.title = words.close;
    if (tourStop?.doc) description.after(docsLink(tourStop.doc, words.docs));
    run.moving = false;
    document.body.classList.remove(MOVING_CLASS, PAGING_CLASS);
    run.popoverHeight = wrapper.offsetHeight;
    if (!centered && element) {
      const side = isWide() ? tourStop?.side : 'bottom';
      if (side === 'top') makeRoomAbove(element, run.popoverHeight);
      if (side === 'bottom') makeRoomBelow(element, run.popoverHeight);
    }
    // driver.js focuses the popover's first control, its ×, right after this.
    queueMicrotask(() => nextButton.focus({ preventScroll: true }));
  }

  return {
    language: readonly(language),
    promptOpen: readonly(promptOpen),
    activeProfileId: readonly(activeProfileId),
    isRunning,
    copy,
    t,
    restoreLanguage,
    setLanguage,
    openPrompt,
    snooze,
    dismiss,
    start,
    stop,
    /** What this browser decided about the prompt, from `localStorage`. */
    storedState: readStoredState,
  };
}
