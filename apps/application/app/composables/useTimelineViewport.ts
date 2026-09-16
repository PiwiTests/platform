import { ref, computed, watch, onMounted, onUnmounted, nextTick, type Ref, type ComputedRef } from 'vue';
import { TIMELINE_LAYOUT, formatTimelineTime } from '~/utils/timeline';

interface BarGeometry {
  start: number;
  duration: number;
  rowIndex: number;
}

interface TimelineViewportOptions {
  containerRef: Ref<HTMLElement | null>;
  maxTime: ComputedRef<number>;
  rowCount: ComputedRef<number>;
  hasData: ComputedRef<boolean>;
  /** Getter for the run's live state — panning/zoom are disabled while live. */
  live: () => boolean | undefined;
}

/** Multiplier applied per wheel notch — multiplicative so zooming feels uniform at every level. */
const WHEEL_ZOOM_FACTOR = 1.12;
/** Deep enough to read individual steps once a test row is expanded. */
const MAX_ZOOM = 40;

/** Tick spacing aims for roughly this many pixels between axis labels. */
const TICK_TARGET_PX = 100;
/** Nice tick steps (ms): 10ms up to 1h, roughly 1-2-5 per decade. */
const TICK_STEPS_MS = [
  10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000,
  3600000,
];

/**
 * Owns the timeline viewport: zoom level, horizontal pan, fit-to-width, the
 * px-per-ms scale, derived SVG dimensions, per-bar geometry, axis ticks, and the
 * wheel/drag interaction handlers. Auto-fits on mount, on container resize, and
 * (while live) as new data streams in.
 */
export function useTimelineViewport(opts: TimelineViewportOptions) {
  const { containerRef, maxTime, rowCount, hasData, live } = opts;
  const { labelWidth, sidePadding, axisHeight, rowHeight } = TIMELINE_LAYOUT;

  const zoom = ref(1);
  const panX = ref(0);
  const isPanning = ref(false);
  const panStartX = ref(0);
  const panStartOffsetX = ref(0);

  const pxPerMs = computed(() => 0.5 * zoom.value);
  const contentWidth = computed(() => maxTime.value * pxPerMs.value + labelWidth + sidePadding);
  const contentHeight = computed(() => rowCount.value * rowHeight + axisHeight);

  function getBarX(item: BarGeometry): number {
    return item.start * pxPerMs.value + labelWidth;
  }

  function getBarWidth(item: BarGeometry): number {
    return Math.max(item.duration * pxPerMs.value, 3);
  }

  function getBarTop(item: BarGeometry): number {
    return item.rowIndex * rowHeight + axisHeight;
  }

  function computeFitZoom(): number {
    const cw = containerRef.value?.clientWidth;
    if (!cw || maxTime.value <= 0) return 1;
    const minPxPerMs = (cw - labelWidth) / maxTime.value;
    return Math.min(1, minPxPerMs / 0.5);
  }

  function applyFitZoom(): void {
    const z = computeFitZoom();
    if (z > 0) {
      zoom.value = z;
      panX.value = 0;
    }
  }

  function clampPanX(raw: number): number {
    if (!containerRef.value) return raw;
    const cw = containerRef.value.clientWidth;
    if (contentWidth.value <= cw) return 0;
    return Math.max(cw - contentWidth.value, Math.min(0, raw));
  }

  /** Zoom around a fixed x position (px within the container), clamped to [fit, MAX_ZOOM]. */
  function zoomAround(newZoomRaw: number, anchorX: number): void {
    const newZoom = Math.max(computeFitZoom(), Math.min(MAX_ZOOM, newZoomRaw));
    const scale = newZoom / zoom.value;
    zoom.value = newZoom;
    panX.value = clampPanX(anchorX - (anchorX - panX.value) * scale);
  }

  const tickMarks = computed<{ ms: number; x: number; label: string }[]>(() => {
    // Smallest nice step that keeps ticks at least TICK_TARGET_PX apart...
    const idealStep = TICK_TARGET_PX / pxPerMs.value;
    let step = TICK_STEPS_MS.find((s) => s >= idealStep) ?? TICK_STEPS_MS[TICK_STEPS_MS.length - 1]!;
    // ...with a hard cap on tick count so extreme zoom×duration combinations
    // can't flood the SVG with thousands of nodes.
    while (maxTime.value / step > 1000) step *= 2;

    const ticks: { ms: number; x: number; label: string }[] = [];
    for (let ms = 0; ms <= maxTime.value; ms += step) {
      ticks.push({ ms, x: ms * pxPerMs.value + labelWidth, label: formatTimelineTime(ms) });
    }
    return ticks;
  });

  function onWheel(event: WheelEvent): void {
    if (live()) return;
    const factor = event.deltaY > 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR;
    const rect = containerRef.value?.getBoundingClientRect();
    zoomAround(zoom.value * factor, rect ? event.clientX - rect.left : 0);
  }

  // ── Pointer / touch interaction ──────────────────────────────────────────────
  // Pointer events unify mouse + touch + pen: one finger (or the primary mouse
  // button) pans, two fingers pinch-zoom. `touch-action: pan-y` on the container
  // (set in the template) lets vertical page scroll pass through while we own
  // horizontal drag + pinch.
  //
  // Capturing the pointer retargets the eventual `click` to the container, which
  // would swallow the bars' click-to-select. So a press only *arms* a pan; the
  // capture + pan engage once the pointer actually travels, and a motionless
  // press-release stays a plain click on the bar underneath.
  const DRAG_THRESHOLD_PX = 4;
  const activePointers = new Map<number, { x: number; y: number }>();
  let armedPanPointerId: number | null = null;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let pinchCenterX = 0;

  function armPanFrom(pointerId: number, clientX: number): void {
    armedPanPointerId = pointerId;
    panStartX.value = clientX;
    panStartOffsetX.value = panX.value;
  }

  function onPointerDown(event: PointerEvent): void {
    if (live()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size === 1) {
      armPanFrom(event.pointerId, event.clientX);
    } else if (activePointers.size === 2) {
      // A second finger switches to pinch-zoom — that gesture can never be a
      // click, so capture both pointers right away.
      armedPanPointerId = null;
      isPanning.value = false;
      for (const id of activePointers.keys()) containerRef.value?.setPointerCapture?.(id);
      const [a, b] = [...activePointers.values()];
      pinchStartDist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
      pinchStartZoom = zoom.value;
      const rect = containerRef.value?.getBoundingClientRect();
      pinchCenterX = (a!.x + b!.x) / 2 - (rect?.left ?? 0);
    }
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent): void {
    if (live() || !activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size >= 2) {
      const [a, b] = [...activePointers.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
      zoomAround(pinchStartZoom * (dist / pinchStartDist), pinchCenterX);
      return;
    }

    if (isPanning.value) {
      panX.value = clampPanX(panStartOffsetX.value + (event.clientX - panStartX.value));
    } else if (armedPanPointerId === event.pointerId && Math.abs(event.clientX - panStartX.value) > DRAG_THRESHOLD_PX) {
      // Enough travel — this is a drag, not a click. Engage the pan and let the
      // container own the pointer for the rest of the gesture.
      containerRef.value?.setPointerCapture?.(event.pointerId);
      isPanning.value = true;
      panX.value = clampPanX(panStartOffsetX.value + (event.clientX - panStartX.value));
    }
  }

  function onPointerUp(event: PointerEvent): void {
    activePointers.delete(event.pointerId);
    if (armedPanPointerId === event.pointerId) armedPanPointerId = null;
    containerRef.value?.releasePointerCapture?.(event.pointerId);
    if (activePointers.size === 1) {
      // Dropped from pinch to a single finger — re-arm panning from it.
      const [remaining] = [...activePointers.entries()];
      armPanFrom(remaining![0], remaining![1].x);
    } else if (activePointers.size === 0) {
      isPanning.value = false;
    }
  }

  function resetView(): void {
    applyFitZoom();
  }

  /**
   * Frame a time range (ms, in the model's coordinate space) so it fills most of
   * the viewport, clamped to the zoom bounds. Used to jump to a test's own span
   * when its step waterfall is expanded, since at run-fit zoom the steps are
   * sub-pixel.
   */
  function zoomToRange(startMs: number, endMs: number): void {
    const cw = containerRef.value?.clientWidth;
    if (!cw || endMs <= startMs) return;
    const targetPxPerMs = ((cw - labelWidth) * 0.82) / (endMs - startMs);
    const newZoom = Math.max(computeFitZoom(), Math.min(MAX_ZOOM, targetPxPerMs / 0.5));
    zoom.value = newZoom;
    const centerPx = ((startMs + endMs) / 2) * (0.5 * newZoom) + labelWidth;
    panX.value = clampPanX(cw / 2 - centerPx);
  }

  let resizeObserver: ResizeObserver | null = null;
  onMounted(() => {
    nextTick(applyFitZoom);
    if (containerRef.value) {
      resizeObserver = new ResizeObserver(() => applyFitZoom());
      resizeObserver.observe(containerRef.value);
    }
  });

  onUnmounted(() => {
    resizeObserver?.disconnect();
  });

  // While live, re-fit whenever the data extents grow so the run stays framed
  // (the time span can grow without the row count — and thus the container
  // size — changing, so the ResizeObserver alone isn't enough).
  watch(
    () => [live(), hasData.value, maxTime.value, rowCount.value] as const,
    ([isLive, has]) => {
      if (isLive && has) nextTick(applyFitZoom);
    },
  );

  return {
    panX,
    isPanning,
    pxPerMs,
    contentWidth,
    contentHeight,
    getBarX,
    getBarWidth,
    getBarTop,
    tickMarks,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    resetView,
    zoomToRange,
  };
}
