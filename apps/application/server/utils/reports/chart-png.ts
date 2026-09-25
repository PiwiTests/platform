/**
 * The trend of a quality report email as a PNG: the SVG marks of a `series`
 * block (gridlines, lines, marker rules) rasterized by `sharp`, attached to
 * the email by content id. The SVG carries no text at all, because the
 * production image ships no fonts for the rasterizer; the axis values, the
 * dates and the legend are HTML text beside the image.
 */
import sharp from 'sharp';
import { REPORT_GRID, REPORT_MARKER, seriesGeometry } from '#shared/reports/chart';
import type { ReportBlock } from '#shared/reports/types';

type SeriesBlock = Extract<ReportBlock, { kind: 'series' }>;

/** The plot size in CSS pixels; the PNG is drawn at twice that for sharp screens. */
export const EMAIL_CHART_WIDTH = 496;
export const EMAIL_CHART_HEIGHT = 140;

const GRID = REPORT_GRID;
const MARKER = REPORT_MARKER;

function path(run: Array<[number, number]>): string {
  return run.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

/** The chart's marks as SVG, with no `<text>` element. */
export function chartMarksSvg(block: SeriesBlock, width = EMAIL_CHART_WIDTH, height = EMAIL_CHART_HEIGHT): string {
  const pad = 4;
  const g = seriesGeometry(block, width - pad * 2, height - pad * 2);
  const parts: string[] = [];
  for (const tick of g.ticks) {
    parts.push(
      `<line x1="0" x2="${g.width}" y1="${tick.y.toFixed(1)}" y2="${tick.y.toFixed(1)}" stroke="${GRID}" stroke-width="1"/>`,
    );
  }
  for (const marker of g.markers) {
    parts.push(
      `<line x1="${marker.x.toFixed(1)}" x2="${marker.x.toFixed(1)}" y1="0" y2="${g.height}" stroke="${MARKER}" stroke-width="1" stroke-dasharray="3 3"/>`,
    );
  }
  for (const line of g.lines) {
    for (const run of line.runs) {
      if (run.length === 1) {
        const [x, y] = run[0]!;
        parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${line.color}"/>`);
        continue;
      }
      parts.push(
        `<path d="${path(run)}" fill="none" stroke="${line.color}" stroke-width="${line.faint ? 1.5 : 2.5}"${line.faint ? ' stroke-dasharray="4 3"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/><g transform="translate(${pad},${pad})">${parts.join('')}</g></svg>`;
}

/** Rasterize the chart's marks to a PNG at twice the CSS size. */
export async function chartPng(block: SeriesBlock): Promise<Buffer> {
  const svg = chartMarksSvg(block);
  return sharp(Buffer.from(svg), { density: 144 }).png({ compressionLevel: 9 }).toBuffer();
}
