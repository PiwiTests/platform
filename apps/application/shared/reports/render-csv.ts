/**
 * Renders the tables and series of a report bundle as one CSV, each row led
 * by the widget it comes from, so it opens straight in a spreadsheet. A cell starting with `=`, `+`,
 * `-`, `@`, a tab or a carriage return is prefixed with `'`, so a spreadsheet
 * never executes a test title as a formula.
 */
import type { ReportBlock, ReportBundle, ReportWidget } from './types';

const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: formula-guarded, quoted when it holds a separator, a quote or a line break. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value !== 'number' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(cells: Array<string | number | null | undefined>): string {
  return cells.map(csvCell).join(',');
}

/** Rows (a header first) as one CSV, formula-guarded like the report's. */
export function renderRowsCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return `${rows.map(csvLine).join('\r\n')}\r\n`;
}

function blockRows(block: ReportBlock): Array<Array<string | number | null>> | null {
  if (block.kind === 'table') {
    return [
      block.columns.map((c) => c.label),
      ...block.rows.map((r) => block.columns.map((c) => r.cells[c.key] ?? '')),
    ];
  }
  if (block.kind === 'series') {
    const dates = block.series[0]?.points.map((p) => p.date) ?? [];
    return [
      ['date', ...block.series.map((s) => s.label)],
      ...dates.map((date, i) => [date, ...block.series.map((s) => s.points[i]?.value ?? null)]),
    ];
  }
  return null;
}

/** One widget's tables and series as a CSV, a blank line between blocks; null when it holds none. */
export function renderWidgetCsv(widget: ReportWidget): string | null {
  const lines: string[] = [];
  for (const block of widget.blocks) {
    const rows = blockRows(block);
    if (!rows) continue;
    if (lines.length > 0) lines.push('');
    for (const row of rows) lines.push(csvLine(row));
  }
  return lines.length > 0 ? `${lines.join('\r\n')}\r\n` : null;
}

/** Every table and series in one CSV, each row led by its section. */
export function renderReportCsv(bundle: ReportBundle): string {
  const lines: string[] = [];
  for (const band of bundle.bands) {
    for (const widget of band.widgets) {
      for (const block of widget.blocks) {
        const rows = blockRows(block);
        if (!rows) continue;
        for (const row of rows) lines.push(csvLine([widget.title, ...row]));
        lines.push('');
      }
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}
