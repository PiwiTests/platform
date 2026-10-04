import { describe, expect, test } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/node';
import {
  plainXlsxTable,
  renderReportXlsx,
  renderWidgetXlsx,
  renderXlsx,
  reportValueCell,
} from '../../shared/reports/render-xlsx';
import { buildReport, reportSectionFileName } from '../../shared/reports/build';
import { reportWidgets } from '../../shared/reports/types';
import { fixtureBundle, HOSTILE } from './report-fixture';

async function read(bytes: Uint8Array) {
  return readXlsxFile(Buffer.from(bytes));
}

function part(bytes: Uint8Array, name: string): string {
  const file = unzipSync(bytes)[name];
  if (!file) throw new Error(`${name} is missing from the workbook`);
  return strFromU8(file);
}

describe('quality report Excel workbook', () => {
  test('a whole report is one workbook, a sheet per table or series, named after its widget', async () => {
    const sheets = await read(await renderReportXlsx(fixtureBundle()));
    expect(sheets.map((s) => s.sheet)).toEqual(['Pass rate over time', 'Flakiest tests']);

    const trend = sheets[0]!.data;
    expect(trend[0]).toEqual(['Date', 'Test pass rate']);
    expect(trend[1]![0]).toEqual(new Date('2026-09-23T00:00:00Z'));
    // A percentage is a fraction in a `%` format, so 100% reads 1.
    expect(trend[1]![1]).toBe(1);
    expect(trend[2]![1]).toBeNull();
    expect(trend[3]![1]).toBeCloseTo(0.8);

    const flaky = sheets[1]!.data;
    expect(flaky[0]).toEqual(['Tests', 'Wasted CI minutes']);
    expect(flaky[1]).toEqual([HOSTILE, 4]);
    // A row without values (a snapshot generated before rows carried them) keeps its text.
    expect(flaky[2]).toEqual(['@smoke logs in', '1 min']);
  });

  test('text is a string cell, never a formula, and the header row is bold and frozen', async () => {
    const bytes = await renderReportXlsx(fixtureBundle());
    const sheet = part(bytes, 'xl/worksheets/sheet2.xml');
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('ySplit="1"');
    expect(sheet).toMatch(/<col [^>]*width="\d+"/);
    expect(part(bytes, 'xl/sharedStrings.xml')).toContain('=1+1 | &lt;script&gt;');
    expect(part(bytes, 'xl/styles.xml')).toContain('<b/>');
  });

  test('units become number formats: minutes, percentages, changes, money', () => {
    expect(reportValueCell({ number: 4, unit: 'minutes', precision: 0 }, 'en', 'en-US')).toEqual({
      number: 4,
      format: '#,##0.0 "min"',
    });
    expect(reportValueCell({ number: 97.8, unit: 'percent', precision: 1 }, 'en', 'en-US')).toEqual({
      number: 0.978,
      format: '0.0%',
    });
    expect(reportValueCell({ number: 3, unit: 'days', precision: 1 }, 'fr', 'fr-FR')).toEqual({
      number: 3,
      format: '#,##0.0 "jours"',
    });
    expect(reportValueCell({ number: -1.2, unit: 'points', precision: 1 }, 'en', 'en-US')).toMatchObject({
      number: -1.2,
    });
    expect(reportValueCell({ number: 12.4, unit: 'money', precision: 2, currency: 'USD' }, 'en', 'en-US')).toEqual({
      number: 12.4,
      format: '"$"#,##0.00',
    });
    expect(reportValueCell({ number: 12.4, unit: 'money', precision: 2, currency: 'EUR' }, 'fr', 'fr-FR')).toEqual({
      number: 12.4,
      format: '#,##0.00 "€"',
    });
  });

  test('one section downloads as its own workbook; a section without a table has none', async () => {
    const bundle = fixtureBundle();
    const widgets = reportWidgets(bundle);
    const flaky = widgets.find((w) => w.key === 'flaky')!;
    const sheets = await read((await renderWidgetXlsx(flaky, bundle))!);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]!.sheet).toBe('Flakiest tests');
    expect(
      await renderWidgetXlsx(
        widgets.find((w) => w.key === 'risks')!,
        bundle,
      ),
    ).toBeNull();
    expect(reportSectionFileName(bundle, flaky.key)).toMatch(/^piwi-quality-report-.+-\d{4}-\d{2}-\d{2}-.+\.xlsx$/);
  });

  test('the report download serves the workbook with its content type', async () => {
    const built = await buildReport(fixtureBundle(), 'xlsx');
    expect(built.fileName).toMatch(/\.xlsx$/);
    expect(built.contentType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // A ZIP archive, as every .xlsx is.
    expect([...built.bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
  });

  test('a chart export turns days and instants into dates and keeps numbers numeric', async () => {
    const bytes = await renderXlsx([
      plainXlsxTable(
        'Wasted CI time',
        ['date', 'title', 'minutes'],
        [
          ['2026-09-24', '=HYPERLINK("x")', 12.5],
          ['2026-09-25T10:30:00.000Z', '-2', -2],
        ],
      ),
    ]);
    const [sheet] = await read(bytes);
    expect(sheet!.data[1]).toEqual([new Date('2026-09-24T00:00:00Z'), '=HYPERLINK("x")', 12.5]);
    expect(sheet!.data[2]).toEqual([new Date('2026-09-25T10:30:00.000Z'), '-2', -2]);
    expect(part(bytes, 'xl/worksheets/sheet1.xml')).not.toContain('<f>');
  });

  test('sheet names are made valid and unique, and control characters are dropped', async () => {
    const bytes = await renderXlsx([
      { name: 'Movers: slower / faster [7d]', header: ['a'], rows: [['x\u001b[31m red']] },
      { name: 'movers: slower / faster [7d]', header: ['a'], rows: [['y']] },
      { name: 'A name far longer than the thirty-one characters Excel allows', header: ['a'], rows: [] },
    ]);
    const sheets = await read(bytes);
    const names = sheets.map((s) => s.sheet);
    expect(names[0]).toBe('Movers slower faster 7d');
    expect(names[1]).toBe('movers slower faster 7d (2)');
    expect(names[2]!.length).toBeLessThanOrEqual(31);
    expect(sheets[0]!.data[1]).toEqual(['x[31m red']);
  });
});
