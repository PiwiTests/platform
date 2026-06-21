<script setup lang="ts">
import type { FailureDiagnosis } from '~~/server/database/schema';
import { formatRelativeTime } from '~/utils';

const props = defineProps<{
  diagnosis: FailureDiagnosis | null;
  /** The cluster's lastSeenRunId — for staleness detection */
  lastSeenRunId?: number;
}>();

const { copy, copied } = useCopy();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const details = computed(() => props.diagnosis?.details as any);

function formatTokens(i: number | null, o: number | null) {
  if (i == null && o == null) return '';
  return `${i ?? 0} in / ${o ?? 0} out tokens`;
}

function isRunningStale(d: FailureDiagnosis) {
  return d.status === 'running' && Date.now() - new Date(d.updatedAt).getTime() > 5 * 60 * 1000;
}

const feedbackSaving = ref(false);
const localFeedback = ref<string | null>(null);

watch(
  () => props.diagnosis?.feedback,
  (v) => {
    localFeedback.value = v ?? null;
  },
  { immediate: true },
);

async function setFeedback(value: 'up' | 'down') {
  if (!props.diagnosis) return;
  const newValue = localFeedback.value === value ? null : value;
  localFeedback.value = newValue;
  feedbackSaving.value = true;
  try {
    await $fetch(`/api/failure-diagnoses/${props.diagnosis.id}/feedback`, {
      method: 'PATCH',
      body: { feedback: newValue },
    });
  } catch {
    localFeedback.value = props.diagnosis.feedback ?? null;
  } finally {
    feedbackSaving.value = false;
  }
}

const isStale = computed(() => {
  const d = props.diagnosis;
  if (!d || d.status !== 'completed') return false;
  const runId = props.lastSeenRunId;
  if (runId == null) return false;
  return new Date(d.updatedAt).getTime() < Date.now() - 5 * 60 * 1000;
});

function diagnosisMarkdown(): string {
  if (!props.diagnosis || props.diagnosis.status !== 'completed') return '';
  const d = props.diagnosis;
  const det = details.value;
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
  if (!props.diagnosis || props.diagnosis.status !== 'completed') return '';
  const d = props.diagnosis;
  const det = details.value;
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
    const toast = useToast();
    toast.add({ title: 'Diagnosis copied', icon: 'i-lucide-check', color: 'success', duration: 2000 });
  } catch {
    copy(md, { toast: 'Diagnosis copied' });
  }
}

function copyGitApply() {
  const d = props.diagnosis;
  if (!d) return;
  const patch = (d.details as any)?.suggestedFix?.patch as string | undefined;
  if (!patch) return;
  const cmd = `git apply <<'EOF'\n${patch}\nEOF`;
  copy(cmd, { toast: 'git apply command copied' });
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
</script>

<template>
  <div class="space-y-3">
    <UAlert
      v-if="diagnosis && (diagnosis.status === 'failed' || isRunningStale(diagnosis))"
      color="error"
      title="Diagnosis failed"
      :description="diagnosis.error || 'Unknown error'"
    />

    <UAlert
      v-if="isStale"
      color="warning"
      icon="i-lucide-clock"
      title="Diagnosis may be stale"
      description="New evidence may have appeared since this diagnosis was made. Consider re-running."
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
          :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
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
            <span class="text-xs text-gray-500 font-mono">patch</span>
            <div class="flex items-center gap-1">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-terminal"
                title="Copy git apply command"
                @click="copyGitApply"
              />
              <UButton
                :icon="copied ? 'i-lucide-check' : 'i-lucide-clipboard'"
                size="xs"
                color="neutral"
                variant="ghost"
                title="Copy patch"
                @click="copy(details.suggestedFix.patch)"
              />
            </div>
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

      <div class="flex items-center justify-between pt-1 border-t border-default">
        <div class="flex items-center gap-2">
          <UButton
            :icon="localFeedback === 'up' ? 'i-lucide-thumbs-up' : 'i-lucide-thumbs-up'"
            :color="localFeedback === 'up' ? 'success' : 'neutral'"
            variant="ghost"
            size="xs"
            :loading="feedbackSaving"
            @click="setFeedback('up')"
          />
          <UButton
            :icon="localFeedback === 'down' ? 'i-lucide-thumbs-down' : 'i-lucide-thumbs-down'"
            :color="localFeedback === 'down' ? 'error' : 'neutral'"
            variant="ghost"
            size="xs"
            :loading="feedbackSaving"
            @click="setFeedback('down')"
          />
        </div>
        <div class="text-xs text-gray-400">
          {{ diagnosis.model }} · {{ formatTokens(diagnosis.inputTokens, diagnosis.outputTokens) }} ·
          {{ formatRelativeTime(diagnosis.updatedAt) }}
        </div>
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
