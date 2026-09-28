import { describe, expect, test } from 'vitest';
import { hides, reveals, splitSelectorList, withMarker } from '../../src/content/hover-rules';

describe('hover rules', () => {
  test('splits a selector list on its top-level commas only', () => {
    expect(splitSelectorList('.row:hover .actions, :is(.a, .b):hover > ul, [data-x="a,b"]')).toEqual([
      '.row:hover .actions',
      ':is(.a, .b):hover > ul',
      '[data-x="a,b"]',
    ]);
  });

  test('writes :hover as the marker, never inside an escaped class name', () => {
    expect(withMarker(':is(.group-hover\\:visible):is(:where(.group):hover *)', 'data-m')).toBe(
      ':is(.group-hover\\:visible):is(:where(.group)[data-m] *)',
    );
    expect(withMarker('li:hover > ul, .a\\:hover:hover', 'data-m')).toBe('li[data-m] > ul, .a\\:hover[data-m]');
  });

  test('tells a value that hides from one that shows', () => {
    expect(hides('display', 'none')).toBe(true);
    expect(reveals('display', 'flex')).toBe(true);
    expect(hides('visibility', 'collapse')).toBe(true);
    expect(reveals('visibility', 'hidden')).toBe(false);
    expect(hides('opacity', '0')).toBe(true);
    expect(reveals('opacity', '0.5')).toBe(true);
    expect(hides('pointer-events', 'none')).toBe(true);
    expect(reveals('pointer-events', 'auto')).toBe(true);
  });
});
