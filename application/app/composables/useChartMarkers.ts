import type { Ref } from 'vue';

/**
 * Shared interactive-marker + tooltip logic for the @unovis/vue trend charts.
 *
 * All trend charts (pass rate, test runs, performance, test-case history) render
 * a line/area via VisXYContainer and then inject clickable SVG circles at each
 * data point with a floating tooltip. This composable owns that injection and
 * the tooltip position state so each chart only supplies its accessors and
 * tooltip markup.
 *
 * Usage:
 * ```ts
 * const xyContainerRef = ref<UnovisContainerRef | null>(null);
 * const { tooltipData, tooltipPos, onRenderComplete } = useChartMarkers(xyContainerRef, chartData, {
 *   x: (d) => d.date,
 *   series: [{ y: (d) => d.value, color: 'rgb(34, 197, 94)' }],
 *   onClick: (d) => navigateTo(`/test-runs/${d.id}`),
 * });
 * ```
 * Then bind `:on-render-complete="onRenderComplete"` on the VisXYContainer.
 */

interface ChartMargin {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Shape of the @unovis/vue container instance exposed via a template ref. */
export interface UnovisContainerRef {
  component?: {
    // xScale/yScale live on the first child component (VisLine/VisArea), not the container.
    components?: Array<{
      xScale?: (v: Date | number) => number;
      yScale?: (v: number) => number;
    }>;
  };
}

export interface ChartSeries<T> {
  y: (d: T) => number | null | undefined;
  /** Solid color string, or a per-point function (e.g. green when passing). */
  color: string | ((d: T) => string);
}

export interface ChartMarkerOptions<T> {
  x: (d: T) => Date | number;
  series: ChartSeries<T>[];
  radius?: number;
  hoverRadius?: number;
  strokeWidth?: number;
  hoverStrokeWidth?: number;
  /** Tooltip width used to flip it left of the cursor near the viewport edge. */
  tooltipWidth?: number;
  onClick?: (d: T) => void;
}

const NS = 'http://www.w3.org/2000/svg';

export function useChartMarkers<T>(
  containerRef: Ref<UnovisContainerRef | null>,
  data: Ref<T[]>,
  options: ChartMarkerOptions<T>,
) {
  const tooltipData = ref<T | null>(null) as Ref<T | null>;
  const tooltipPos = ref({ x: 0, y: 0 });

  const radius = options.radius ?? 4.5;
  const hoverRadius = options.hoverRadius ?? radius + 2.5;
  const strokeWidth = options.strokeWidth ?? 1.5;
  const hoverStrokeWidth = options.hoverStrokeWidth ?? 2.5;
  const tooltipWidth = options.tooltipWidth ?? 260;

  function onRenderComplete(svgNode: SVGSVGElement, margin: ChartMargin) {
    svgNode.querySelectorAll('.chart-marker').forEach((el) => el.remove());

    const comp = containerRef.value?.component?.components?.[0];
    const xScale = comp?.xScale;
    const yScale = comp?.yScale;
    if (!xScale || !yScale || !data.value.length) return;

    const group = document.createElementNS(NS, 'g');
    group.setAttribute('class', 'chart-marker');
    group.setAttribute('transform', `translate(${margin.left},${margin.top})`);
    svgNode.appendChild(group);

    for (const point of data.value) {
      const cx = xScale(options.x(point));
      for (const s of options.series) {
        const yVal = s.y(point);
        if (yVal == null) continue;
        const cy = yScale(yVal);
        const color = typeof s.color === 'function' ? s.color(point) : s.color;

        const circle = document.createElementNS(NS, 'circle');
        circle.setAttribute('cx', String(cx));
        circle.setAttribute('cy', String(cy));
        circle.setAttribute('r', String(radius));
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', '#fff');
        circle.setAttribute('stroke-width', String(strokeWidth));
        circle.setAttribute('cursor', 'pointer');
        if (options.onClick) {
          circle.addEventListener('click', () => options.onClick!(point));
        }
        circle.addEventListener('mouseenter', () => {
          circle.setAttribute('r', String(hoverRadius));
          circle.setAttribute('stroke-width', String(hoverStrokeWidth));
          tooltipData.value = point;
        });
        circle.addEventListener('mousemove', (e: MouseEvent) => {
          const offset = 12;
          const x =
            e.clientX + offset + tooltipWidth > window.innerWidth - 8
              ? e.clientX - tooltipWidth - offset
              : e.clientX + offset;
          tooltipPos.value = { x, y: e.clientY - 12 };
        });
        circle.addEventListener('mouseleave', () => {
          circle.setAttribute('r', String(radius));
          circle.setAttribute('stroke-width', String(strokeWidth));
          tooltipData.value = null;
        });
        group.appendChild(circle);
      }
    }
  }

  return { tooltipData, tooltipPos, onRenderComplete };
}
