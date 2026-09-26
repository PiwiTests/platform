import { describe, expect, test } from 'vitest';
import { csvCell, renderReportCsv, renderRowsCsv } from '../../shared/reports/render-csv';
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

  test('rows (the rollup export) go through the same formula guard', () => {
    expect(
      renderRowsCsv([
        ['date', 'title'],
        ['2026-09-24', '=HYPERLINK()'],
        ['2026-09-25', -2],
      ]),
    ).toBe("date,title\r\n2026-09-24,'=HYPERLINK()\r\n2026-09-25,-2\r\n");
  });
});
