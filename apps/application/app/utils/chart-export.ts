/**
 * Exporting one chart: its SVG drawn onto a canvas as a PNG (copied to the
 * clipboard, or downloaded where the clipboard refuses an image), and its
 * series as a CSV through the quality report's CSV renderer, so a chart pastes
 * into a slide without a full report.
 */
import { renderRowsCsv } from '#shared/reports/render-csv';

/** A chart's series as a table: the header row, then one row per bucket or group. */
export interface ChartExportData {
  /** File name without its extension. */
  name: string;
  header: string[];
  rows: Array<Array<string | number | null>>;
}

/** The presentation properties an SVG needs inline once it leaves the page's style sheets. */
const INLINE_PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'visibility',
] as const;

/** A standalone copy of an SVG: every computed presentation property written inline. */
function standaloneSvg(svg: SVGSVGElement): { markup: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const sources = [svg, ...svg.querySelectorAll('*')];
  const targets = [clone, ...clone.querySelectorAll('*')];
  sources.forEach((source, i) => {
    const target = targets[i] as SVGElement | undefined;
    if (!target) return;
    const computed = getComputedStyle(source);
    const style = INLINE_PROPERTIES.map((prop) => `${prop}:${computed.getPropertyValue(prop)}`).join(';');
    target.setAttribute('style', style);
    target.removeAttribute('class');
  });
  const box = svg.getBoundingClientRect();
  const width = Math.ceil(box.width);
  const height = Math.ceil(box.height);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  return { markup: new XMLSerializer().serializeToString(clone), width, height };
}

const SCALE = 2;
const PADDING = 16;
const TITLE_HEIGHT = 28;

/** The chart as a PNG: its title above its SVG, on the card's background, at twice the screen size. */
export async function chartPng(container: HTMLElement, title: string): Promise<Blob> {
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('This chart has nothing to export yet.');
  const { markup, width, height } = standaloneSvg(svg);
  const image = new Image();
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The chart could not be drawn as an image.'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = (width + PADDING * 2) * SCALE;
    canvas.height = (height + TITLE_HEIGHT + PADDING * 2) * SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot draw the chart as an image.');
    ctx.scale(SCALE, SCALE);
    const page = getComputedStyle(container);
    const background =
      page.backgroundColor && page.backgroundColor !== 'rgba(0, 0, 0, 0)' ? page.backgroundColor : '#fff';
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width + PADDING * 2, height + TITLE_HEIGHT + PADDING * 2);
    ctx.fillStyle = page.color || '#111';
    ctx.font = `600 14px ${page.fontFamily || 'sans-serif'}`;
    ctx.textBaseline = 'top';
    ctx.fillText(title, PADDING, PADDING);
    ctx.drawImage(image, PADDING, PADDING + TITLE_HEIGHT, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))),
        'image/png',
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Offer a blob as a file download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Copy a PNG to the clipboard; `false` when the browser refuses an image
 * there (no `ClipboardItem`, an insecure origin), so the caller downloads it.
 */
export async function copyPng(blob: Blob): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/** The CSV bytes of a chart's series, with a byte-order mark so spreadsheets read UTF-8. */
export function chartCsv(data: ChartExportData): Blob {
  return new Blob([`﻿${renderRowsCsv([data.header, ...data.rows])}`], { type: 'text/csv;charset=utf-8' });
}

/** A file name from a chart title: `piwi-chart-wasted-ci-time`. */
export function chartFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `piwi-chart-${slug || 'chart'}`;
}
