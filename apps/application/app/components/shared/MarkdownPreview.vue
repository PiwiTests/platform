<script setup lang="ts">
import { highlightCode } from '#shared/highlight';

const props = defineProps<{
  text: string | null;
  loading?: boolean;
  maxHeight?: string;
}>();

type PreviewLine =
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'note'; html: string }
  | { kind: 'bullet'; html: string }
  | { kind: 'text'; html: string }
  | { kind: 'rule' }
  | { kind: 'blank' }
  | { kind: 'table'; headers: string[]; rows: string[][]; hasHeader: boolean }
  | { kind: 'code-start'; lang: string }
  | { kind: 'code-block'; html: string }
  | { kind: 'code-end' };

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Render inline `code`, **bold** and [links] to safe HTML. Escapes first. */
function inlineHtml(raw: string): string {
  let h = escapeHtml(raw);
  h = h.replace(/`([^`]+)`/g, '<code class="rounded bg-gray-200 dark:bg-gray-700 px-1 py-px">$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-gray-900 dark:text-gray-100">$1</strong>');
  h = h.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener" class="text-primary hover:underline">$1</a>',
  );
  return h;
}

/** Split a Markdown table row into trimmed, unescaped cells. */
function tableCells(line: string): string[] {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.replace(/\\\|/g, '|').trim());
}

const SEPARATOR_RE = /^\|?[\s:|-]*-[\s:|-]*\|?$/;

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|');
}

function parse(text: string): PreviewLine[] {
  const result: PreviewLine[] = [];
  const src = text.split('\n');
  let i = 0;
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];

  while (i < src.length) {
    const line = src[i]!;
    if (inCode) {
      if (line === '```') {
        if (codeLines.length) {
          const { html } = highlightCode(codeLines.join('\n'), codeLang);
          result.push({ kind: 'code-start', lang: codeLang || 'code' });
          result.push({ kind: 'code-block', html });
          result.push({ kind: 'code-end' });
        }
        inCode = false;
      } else {
        codeLines.push(line);
      }
      i++;
      continue;
    }

    if (line.startsWith('```')) {
      inCode = true;
      codeLang = line.slice(3).trim();
      codeLines = [];
      i++;
      continue;
    }

    // A GFM table: a `|`-row followed by a `| --- |` separator.
    if (isTableRow(line) && i + 1 < src.length && SEPARATOR_RE.test(src[i + 1]!.trim()) && src[i + 1]!.includes('-')) {
      const headers = tableCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < src.length && isTableRow(src[i]!)) {
        rows.push(tableCells(src[i]!));
        i++;
      }
      const hasHeader = headers.some((h) => h !== '');
      result.push({ kind: 'table', headers, rows, hasHeader });
      continue;
    }

    if (line.startsWith('## ')) result.push({ kind: 'h2', text: line.slice(3) });
    else if (line.startsWith('### ')) result.push({ kind: 'h3', text: line.slice(4) });
    else if (line.startsWith('> ')) result.push({ kind: 'note', html: inlineHtml(line.slice(2)) });
    else if (line.startsWith('- ')) result.push({ kind: 'bullet', html: inlineHtml(line.slice(2)) });
    else if (line.trim() === '---') result.push({ kind: 'rule' });
    else if (line.trim() === '') result.push({ kind: 'blank' });
    else result.push({ kind: 'text', html: inlineHtml(line) });
    i++;
  }

  if (inCode && codeLines.length) {
    const { html } = highlightCode(codeLines.join('\n'), codeLang);
    result.push({ kind: 'code-start', lang: codeLang || 'code' });
    result.push({ kind: 'code-block', html });
    result.push({ kind: 'code-end' });
  }

  return result;
}

const lines = computed<PreviewLine[]>(() => (props.text ? parse(props.text) : []));
</script>

<template>
  <div class="rounded-lg border border-default overflow-hidden bg-muted min-h-16">
    <div v-if="loading" class="flex items-center gap-2 p-4 text-sm text-gray-500">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
      <span>Fetching context… (includes SCM diff lookup)</span>
    </div>
    <div
      v-else-if="lines.length"
      class="overflow-auto p-3 max-sm:p-2 text-xs font-mono leading-relaxed"
      :style="{ maxHeight: maxHeight ?? '45vh' }"
    >
      <template v-for="(line, i) in lines" :key="i">
        <div v-if="line.kind === 'h2'" class="text-sm font-bold text-gray-900 dark:text-white mt-4 mb-0.5 first:mt-0">
          {{ line.text }}
        </div>
        <div v-else-if="line.kind === 'h3'" class="font-semibold text-gray-700 dark:text-gray-200 mt-2 mb-0.5">
          {{ line.text }}
        </div>
        <div
          v-else-if="line.kind === 'note'"
          class="my-1 px-2 py-0.5 rounded bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300 italic"
          v-html="line.html"
        />
        <div v-else-if="line.kind === 'bullet'" class="text-gray-600 dark:text-gray-400 flex gap-1.5">
          <span class="text-gray-400 shrink-0">·</span>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <span v-html="line.html" />
        </div>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-else-if="line.kind === 'text'" class="text-gray-600 dark:text-gray-400" v-html="line.html" />
        <div v-else-if="line.kind === 'rule'" class="my-2 border-t border-default" />
        <div v-else-if="line.kind === 'table'" class="my-1.5 overflow-x-auto">
          <table class="w-full border-collapse text-left">
            <thead v-if="line.hasHeader">
              <tr>
                <th
                  v-for="(h, hi) in line.headers"
                  :key="hi"
                  class="border border-default px-2 py-1 font-semibold text-gray-700 dark:text-gray-200"
                  v-html="inlineHtml(h)"
                />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in line.rows" :key="ri">
                <td
                  v-for="(cell, ci) in row"
                  :key="ci"
                  class="border border-default px-2 py-1 align-top text-gray-600 dark:text-gray-400"
                  :class="{ 'bg-gray-100/60 dark:bg-gray-800/40 font-medium': !line.hasHeader && ci === 0 }"
                  v-html="inlineHtml(cell)"
                />
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else-if="line.kind === 'blank'" class="h-2" />
        <div
          v-else-if="line.kind === 'code-start'"
          class="mt-2 px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-t text-[10px] uppercase tracking-wide"
        >
          {{ line.lang || 'code' }}
        </div>
        <div v-else-if="line.kind === 'code-block'" class="overflow-x-auto bg-gray-50 dark:bg-gray-900/40">
          <!-- eslint-disable-next-line vue/no-v-html -->
          <pre class="hljs px-2 py-1 !bg-transparent whitespace-pre-wrap" v-html="line.html" />
        </div>
        <div v-else-if="line.kind === 'code-end'" class="h-1 bg-gray-100 dark:bg-gray-800/50 rounded-b mb-2" />
      </template>
    </div>
    <div v-else class="p-3 text-xs text-gray-400 italic">No context loaded</div>
  </div>
</template>
