<script setup lang="ts">
import type { FailureDiagnosis } from '~~/server/database/schema';
import { formatRelativeTime } from '~/utils';
const props = defineProps<{ clusterId?: number }>();

// When used inside failure-clusters/[id].vue the store is provided by the page.
// When used standalone (card, modal) we bootstrap a self-contained store from the prop.
const { diagnosis, posting, contextText, contextLoading, refreshContext, runDiagnosis } = useOrProvideClusterDiagnosis(
  props.clusterId,
);
const { aiStatus } = useAiStatus();
const toast = useToast();
const { copy } = useCopy();

const attachments = useAttachments();
const {
  files: attachedFiles,
  images: attachedImages,
  dragOver,
  processFiles,
  onDragOver,
  onDragLeave,
  onDrop,
  removeFile,
  removeImage,
} = attachments;

const additionalContext = ref('');
const fileInputRef = ref<HTMLInputElement | null>(null);

// AI context modal — reads the already-fetched shared context (no extra request).
const showAiContext = ref(false);
const aiContextRaw = computed(() => (contextText.value != null ? '```\n' + contextText.value + '\n```' : null));
function toggleAiContext() {
  showAiContext.value = !showAiContext.value;
}

function buildPromptContext() {
  const parts: string[] = [];
  if (additionalContext.value.trim()) parts.push(additionalContext.value.trim());
  const filesMd = attachments.filesMarkdown();
  if (filesMd) parts.push(filesMd);
  return parts.join('\n\n');
}

async function diagnose(force = false) {
  await runDiagnosis({
    force,
    additionalContext: buildPromptContext() || undefined,
    images: attachedImages.value.length ? attachments.imagesPayload() : undefined,
  });
}

function diagnosisMarkdown(): string {
  if (!diagnosis.value || diagnosis.value.status !== 'completed') return '';
  const d = diagnosis.value;
  const det = d.details as Record<string, unknown> | null;
  const lines: string[] = [];
  if (d.category) lines.push(`**Category:** ${d.category}`);
  if (d.confidence) lines.push(`**Confidence:** ${d.confidence}`);
  lines.push('');
  if (d.summary) lines.push(`${d.summary}\n`);
  if (d.rootCause) lines.push(`**Root cause:** ${d.rootCause}\n`);
  const evidence = (det?.evidence as string[]) ?? [];
  if (evidence.length) {
    lines.push('**Evidence:**');
    evidence.forEach((e) => lines.push(`- ${e}`));
    lines.push('');
  }
  const fix = det?.suggestedFix as Record<string, unknown> | undefined;
  if (fix) {
    lines.push('**Suggested fix:**');
    if (fix.description) lines.push(`${fix.description}`);
    if (fix.file) lines.push(`\`${fix.file}\``);
    if (fix.patch) lines.push(`\`\`\`diff\n${fix.patch}\n\`\`\``);
    else if (fix.code) lines.push(`\`\`\`\n${fix.code}\n\`\`\``);
    lines.push('');
  }
  const tips = (det?.preventionTips as string[]) ?? [];
  if (tips.length) {
    lines.push('**Prevention tips:**');
    tips.forEach((t) => lines.push(`- ${t}`));
    lines.push('');
  }
  if (d.model) lines.push(`_${d.model}_`);
  return lines.join('\n');
}

function diagnosisHtml(): string {
  if (!diagnosis.value || diagnosis.value.status !== 'completed') return '';
  const d = diagnosis.value;
  const det = d.details as Record<string, unknown> | null;
  const parts: string[] = ['<dl>'];
  if (d.category) parts.push(`<dt>Category</dt><dd>${escapeHtml(d.category)}</dd>`);
  if (d.confidence) parts.push(`<dt>Confidence</dt><dd>${escapeHtml(d.confidence)}</dd>`);
  parts.push('</dl>');
  if (d.summary) parts.push(`<p><strong>${escapeHtml(d.summary)}</strong></p>`);
  if (d.rootCause) parts.push(`<p><strong>Root cause:</strong> ${escapeHtml(d.rootCause)}</p>`);
  const evidence = (det?.evidence as string[]) ?? [];
  if (evidence.length) {
    parts.push('<p><strong>Evidence:</strong></p><ul>');
    evidence.forEach((e) => parts.push(`<li>${escapeHtml(e)}</li>`));
    parts.push('</ul>');
  }
  const fix = det?.suggestedFix as Record<string, unknown> | undefined;
  if (fix) {
    parts.push('<p><strong>Suggested fix:</strong></p>');
    if (fix.description) parts.push(`<p>${escapeHtml(String(fix.description))}</p>`);
    if (fix.file) parts.push(`<code>${escapeHtml(String(fix.file))}</code>`);
    if (fix.patch) parts.push(`<pre>${escapeHtml(String(fix.patch))}</pre>`);
    else if (fix.code) parts.push(`<pre>${escapeHtml(String(fix.code))}</pre>`);
  }
  const tips = (det?.preventionTips as string[]) ?? [];
  if (tips.length) {
    parts.push('<p><strong>Prevention tips:</strong></p><ul>');
    tips.forEach((t) => parts.push(`<li>${escapeHtml(t)}</li>`));
    parts.push('</ul>');
  }
  return parts.join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function copyDiagnosis() {
  const md = diagnosisMarkdown();
  const html = diagnosisHtml();
  if (!md && !html) return;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([md], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
    toast.add({ title: 'Diagnosis copied', icon: 'i-lucide-check', color: 'success', duration: 2000 });
  } catch {
    // fallback: copy plain text
    copy(md, { toast: 'Diagnosis copied' });
  }
}

const categoryColors: Record<string, 'error' | 'warning' | 'info' | 'secondary' | 'neutral'> = {
  'app-bug': 'error',
  'test-bug': 'warning',
  'flaky-test': 'warning',
  infrastructure: 'info',
  environment: 'secondary',
  unknown: 'neutral',
};

const confidenceColors: Record<string, 'success' | 'warning' | 'neutral'> = {
  high: 'success',
  medium: 'warning',
  low: 'neutral',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const details = computed(() => diagnosis.value?.details as any);

function formatTokens(i: number | null, o: number | null) {
  if (i == null && o == null) return '';
  return `${i ?? 0} in / ${o ?? 0} out tokens`;
}

function isStale(d: FailureDiagnosis) {
  return d.status === 'running' && Date.now() - new Date(d.updatedAt).getTime() > 5 * 60 * 1000;
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header: title + context button — always visible -->
    <div class="pb-2 border-b border-default">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5">
          <UIcon name="i-lucide-sparkles" class="size-4 text-primary shrink-0" />
          <span class="text-sm font-semibold">Diagnosis</span>
          <span class="text-xs text-gray-400">
            &mdash;
            <UIcon name="i-lucide-triangle-alert" class="size-3 shrink-0 inline" />
            AI-generated, verify before applying
          </span>
        </div>
        <div class="flex items-center gap-1.5">
          <UButton
            :icon="showAiContext ? 'i-lucide-eye-off' : 'i-lucide-eye'"
            size="xs"
            color="neutral"
            variant="outline"
            :loading="contextLoading"
            @click="toggleAiContext"
          >
            {{ showAiContext ? 'Hide context' : 'Show context' }}
          </UButton>
          <UButton
            v-if="diagnosis && diagnosis.status === 'completed'"
            icon="i-lucide-refresh-cw"
            size="xs"
            color="primary"
            variant="soft"
            :loading="posting"
            @click="diagnose(true)"
          >
            Re-diagnose
          </UButton>
        </div>
      </div>
    </div>

    <!-- AI context modal — always accessible -->
    <UModal
      :open="showAiContext"
      title="Context sent to AI"
      :ui="{ content: 'max-w-5xl' }"
      @update:open="
        (v) => {
          showAiContext = v;
        }
      "
    >
      <template #header>
        <div class="flex items-center justify-between w-full">
          <span class="font-semibold">Context sent to AI</span>
          <div class="flex items-center gap-1">
            <UButton
              v-if="contextText"
              icon="i-lucide-copy"
              size="xs"
              color="neutral"
              variant="ghost"
              title="Copy context to clipboard"
              @click="copy(contextText, { toast: 'Context copied' })"
            />
            <UButton
              v-if="contextText"
              icon="i-lucide-refresh-cw"
              size="xs"
              color="neutral"
              variant="ghost"
              :loading="contextLoading"
              @click="refreshContext"
            />
            <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" @click="showAiContext = false" />
          </div>
        </div>
      </template>
      <template #body>
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Full prompt that would be sent to the AI provider, including cluster details, SCM diff, and run metadata. Copy
          this to use in your own AI tool.
        </p>
        <MarkdownPreview :text="aiContextRaw" :loading="contextLoading" max-height="70vh" />
      </template>
    </UModal>

    <!-- AI configured: full diagnosis panel -->
    <template v-if="aiStatus?.configured">
      <!-- Additional context drop zone -->
      <div>
        <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Additional context</label>
        <div
          class="rounded-lg border-2 transition-colors"
          :class="dragOver ? 'border-primary bg-primary/5 border-solid' : 'border-dashed border-default'"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <UTextarea
            v-model="additionalContext"
            placeholder="e.g. We deployed a new auth middleware yesterday…"
            :rows="3"
            class="w-full text-sm border-0 bg-transparent focus:ring-0"
          />
          <div class="flex items-center gap-2 px-3 pb-2 pt-1 border-t border-default">
            <input
              ref="fileInputRef"
              type="file"
              multiple
              class="hidden"
              accept=".txt,.log,.md,.json,.ts,.js,.py,.sql,.xml,.yaml,.yml,.html,.css,.env,image/*"
              @change="processFiles(($event.target as HTMLInputElement).files!)"
            />
            <UButton icon="i-lucide-paperclip" size="xs" color="neutral" variant="ghost" @click="fileInputRef?.click()">
              Attach files
            </UButton>
            <span v-if="dragOver" class="text-xs text-primary">Drop files here…</span>
            <span v-else class="text-xs text-gray-400">or drag &amp; drop text files and images</span>
          </div>
        </div>
      </div>

      <!-- Attached text files -->
      <div v-if="attachedFiles.length" class="flex flex-wrap gap-2">
        <div
          v-for="(f, i) in attachedFiles"
          :key="i"
          class="flex items-center gap-1.5 bg-elevated rounded-full px-2.5 py-1 text-xs border border-default"
        >
          <UIcon name="i-lucide-file-text" class="size-3 text-gray-500 shrink-0" />
          <span class="max-w-40 truncate">{{ f.name }}</span>
          <span class="text-gray-400">{{ formatBytes(f.size) }}</span>
          <button class="text-gray-400 hover:text-error ml-0.5" @click="removeFile(i)">
            <UIcon name="i-lucide-x" class="size-3" />
          </button>
        </div>
      </div>

      <!-- Attached images -->
      <div v-if="attachedImages.length" class="flex flex-wrap gap-2">
        <div v-for="(img, i) in attachedImages" :key="i" class="relative group">
          <img :src="img.preview" :alt="img.name" class="h-16 w-16 object-cover rounded-lg border border-default" />
          <div
            class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center"
          >
            <button class="text-white" @click="removeImage(i)">
              <UIcon name="i-lucide-x" class="size-4" />
            </button>
          </div>
          <p class="text-xs text-gray-500 text-center mt-0.5 w-16 truncate">{{ img.name }}</p>
        </div>
      </div>

      <!-- Diagnose button / running state -->
      <div class="pt-1">
        <UButton
          v-if="!diagnosis || diagnosis.status === 'failed' || isStale(diagnosis)"
          icon="i-lucide-sparkles"
          size="sm"
          color="primary"
          variant="solid"
          :loading="posting"
          @click="diagnose()"
        >
          Diagnose with AI
        </UButton>
        <div
          v-else-if="diagnosis.status === 'running' && !isStale(diagnosis)"
          class="flex items-center gap-2 text-sm text-gray-500"
        >
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
          <span>Analyzing failure cluster…</span>
        </div>
      </div>

      <!-- Result -->
      <div class="space-y-3">
        <div
          v-if="diagnosis?.status === 'running' && !isStale(diagnosis)"
          class="flex items-center gap-2 p-4 text-sm text-gray-500 border border-default rounded-lg"
        >
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
          <span>Analyzing failure cluster…</span>
        </div>

        <UAlert
          v-if="diagnosis && (diagnosis.status === 'failed' || isStale(diagnosis))"
          color="error"
          title="Diagnosis failed"
          :description="diagnosis.error || 'Unknown error'"
        />

        <div
          v-if="diagnosis && diagnosis.status === 'completed'"
          class="space-y-3 rounded-lg border border-default p-4 bg-elevated/30"
        >
          <div class="flex items-start justify-between gap-2">
            <div v-if="diagnosis.category || diagnosis.confidence" class="flex flex-wrap items-center gap-1.5">
              <UBadge
                v-if="diagnosis.category"
                :color="categoryColors[diagnosis.category] || 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ diagnosis.category }}
              </UBadge>
              <UBadge
                v-if="diagnosis.confidence"
                :color="confidenceColors[diagnosis.confidence] || 'neutral'"
                variant="outline"
                size="sm"
              >
                {{ diagnosis.confidence }} confidence
              </UBadge>
            </div>
            <UButton
              icon="i-lucide-copy"
              size="xs"
              color="neutral"
              variant="ghost"
              title="Copy full diagnosis (Markdown + HTML)"
              @click="copyDiagnosis"
            />
          </div>

          <p v-if="diagnosis.summary" class="text-sm font-medium">{{ diagnosis.summary }}</p>

          <p v-if="diagnosis.rootCause" class="text-sm text-gray-600 dark:text-gray-400">{{ diagnosis.rootCause }}</p>

          <ul v-if="details?.evidence?.length" class="list-disc list-inside space-y-1">
            <li v-for="(e, i) in details.evidence" :key="i" class="text-sm text-gray-600 dark:text-gray-400">
              {{ e }}
            </li>
          </ul>

          <div v-if="details?.suggestedFix">
            <p class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Suggested fix</p>
            <p class="text-sm text-gray-600 dark:text-gray-400">{{ details.suggestedFix.description }}</p>
            <code
              v-if="details.suggestedFix.file && !details.suggestedFix.patch"
              class="block text-xs font-mono mt-1 text-primary"
              >{{ details.suggestedFix.file }}</code
            >

            <div v-if="details.suggestedFix.patch" class="mt-2">
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs text-gray-500 font-mono"
                  >patch — apply with <code class="bg-muted px-1 rounded">git apply</code></span
                >
                <UButton
                  icon="i-lucide-copy"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  title="Copy patch"
                  @click="copy(details.suggestedFix.patch)"
                />
              </div>
              <MarkdownPreview :text="'```diff\n' + details.suggestedFix.patch + '\n```'" />
            </div>

            <div v-else-if="details.suggestedFix.code" class="mt-2">
              <CodeBlock :code="details.suggestedFix.code" />
            </div>
          </div>

          <ul v-if="details?.preventionTips?.length" class="space-y-1">
            <li class="text-xs font-medium text-gray-500 uppercase tracking-wide">Prevention tips</li>
            <li
              v-for="(t, i) in details.preventionTips"
              :key="i"
              class="text-sm text-gray-600 dark:text-gray-400 flex gap-1.5"
            >
              <UIcon name="i-lucide-lightbulb" class="size-3.5 shrink-0 mt-0.5 text-yellow-500" />
              {{ t }}
            </li>
          </ul>

          <div class="text-xs text-gray-400 pt-1 border-t border-default">
            {{ diagnosis.model }} · {{ formatTokens(diagnosis.inputTokens, diagnosis.outputTokens) }} ·
            {{ formatRelativeTime(diagnosis.updatedAt) }}
          </div>
        </div>

        <div
          v-if="!diagnosis"
          class="flex flex-col items-center justify-center p-8 text-center text-gray-400 border border-dashed border-default rounded-lg"
        >
          <UIcon name="i-lucide-sparkles" class="size-8 mb-2 opacity-30" />
          <p class="text-sm">Diagnosis will appear here</p>
        </div>
      </div>
    </template>

    <!-- AI not configured: still offer context access -->
    <template v-else>
      <div
        class="flex flex-col items-center justify-center p-8 text-center text-gray-400 border border-dashed border-default rounded-lg"
      >
        <UIcon name="i-lucide-sparkles" class="size-8 mb-2 opacity-30" />
        <p class="text-sm">AI diagnosis is not configured</p>
        <UButton to="/settings/ai" size="xs" color="neutral" variant="outline" class="mt-3">
          Configure in Settings
        </UButton>
        <p class="text-xs text-gray-400 mt-4 max-w-xs">
          Use the <strong>Show context</strong> button above to inspect the full diagnosis context and copy it for use
          with your own AI tool.
        </p>
      </div>
    </template>
  </div>
</template>
