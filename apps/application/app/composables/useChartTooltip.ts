import type { Ref } from 'vue';

/**
 * Fixed-position tooltip state for the SVG trend charts. Charts bind
 * `show`/`move`/`hide` to pointer events on their hover targets and render a
 * `ChartTooltip` (or `ChartMarkerTooltip`) at `pos` while `data` is set.
 */
export function useChartTooltip<T>(width = 260) {
  const data = ref<T | null>(null) as Ref<T | null>;
  const pos = ref({ x: 0, y: 0 });

  function move(e: MouseEvent) {
    const offset = 12;
    const margin = 8;
    let x = e.clientX + offset + width > window.innerWidth - margin ? e.clientX - width - offset : e.clientX + offset;
    x = Math.max(margin, Math.min(x, window.innerWidth - width - margin));
    const y = Math.max(margin, Math.min(e.clientY - 12, window.innerHeight - 160));
    pos.value = { x, y };
  }

  function show(e: MouseEvent, d: T) {
    data.value = d;
    move(e);
  }

  function hide() {
    data.value = null;
  }

  return { data, pos, show, move, hide };
}
