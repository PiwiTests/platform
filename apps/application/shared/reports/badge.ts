/**
 * The status badge of a share link ("tests on main · 97.8% · 7 d"): an SVG a
 * README or a wiki page embeds, drawn from a quality report bundle. The value
 * is the bundle's test pass rate tile, colored on the pass-rate scale; a
 * bundle without that tile shows its verdict instead.
 */
import { escapeHtml } from '#shared/markdown-to-html';
import { PASS_RATE_COLORS, passRateTone } from '#shared/status-colors';
import { sentencesFor } from './sentences';
import { reportWidgets, type ReportBundle, type ReportTile } from './types';

export interface ReportBadge {
  label: string;
  value: string;
  /** The value side's fill. */
  color: string;
}

const NEUTRAL = '#71717a';
const LABEL_FILL = '#3f3f46';
const DAY_MS = 24 * 60 * 60 * 1000;

const VERDICT_COLORS = {
  good: PASS_RATE_COLORS.good.fill,
  mixed: PASS_RATE_COLORS.fair.fill,
  bad: PASS_RATE_COLORS.poor.fill,
};

function passRateTile(bundle: ReportBundle): ReportTile | null {
  for (const widget of reportWidgets(bundle)) {
    for (const block of widget.blocks) {
      if (block.kind !== 'stats') continue;
      const tile = block.tiles.find((t) => t.metric === 'test-pass-rate');
      if (tile) return tile;
    }
  }
  return null;
}

/** The number a formatted percentage reads as (`97.8%`, `97,8 %`), or null. */
export function percentOf(value: string): number | null {
  const match = /-?\d+(?:[.,]\d+)?/.exec(value);
  if (!match) return null;
  const n = Number(match[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** The badge's words and color for a bundle. */
export function reportBadge(bundle: ReportBundle): ReportBadge {
  const words = sentencesFor(bundle.language).badge;
  const branch = bundle.scope.branches?.length
    ? bundle.scope.branches.join(', ')
    : bundle.scope.defaultBranchOnly === false
      ? words.allBranches
      : words.defaultBranch;
  const label = words.label(branch);
  const days = Math.max(1, Math.round((Date.parse(bundle.period.to) - Date.parse(bundle.period.from)) / DAY_MS));
  const period = words.days(days);
  const tile = passRateTile(bundle);
  if (tile) {
    const percent = percentOf(tile.value);
    const color = percent === null ? NEUTRAL : PASS_RATE_COLORS[passRateTone(percent)].fill;
    return { label, value: `${tile.value} · ${period}`, color };
  }
  const tone = bundle.verdict.tone;
  return { label, value: `${words.verdict[tone]} · ${period}`, color: VERDICT_COLORS[tone] };
}

/** An approximate text width at 11 px, enough to size the two halves. */
function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += /[ .,·:]/.test(ch) ? 3.5 : /[mwMW%]/.test(ch) ? 9.5 : 6.6;
  return Math.ceil(width);
}

/** The badge as a standalone SVG document. */
export function renderBadgeSvg(badge: ReportBadge): string {
  const pad = 6;
  const left = textWidth(badge.label) + pad * 2;
  const right = textWidth(badge.value) + pad * 2;
  const width = left + right;
  const label = escapeHtml(badge.label);
  const value = escapeHtml(badge.value);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}: ${value}">`,
    `<title>${label}: ${value}</title>`,
    `<clipPath id="r"><rect width="${width}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)"><rect width="${left}" height="20" fill="${LABEL_FILL}"/>`,
    `<rect x="${left}" width="${right}" height="20" fill="${escapeHtml(badge.color)}"/></g>`,
    `<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">`,
    `<text x="${left / 2}" y="14">${label}</text>`,
    `<text x="${left + right / 2}" y="14">${value}</text>`,
    `</g></svg>`,
  ].join('');
}
