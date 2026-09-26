import { describe, expect, test } from 'vitest';
import { csvCell, renderReportCsv, renderRowsCsv, renderWidgetCsv } from '../../shared/reports/render-csv';
import { reportSectionFileName } from '../../shared/reports/build';
import { fixtureBundle } from './report-fixture';

describe('quality report CSV', () => {
  test('a cell that could be a formula is prefixed with a quote', () => {
    for (const start of ['=', '+', '-', '@', '\t', '\r']) expect(csvCell(`${start}1+1`)).toMatch(/^"?'/);
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@smoke logs in')).toBe("'@smoke logs in");
  });

  test('numbers are never guarded, so a negative value stays a number', () => {
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(89.5)).toBe('89.5');
  });

  test('separators, quotes and line breaks are quoted', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  test('every table and series lands in one CSV, each row led by its widget', () => {
    const csv = renderReportCsv(fixtureBundle());
    const lines = csv.split('\r\n');
    expect(lines).toContain('Pass rate over time,date,Test pass rate');
    expect(lines).toContain('Pass rate over time,2026-09-24,');
    expect(lines).toContain('Flakiest tests,Tests,Wasted CI minutes');
    expect(csv).toContain("Flakiest tests,'@smoke logs in,1 min");
    expect(csv).toContain("Flakiest tests,'=1+1 | <script>");
  });

  test('each section of a report has its own CSV, without the leading widget column', () => {
    const bundle = fixtureBundle();
    const flaky = bundle.bands.flatMap((b) => b.widgets).find((w) => w.title === 'Flakiest tests')!;
    const csv = renderWidgetCsv(flaky)!;
    expect(csv.split('\r\n')[0]).toBe('Tests,Wasted CI minutes');
    expect(csv).toContain("'=1+1 | <script>");
    const verdict = bundle.bands.flatMap((b) => b.widgets).find((w) => w.blocks.every((b) => b.kind === 'text'));
    if (verdict) expect(renderWidgetCsv(verdict)).toBeNull();
    expect(reportSectionFileName(bundle, flaky.key)).toMatch(/^piwi-quality-report-.+-\d{4}-\d{2}-\d{2}-.+\.csv$/);
  });

  test('a chart export is rows through the same formula guard', () => {
    expect(
      renderRowsCsv([
        ['date', 'title'],
        ['2026-09-24', '=HYPERLINK()'],
        ['2026-09-25', -2],
      ]),
    ).toBe("date,title\r\n2026-09-24,'=HYPERLINK()\r\n2026-09-25,-2\r\n");
  });
});
