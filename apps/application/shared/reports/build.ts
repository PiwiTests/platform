/**
 * Turns a report bundle into the bytes of a download: the format switch, the
 * file name and the content type, shared by the server route and the demo.
 */
import { renderReportCsv } from './render-csv';
import { renderReportHtml } from './render-html';
import { renderReportMarkdown } from './render-markdown';
import { renderReportPdf } from './render-pdf';
import { renderReportXlsx, XLSX_CONTENT_TYPE } from './render-xlsx';
import type { ReportBundle, ReportFormat } from './types';

export interface BuiltReport {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

const CONTENT_TYPES: Record<ReportFormat, string> = {
  json: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8',
  pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xlsx: XLSX_CONTENT_TYPE,
};

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'report'
  );
}

/** `piwi-quality-report-executive-2026-09-25-wasted.xlsx`: one section of a quality report as a workbook. */
export function reportSectionFileName(bundle: ReportBundle, widgetKey: string): string {
  return `piwi-quality-report-${slug(bundle.dashboard.ref)}-${bundle.generatedAt.slice(0, 10)}-${slug(widgetKey)}.xlsx`;
}

/** `piwi-quality-report-executive-2026-09-25.pdf` */
export function reportFileName(bundle: ReportBundle, format: ReportFormat): string {
  return `piwi-quality-report-${slug(bundle.dashboard.ref)}-${bundle.generatedAt.slice(0, 10)}.${format}`;
}

export async function buildReport(bundle: ReportBundle, format: ReportFormat): Promise<BuiltReport> {
  const encoder = new TextEncoder();
  let bytes: Uint8Array;
  switch (format) {
    case 'html':
      bytes = encoder.encode(renderReportHtml(bundle));
      break;
    case 'pdf':
      bytes = await renderReportPdf(bundle);
      break;
    case 'md':
      bytes = encoder.encode(renderReportMarkdown(bundle));
      break;
    case 'csv':
      // A byte-order mark so spreadsheets read the file as UTF-8.
      bytes = encoder.encode(`﻿${renderReportCsv(bundle)}`);
      break;
    case 'xlsx':
      bytes = await renderReportXlsx(bundle);
      break;
    default:
      bytes = encoder.encode(JSON.stringify(bundle, null, 2));
  }
  return { fileName: reportFileName(bundle, format), contentType: CONTENT_TYPES[format], bytes };
}
