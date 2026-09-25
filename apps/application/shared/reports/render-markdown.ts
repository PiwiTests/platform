/**
 * Renders a report bundle as Markdown that pastes into Confluence, Jira, a pull
 * request or Slack: tables for tables, a text sparkline under each series.
 * Run-derived text is escaped (pipes, backticks, a leading `#`, link and
 * emphasis characters) so a test title can never change the document's shape.
 */
import { sparkline } from './chart';
import { sentencesFor } from './sentences';
import { hasVerdictWidget, type ReportBlock, type ReportBundle } from './types';

/** Escape a run-derived string for a Markdown line or table cell. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\r?\n/g, ' ')
    .replace(/([\\`*_[\]|<>])/g, '\\$1')
    .replace(/^(\s*)([#>+-]|\d+\.)(\s)/, '$1\\$2$3');
}

function linked(text: string, href: string | null | undefined): string {
  return href ? `[${escapeMarkdown(text)}](${href.replace(/[()\s]/g, encodeURIComponent)})` : escapeMarkdown(text);
}

function renderBlock(block: ReportBlock): string[] {
  switch (block.kind) {
    case 'text':
      return [escapeMarkdown(block.text), ''];
    case 'stats':
      return [
        `| ${block.tiles.map((t) => escapeMarkdown(t.label)).join(' | ')} |`,
        `|${block.tiles.map(() => ' ---: ').join('|')}|`,
        `| ${block.tiles
          .map((t) =>
            [t.value, t.change ? `(${t.change})` : '', t.note ?? ''].filter(Boolean).map(escapeMarkdown).join(' '),
          )
          .join(' | ')} |`,
        '',
      ];
    case 'series': {
      const lines: string[] = [];
      if (block.summary) lines.push(escapeMarkdown(block.summary), '');
      for (const s of block.series) {
        const values = s.formatted.filter((v, i) => s.points[i]!.value !== null);
        const range = values.length ? ` ${values[0]} → ${values[values.length - 1]}` : '';
        lines.push(`${escapeMarkdown(s.label)}: \`${sparkline(s.points) || '·'}\`${escapeMarkdown(range)}`, '');
      }
      if (block.markers.length)
        lines.push(`Markers: ${block.markers.map((m) => `${m.date} ${escapeMarkdown(m.label)}`).join('; ')}`, '');
      return lines;
    }
    case 'table':
      if (block.rows.length === 0) return [];
      return [
        `| ${block.columns.map((c) => escapeMarkdown(c.label)).join(' | ')} |`,
        `|${block.columns.map((c) => (c.align === 'right' ? ' ---: ' : ' --- ')).join('|')}|`,
        ...block.rows.map(
          (row) =>
            `| ${block.columns.map((c, i) => (i === 0 ? linked(row.cells[c.key] ?? '', row.link) : escapeMarkdown(row.cells[c.key] ?? ''))).join(' | ')} |`,
        ),
        '',
      ];
    case 'list':
      return [
        ...block.items.map(
          (item) => `- ${linked(item.text, item.link)}${item.detail ? `: ${escapeMarkdown(item.detail)}` : ''}`,
        ),
        '',
      ];
  }
}

export function renderReportMarkdown(bundle: ReportBundle): string {
  const L = sentencesFor(bundle.language).labels;
  const out: string[] = [
    `# ${L.qualityReport}: ${escapeMarkdown(bundle.title)}`,
    '',
    `${escapeMarkdown(bundle.period.label)}${bundle.comparison ? ` · ${L.comparedWith.toLowerCase()} ${escapeMarkdown(bundle.comparison.label)}` : ''}`,
    '',
  ];
  if (!hasVerdictWidget(bundle)) out.push(`> ${escapeMarkdown(bundle.verdict.sentence)}`, '');
  for (const band of bundle.bands) {
    out.push(`## ${escapeMarkdown(band.title)}`, '');
    if (band.description) out.push(escapeMarkdown(band.description), '');
    for (const widget of band.widgets) {
      out.push(`### ${escapeMarkdown(widget.title)}`, '');
      for (const note of widget.notes) out.push(`_${escapeMarkdown(note)}_`, '');
      for (const block of widget.blocks) out.push(...renderBlock(block));
    }
  }
  out.push('---', '');
  out.push(`- **${L.dashboard}**: ${escapeMarkdown(bundle.dashboard.name)}`);
  out.push(`- **${L.projects}**: ${escapeMarkdown(bundle.scopeText.projects)}`);
  out.push(`- **${L.branchPolicy}**: ${escapeMarkdown(bundle.scopeText.branches)}`);
  out.push(`- ${escapeMarkdown(bundle.scopeText.runs)}`);
  if (bundle.scopeText.tests) out.push(`- **${L.testFilter}**: ${escapeMarkdown(bundle.scopeText.tests)}`);
  out.push('');
  if (bundle.targets.length) {
    out.push(`**${L.targets}**`, '');
    for (const t of bundle.targets) out.push(`- ${escapeMarkdown(t.text)}`);
    out.push('');
  }
  if (bundle.definitions.length) {
    out.push(`**${L.definitions}**`, '');
    for (const d of bundle.definitions) out.push(`- **${escapeMarkdown(d.label)}**: ${escapeMarkdown(d.definition)}`);
    out.push('');
  }
  if (bundle.limits.length) {
    out.push(`**${L.limits}**`, '');
    for (const l of bundle.limits) out.push(`- ${escapeMarkdown(l)}`);
    out.push('');
  }
  out.push(
    `${L.generatedBy} ${bundle.generatedAt}${bundle.piwiVersion ? ` · ${bundle.piwiVersion}` : ''}${bundle.sourceUrl ? ` · [${L.openInPiwi}](${bundle.sourceUrl})` : ''}`,
    '',
  );
  return out.join('\n');
}
