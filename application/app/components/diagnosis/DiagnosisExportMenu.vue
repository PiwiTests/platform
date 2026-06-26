<script setup lang="ts">
import type { FailureDiagnosis } from '~~/server/database/schema';
import type { DiagnoseImage } from '~/composables/useClusterDiagnosis';

const props = defineProps<{
  contextText: string | null;
  diagnosis: FailureDiagnosis | null;
  screenshots?: DiagnoseImage[];
  clusterSignature?: string;
  clusterUrl?: string;
  clusterOccurrences?: number;
  clusterErrorType?: string | null;
  sampleError?: string | null;
}>();

const { copy, copied } = useCopy();
const { copyRich } = useCopyRich();

const exportOpen = ref(false);

function clusterMeta(): string {
  const parts: string[] = [];
  if (props.clusterErrorType) parts.push(props.clusterErrorType);
  if (props.clusterOccurrences)
    parts.push(`${props.clusterOccurrences} occurrence${props.clusterOccurrences === 1 ? '' : 's'}`);
  return parts.join(' \u00B7 ');
}

function copyInvestigationSummary() {
  const sig = props.clusterSignature ?? 'Failure cluster';
  const meta = clusterMeta();
  const aiSummary =
    props.diagnosis?.status === 'completed' && props.diagnosis.summary
      ? `AI diagnosis (${props.diagnosis.category ?? 'unknown'}, ${props.diagnosis.confidence ?? '?'}): ${props.diagnosis.summary}`
      : null;

  const plain = [
    `\uD83D\uDD0D Investigation: ${sig}`,
    meta || null,
    '',
    ...(props.sampleError ? ['Error:', stripAnsi(props.sampleError), ''] : []),
    ...(aiSummary ? [aiSummary, ''] : []),
    props.clusterUrl ? `Cluster: ${props.clusterUrl}` : null,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = [
    `<p><strong>\uD83D\uDD0D Investigation: <code>${esc(sig)}</code></strong></p>`,
    meta ? `<p><em>${esc(meta)}</em></p>` : '',
    props.sampleError ? `<p><strong>Error:</strong></p><pre>${esc(props.sampleError)}</pre>` : '',
    aiSummary
      ? `<p><strong>AI diagnosis</strong> (${esc(props.diagnosis?.category ?? '')}, ${esc(props.diagnosis?.confidence ?? '')}):<br>${esc(props.diagnosis!.summary!)}</p>`
      : '',
    props.clusterUrl ? `<p>\uD83D\uDD17 <a href="${props.clusterUrl}">View cluster</a></p>` : '',
  ].join('');

  copyRich(plain, html, { toast: 'Investigation summary copied' });
  exportOpen.value = false;
}

function copyContextMarkdown() {
  if (!props.contextText) return;
  const screenshotsMd =
    props.screenshots?.length
      ? `## Screenshots\n\n${props.screenshots.map((img) => `![${img.name}](data:${img.mediaType};base64,${img.data})`).join('\n\n')}\n\n`
      : '';
  const text = screenshotsMd + '```\n' + props.contextText + '\n```';
  copy(text, { toast: 'AI context (Markdown) copied' });
  exportOpen.value = false;
}

function copyContextJson() {
  if (!props.contextText) return;
  const json = JSON.stringify({ text: props.contextText, exportedAt: new Date().toISOString() }, null, 2);
  copy(json, { toast: 'AI context (JSON) copied' });
  exportOpen.value = false;
}

function markdownToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const out: string[] = [];
  let inCode = false;
  let codeLang = '';
  const codeLines: string[] = [];
  let inList = false;

  function flushCode() {
    if (codeLines.length) {
      const langTag = codeLang ? ` class="language-${esc(codeLang)}"` : '';
      out.push(`<pre><code${langTag}>${esc(codeLines.join('\n'))}</code></pre>`);
      codeLines.length = 0;
    }
    codeLang = '';
  }

  function closeList() {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  }

  for (const line of md.split('\n')) {
    if (line.startsWith('```')) {
      closeList();
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushCode();
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith('- ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${esc(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    if (line.startsWith('## ')) {
      out.push(`<h2>${esc(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith('### ')) {
      out.push(`<h3>${esc(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith('> ')) {
      out.push(`<blockquote>${esc(line.slice(2))}</blockquote>`);
      continue;
    }
    if (line.trim() === '') {
      out.push('<br>');
      continue;
    }
    out.push(`<p>${esc(line)}</p>`);
  }
  closeList();
  if (inCode) flushCode();
  return out.join('\n');
}

function buildScreenshotsHtml(): string {
  if (!props.screenshots?.length) return '';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const figures = props.screenshots
    .map(
      (img) =>
        `<figure style="display:inline-block;margin:4px 4px 8px;text-align:center">` +
        `<img src="data:${esc(img.mediaType)};base64,${img.data}" alt="${esc(img.name)}" ` +
        `style="max-width:320px;max-height:220px;border-radius:6px;border:1px solid #e4e4e7;display:block" />` +
        `<figcaption style="font-size:0.7em;color:#71717a;margin-top:3px">${esc(img.name)}</figcaption>` +
        `</figure>`,
    )
    .join('');
  return `<section><h2>Screenshots</h2><div style="display:flex;flex-wrap:wrap;gap:4px">${figures}</div></section>`;
}

function copyContextHtml() {
  if (!props.contextText) return;
  const plain = props.contextText;
  const body = markdownToHtml(plain);
  const screenshotsSection = buildScreenshotsHtml();
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AI Diagnosis Context</title><style>body{font-family:system-ui,sans-serif;max-width:900px;margin:2em auto;padding:0 1em;line-height:1.6}h2{color:#1a1a2e;margin-top:1.5em}h3{color:#16213e;margin-top:1.2em}pre{background:#f4f4f5;padding:1em;border-radius:6px;overflow-x:auto;font-size:0.9em}code{font-family:ui-monospace,monospace}blockquote{border-left:3px solid #d4d4d8;padding-left:1em;color:#52525b;margin:1em 0}li{margin:0.25em 0}figure{margin:0}section+section{border-top:1px solid #e4e4e7;padding-top:1em}</style></head><body>${screenshotsSection}<section>${body}</section></body></html>`;
  try {
    navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
    const toast = useToast();
    toast.add({ title: 'AI context (HTML) copied', icon: 'i-lucide-check', color: 'success', duration: 2000 });
  } catch {
    copy(html, { toast: 'AI context (HTML) copied' });
  }
  exportOpen.value = false;
}

function copyAsCurl() {
  const text = props.contextText ?? '';
  const systemHint = 'You are a test failure analyst. Analyze the following context and provide a diagnosis.';
  const body = JSON.stringify({
    model: 'claude-opus-4-8',
    max_tokens: 8192,
    system: systemHint,
    messages: [{ role: 'user', content: text }],
  });
  const curl = `curl -X POST https://api.anthropic.com/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $PIWI_AI_API_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '${body}'`;
  copy(curl, { toast: 'cURL command copied' });
  exportOpen.value = false;
}

function copyDiagnosisOnly() {
  if (!props.diagnosis || props.diagnosis.status !== 'completed') return;

  const d = props.diagnosis;
  const det = d.details as Record<string, unknown> | null;
  const lines: string[] = [];
  if (d.category) lines.push(`Category: ${d.category}`);
  if (d.confidence) lines.push(`Confidence: ${d.confidence}`);
  lines.push('');
  if (d.summary) lines.push(d.summary);
  if (d.rootCause) lines.push(`\nRoot cause: ${d.rootCause}`);
  const evidence = (det?.evidence as string[]) ?? [];
  if (evidence.length) {
    lines.push('\nEvidence:');
    evidence.forEach((e) => lines.push(`- ${e}`));
  }
  const fix = det?.suggestedFix as Record<string, unknown> | undefined;
  if (fix?.patch) {
    lines.push(`\nSuggested fix (patch):\n${fix.patch}`);
  } else if (fix?.code) {
    lines.push(`\nSuggested fix (code):\n${fix.code}`);
  }

  const md = lines.join('\n');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = [
    `<dl>${d.category ? `<dt>Category</dt><dd>${esc(d.category)}</dd>` : ''}${d.confidence ? `<dt>Confidence</dt><dd>${esc(d.confidence)}</dd>` : ''}</dl>`,
    d.summary ? `<p><strong>${esc(d.summary)}</strong></p>` : '',
    d.rootCause ? `<p><strong>Root cause:</strong> ${esc(d.rootCause)}</p>` : '',
  ].join('');

  copyRich(md, html, { toast: 'Diagnosis copied' });
  exportOpen.value = false;
}

function copySuggestedPatch() {
  if (!props.diagnosis) return;
  const det = props.diagnosis.details as Record<string, unknown> | null;
  const patch = (det?.suggestedFix as Record<string, unknown> | undefined)?.patch as string | undefined;
  if (patch) {
    copy(patch, { toast: 'Suggested patch copied' });
  }
  exportOpen.value = false;
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}
</script>

<template>
  <UPopover v-model:open="exportOpen">
    <UButton icon="i-lucide-download" size="xs" color="neutral" variant="outline" title="Copy / export">
      Export
    </UButton>

    <template #content>
      <div class="w-56 p-1 space-y-0.5">
        <p class="text-xs font-medium text-gray-500 px-2 pt-1 pb-1">Copy / export</p>

        <UButton
          block
          size="sm"
          color="neutral"
          variant="ghost"
          class="justify-start"
          icon="i-lucide-clipboard-list"
          @click="copyInvestigationSummary"
        >
          Investigation summary
        </UButton>

        <UButton
          v-if="contextText"
          block
          size="sm"
          color="neutral"
          variant="ghost"
          class="justify-start"
          icon="i-lucide-file-text"
          @click="copyContextMarkdown"
        >
          Full context (Markdown)
        </UButton>

        <UButton
          v-if="contextText"
          block
          size="sm"
          color="neutral"
          variant="ghost"
          class="justify-start"
          icon="i-lucide-file-json"
          @click="copyContextJson"
        >
          Full context (JSON)
        </UButton>

        <UButton
          v-if="contextText"
          block
          size="sm"
          color="neutral"
          variant="ghost"
          class="justify-start"
          icon="i-lucide-file-code"
          @click="copyContextHtml"
        >
          Full context (HTML)
        </UButton>

        <UButton
          v-if="contextText"
          block
          size="sm"
          color="neutral"
          variant="ghost"
          class="justify-start"
          icon="i-lucide-terminal"
          @click="copyAsCurl"
        >
          As cURL
        </UButton>

        <USeparator class="my-1" />

        <UButton
          v-if="diagnosis?.status === 'completed'"
          block
          size="sm"
          color="neutral"
          variant="ghost"
          class="justify-start"
          icon="i-lucide-sparkles"
          @click="copyDiagnosisOnly"
        >
          Diagnosis only
        </UButton>

        <UButton
          v-if="diagnosis?.status === 'completed' && (diagnosis.details as any)?.suggestedFix?.patch"
          block
          size="sm"
          color="neutral"
          variant="ghost"
          class="justify-start"
          icon="i-lucide-code"
          @click="copySuggestedPatch"
        >
          Suggested patch
        </UButton>
      </div>
    </template>
  </UPopover>
</template>
