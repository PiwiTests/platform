import { ref, computed, onMounted, onUnmounted, nextTick, watchEffect, type Ref, type ComputedRef } from 'vue';
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

  const tickMarks = computed<{ ms: number; x: number; label: string }[]>(() => {
    const ticks: { ms: number; x: number; label: string }[] = [];
    const step = zoom.value < 0.5 ? 10000 : zoom.value < 1 ? 5000 : zoom.value < 2 ? 2000 : 1000;
    for (let ms = 0; ms <= maxTime.value; ms += step) {
      ticks.push({ ms, x: ms * pxPerMs.value + labelWidth, label: formatTimelineTime(ms) });
    }
    return ticks;
  });

  function onWheel(event: WheelEvent): void {
    if (live()) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.02 : 0.02;
    const fitZoom = computeFitZoom();
    const newZoom = Math.max(fitZoom, Math.min(10, zoom.value + delta));

    if (containerRef.value) {
      const rect = containerRef.value.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const scale = newZoom / zoom.value;
      panX.value = clampPanX(mouseX - (mouseX - panX.value) * scale);
    }

    zoom.value = newZoom;
  }

  function onMouseDown(event: MouseEvent): void {
    if (live()) return;
    if (event.button !== 0) return;
    isPanning.value = true;
    panStartX.value = event.clientX;
    panStartOffsetX.value = panX.value;
    event.preventDefault();
  }

  function onMouseMove(event: MouseEvent): void {
    if (!isPanning.value) return;
    panX.value = clampPanX(panStartOffsetX.value + (event.clientX - panStartX.value));
  }

  function onMouseUp(): void {
    isPanning.value = false;
  }

  function resetView(): void {
    applyFitZoom();
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

  // While live, re-fit as new rows stream in so the run stays framed.
  watchEffect(() => {
    if (live() && hasData.value) {
      nextTick(applyFitZoom);
    }
  });

  return {
    zoom,
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
    onMouseDown,
    onMouseMove,
    onMouseUp,
    resetView,
  };
}
