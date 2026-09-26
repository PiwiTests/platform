/**
 * Renders tables as an Excel workbook (.xlsx), one sheet per table: numbers
 * as numeric cells in their unit's number format, days as date cells, the
 * header row bold and frozen, columns sized to their content. Text is always
 * written as a string cell, never a formula, so a test title such as `=1+1`
 * reads as typed. Used by the quality report download, the per-section button
 * of the report view and the chart export, in the browser, the demo's service
 * worker and the server alike (`write-excel-file/universal` returns a Blob in
 * all three). The library is imported statically: the demo's service
 * worker is a classic script, where the preload wrapper of a dynamic import
 * (`import.meta.url`) is a syntax error. Page code loads this module lazily.
 */
import writeXlsxFile from 'write-excel-file/universal';
import type { MetricUnit } from '#shared/analytics/metrics';
import { sentencesFor } from './sentences';
import type { ReportLanguage } from './languages';
import type { ReportBlock, ReportBundle, ReportCellValue, ReportWidget } from './types';

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A cell: text, a number with an Excel number format, or a day (`YYYY-MM-DD`) or an instant (ISO, shown in UTC). */
export type XlsxCell = string | number | null | { number: number; format: string } | { date: string };

/** One sheet: a header row, then the data rows. */
export interface XlsxTable {
  /** The sheet name; made valid and unique when the workbook is written. */
  name: string;
  header: string[];
  rows: XlsxCell[][];
}

/** Characters XML 1.0 refuses (an ANSI escape in an error excerpt); Excel reports such a file as corrupt. */
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
/** Excel's limit on the text of one cell. */
const MAX_CELL_TEXT = 32_767;
const MIN_WIDTH = 8;
const MAX_WIDTH = 60;

function cleanText(text: string): string {
  const clean = text.replace(XML_INVALID, '');
  return clean.length > MAX_CELL_TEXT ? clean.slice(0, MAX_CELL_TEXT) : clean;
}

/** Sheet names: at most 31 characters, none of `[]:*?/\`, unique ignoring case. */
function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base =
      cleanText(raw)
        .replace(/[[\]:*?/\\]/g, ' ')
        .replace(/^'+|'+$/g, '')
        .replace(/\s+/g, ' ')
        .trim() || 'Sheet';
    let name = base.slice(0, 31);
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

const DAY_FORMAT = 'yyyy-mm-dd';
const INSTANT_FORMAT = 'yyyy-mm-dd hh:mm:ss';

/**
 * A day as midnight UTC, an instant as itself: Excel stores no time zone and
 * shows the UTC wall clock, so a day reads the same wherever it is opened.
 */
function cellDate(value: string): Date | null {
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The width a cell takes, in characters. */
function cellWidth(cell: XlsxCell): number {
  if (cell === null) return 0;
  if (typeof cell === 'string') return Math.max(...cell.split('\n').map((line) => line.length));
  if (typeof cell === 'number') return String(cell).length;
  if ('date' in cell) return cell.date.length === 10 ? DAY_FORMAT.length : INSTANT_FORMAT.length;
  // The formatted number plus the unit its format writes.
  return String(Math.round(cell.number * 100) / 100).length + (cell.format.match(/"([^"]*)"/)?.[1]?.length ?? 1) + 2;
}

function sheetCell(cell: XlsxCell) {
  if (cell === null) return null;
  if (typeof cell === 'string') return { value: cleanText(cell), type: String };
  if (typeof cell === 'number') return Number.isFinite(cell) ? { value: cell, type: Number } : null;
  if ('date' in cell) {
    const date = cellDate(cell.date);
    if (!date) return { value: cleanText(cell.date), type: String };
    return { value: date, type: Date, format: cell.date.length === 10 ? DAY_FORMAT : INSTANT_FORMAT };
  }
  return Number.isFinite(cell.number) ? { value: cell.number, type: Number, format: cell.format } : null;
}

/** The workbook's bytes. */
export async function renderXlsx(tables: XlsxTable[]): Promise<Uint8Array> {
  const names = sheetNames(tables.map((t) => t.name));
  const sheets = (tables.length > 0 ? tables : [{ name: 'Sheet', header: [], rows: [] }]).map((table, i) => {
    const widths = table.header.map((label, c) =>
      Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, label.length + 2, ...table.rows.map((r) => cellWidth(r[c] ?? null) + 2))),
    );
    return {
      sheet: names[i] ?? 'Sheet',
      stickyRowsCount: 1,
      columns: widths.map((width) => ({ width })),
      data: [
        table.header.map((label) => ({ value: cleanText(label), type: String, fontWeight: 'bold' as const })),
        ...table.rows.map((r) => table.header.map((_, c) => sheetCell(r[c] ?? null))),
      ],
    };
  });
  const blob = await writeXlsxFile(sheets as Parameters<typeof writeXlsxFile>[0]).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

const UNIT_WORDS: Record<ReportLanguage, { min: string; days: string; pts: string }> = {
  en: { min: 'min', days: 'days', pts: 'pts' },
  fr: { min: 'min', days: 'jours', pts: 'pts' },
};

function decimals(precision: number): string {
  return precision > 0 ? `.${'0'.repeat(Math.min(precision, 6))}` : '';
}

/** The currency symbol and its side, from the locale's own currency format. */
function currencyFormat(currency: string, locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(1);
    const symbol = parts.find((p) => p.type === 'currency')?.value ?? currency;
    const before = parts.findIndex((p) => p.type === 'currency') < parts.findIndex((p) => p.type === 'integer');
    return before ? `"${symbol}"#,##0.00` : `#,##0.00 "${symbol}"`;
  } catch {
    return `#,##0.00 "${currency}"`;
  }
}

/**
 * A report value as a cell: percentages as fractions in a `%` format, the
 * other units as their own number with the unit written by the format, so a
 * column sums and sorts in the spreadsheet and still reads `12.5 min`.
 */
export function reportValueCell(
  value: Extract<ReportCellValue, { number: number }>,
  language: ReportLanguage,
  locale: string,
): XlsxCell {
  const words = UNIT_WORDS[language];
  const p = decimals(value.precision);
  switch (value.unit) {
    case 'percent':
      return { number: value.number / 100, format: `0${p}%` };
    case 'change':
      return { number: value.number / 100, format: `+0${p}%;-0${p}%;0${p}%` };
    case 'points':
      return { number: value.number, format: `+0${p} "${words.pts}";-0${p} "${words.pts}";0${p} "${words.pts}"` };
    case 'minutes':
      return { number: value.number, format: `#,##0.0 "${words.min}"` };
    case 'ms':
      return { number: value.number, format: '#,##0 "ms"' };
    case 'days':
      return { number: value.number, format: `#,##0${p} "${words.days}"` };
    case 'money':
      return { number: value.number, format: value.currency ? currencyFormat(value.currency, locale) : '#,##0.00' };
    default:
      return { number: value.number, format: `#,##0${p}` };
  }
}

const SERIES_UNITS: readonly MetricUnit[] = ['percent', 'count', 'minutes', 'ms', 'days', 'money'];

/** A report series value, at the precision each unit reads at. */
function seriesCell(value: number | null, unit: string, language: ReportLanguage, locale: string): XlsxCell {
  if (value === null) return null;
  const known = SERIES_UNITS.find((u) => u === unit) ?? 'count';
  const precision = known === 'ms' ? 0 : known === 'count' && Number.isInteger(value) ? 0 : 1;
  return reportValueCell({ number: value, unit: known, precision }, language, locale);
}

function blockTable(block: ReportBlock, name: string, language: ReportLanguage, locale: string): XlsxTable | null {
  if (block.kind === 'table') {
    if (block.rows.length === 0) return null;
    return {
      name,
      header: block.columns.map((c) => c.label),
      rows: block.rows.map((r) =>
        block.columns.map((c): XlsxCell => {
          const value = r.values?.[c.key];
          if (value && 'date' in value) return { date: value.date };
          if (value) return reportValueCell(value, language, locale);
          const text = r.cells[c.key] ?? '';
          // A number that could not be written as one reads as a blank, not as a dash.
          return text === '—' ? null : text;
        }),
      ),
    };
  }
  if (block.kind === 'series') {
    const dates = block.series[0]?.points.map((p) => p.date) ?? [];
    return {
      name,
      header: [sentencesFor(language).labels.date, ...block.series.map((s) => s.label)],
      rows: dates.map((date, i) => [
        { date },
        ...block.series.map((s) => seriesCell(s.points[i]?.value ?? null, block.unit, language, locale)),
      ]),
    };
  }
  return null;
}

/** A widget's tables and series, one sheet each, named after the widget. */
export function widgetXlsxTables(widget: ReportWidget, language: ReportLanguage, locale: string): XlsxTable[] {
  return widget.blocks.flatMap((block) => blockTable(block, widget.title, language, locale) ?? []);
}

/** One widget as a workbook; null when it holds no table or series. */
export async function renderWidgetXlsx(
  widget: ReportWidget,
  bundle: Pick<ReportBundle, 'language' | 'locale'>,
): Promise<Uint8Array | null> {
  const tables = widgetXlsxTables(widget, bundle.language, bundle.locale);
  return tables.length > 0 ? renderXlsx(tables) : null;
}

/** Every table and series of the report, a sheet each, in document order. */
export function renderReportXlsx(bundle: ReportBundle): Promise<Uint8Array> {
  return renderXlsx(
    bundle.bands.flatMap((band) =>
      band.widgets.flatMap((widget) => widgetXlsxTables(widget, bundle.language, bundle.locale)),
    ),
  );
}

/**
 * Rows of mixed values (a chart's series) as a table: a `YYYY-MM-DD` day or
 * an ISO instant becomes a date cell, a number stays a number.
 */
export function plainXlsxTable(name: string, header: string[], rows: Array<Array<string | number | null>>): XlsxTable {
  const DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/;
  return {
    name,
    header,
    rows: rows.map((r) =>
      r.map((cell): XlsxCell => (typeof cell === 'string' && DATE.test(cell) ? { date: cell } : cell)),
    ),
  };
}
