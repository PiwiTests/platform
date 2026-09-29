/**
 * Exporting one chart: its SVG drawn onto a canvas as a PNG (copied to the
 * clipboard, or downloaded where the clipboard refuses an image), and its
 * series as an Excel workbook through the quality report's workbook renderer,
 * so a chart pastes into a slide without a full report.
 */

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
const GAP = 12;

async function loadImage(markup: string): Promise<{ image: HTMLImageElement; url: string }> {
  const image = new Image();
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The chart could not be drawn as an image.'));
    image.src = url;
  });
  return { image, url };
}

/**
 * The chart as a PNG: its title above its plots (every chart SVG of the
 * card, stacked), on the card's background, at twice the screen size.
 */
export async function chartPng(container: HTMLElement, title: string): Promise<Blob> {
  const svgs = [...container.querySelectorAll<SVGSVGElement>('svg.block')];
  if (svgs.length === 0) throw new Error('This chart has nothing to export yet.');
  const parts = svgs.map(standaloneSvg);
  const loaded = await Promise.all(parts.map((p) => loadImage(p.markup)));
  try {
    const width = Math.max(...parts.map((p) => p.width));
    const height = parts.reduce((sum, p) => sum + p.height, 0) + (parts.length - 1) * GAP;
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
    let y = PADDING + TITLE_HEIGHT;
    loaded.forEach(({ image }, i) => {
      ctx.drawImage(image, PADDING, y, parts[i]!.width, parts[i]!.height);
      y += parts[i]!.height + GAP;
    });
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))),
        'image/png',
      ),
    );
  } finally {
    for (const { url } of loaded) URL.revokeObjectURL(url);
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

/** A chart's series as a one-sheet workbook, the sheet named after the chart. */
export async function chartXlsx(data: ChartExportData, title: string): Promise<Blob> {
  const { plainXlsxTable, renderXlsx, XLSX_CONTENT_TYPE } = await import('#shared/reports/render-xlsx');
  const bytes = await renderXlsx([plainXlsxTable(title, data.header, data.rows)]);
  return new Blob([bytes as BlobPart], { type: XLSX_CONTENT_TYPE });
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
