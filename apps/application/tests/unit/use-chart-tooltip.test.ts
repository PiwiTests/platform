import { describe, test, expect, vi, afterEach } from 'vitest';
import { ref } from 'vue';
import { useChartTooltip } from '../../app/composables/useChartTooltip';

/**
 * The tooltip follows the cursor but must stay inside the viewport: it flips to
 * the left of the cursor near the right edge and clamps against every side.
 * Nuxt auto-imports `ref`, and the viewport is read off `window`, so both are
 * stubbed as globals.
 */
function stubViewport(innerWidth: number, innerHeight: number) {
  vi.stubGlobal('ref', ref);
  vi.stubGlobal('window', { innerWidth, innerHeight });
}

const at = (clientX: number, clientY: number) => ({ clientX, clientY }) as MouseEvent;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useChartTooltip', () => {
  test('sits to the right of the cursor when there is room', () => {
    stubViewport(1000, 800);
    const { pos, move } = useChartTooltip();
    move(at(100, 300));
    expect(pos.value).toEqual({ x: 112, y: 288 });
  });

  test('flips to the left of the cursor near the right edge', () => {
    stubViewport(1000, 800);
    const { pos, move } = useChartTooltip();
    move(at(900, 300));
    expect(pos.value.x).toBe(900 - 260 - 12);
  });

  test('clamps to the left margin when neither side fits', () => {
    stubViewport(280, 800);
    const { pos, move } = useChartTooltip();
    move(at(100, 300));
    expect(pos.value.x).toBe(8);
  });

  test('keeps the tooltip clear of the top and bottom edges', () => {
    stubViewport(1000, 800);
    const { pos, move } = useChartTooltip();
    move(at(100, 0));
    expect(pos.value.y).toBe(8);
    move(at(100, 900));
    expect(pos.value.y).toBe(800 - 160);
  });

  test('honors a custom tooltip width when deciding to flip', () => {
    stubViewport(1000, 800);
    const { pos, move } = useChartTooltip(240);
    move(at(900, 300));
    expect(pos.value.x).toBe(900 - 240 - 12);
  });

  test('show sets the payload and positions it, hide clears only the payload', () => {
    stubViewport(1000, 800);
    const { data, pos, show, hide } = useChartTooltip<{ id: number }>();
    expect(data.value).toBeNull();

    show(at(100, 300), { id: 7 });
    expect(data.value).toEqual({ id: 7 });
    expect(pos.value).toEqual({ x: 112, y: 288 });

    hide();
    expect(data.value).toBeNull();
    expect(pos.value).toEqual({ x: 112, y: 288 });
  });
});
