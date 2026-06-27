<script setup lang="ts">
import type { FailureDiagnosis } from '~~/server/database/schema';
import { extractCitedSectionIds } from '#shared/diagnosis-sections';
import type { DiagnoseImage } from '~/composables/useClusterDiagnosis';
import { formatRelativeTime } from '~/utils';

const props = defineProps<{
  clusterId?: number;
  lastSeenRunId?: number;
  affectedTestCases?: Array<{
    testCaseId: number;
    title: string;
    filePath: string;
    runCount: number;
    recentTestRunsCaseId: number;
  }>;
}>();

const {
  diagnosis,
  posting,
  contextText,
  contextSections,
  tokenEstimate,
  contextLoading,
  refreshContext,
  runDiagnosis,
} = useOrProvideClusterDiagnosis(props.clusterId);
const { aiStatus } = useAiStatus();
const toast = useToast();

const {
  thinkingText: streamThinkingText,
  stage: streamStage,
  status: streamStatus,
  result: streamResult,
  error: streamError,
  startStream,
  cancel: cancelStream,
  reset: resetStream,
} = useStreamingDiagnosis(computed(() => props.clusterId ?? 0));

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
const testCaseImages = ref<DiagnoseImage[]>([]);

const allImages = computed<DiagnoseImage[]>(() => [
  ...testCaseImages.value,
  ...(attachedImages.value.length ? attachments.imagesPayload() : []),
]);

const showAiContext = ref(false);
const showAdditionalContext = ref(false);
const focusSection = ref<string | null>(null);

const thinkingContainer = ref<HTMLElement | null>(null);

/** Open the AI context modal focused on a section (from an evidence citation). */
function onViewSection(sectionId: string) {
  focusSection.value = sectionId;
  showAiContext.value = true;
}

/** Section ids the diagnosis actually cited — highlighted in the context modal. */
const citedSections = computed<string[]>(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const det = diagnosis.value?.details as any;
  if (!det) return [];
  const texts: string[] = [];
  if (Array.isArray(det.evidence)) texts.push(...det.evidence);
  if (Array.isArray(det.hypotheses)) {
    for (const h of det.hypotheses) if (Array.isArray(h?.evidence)) texts.push(...h.evidence);
  }
  return extractCitedSectionIds(texts);
});

/** Auto-scroll the thinking container as new tokens arrive. */
watch(streamThinkingText, () => {
  nextTick(() => {
    if (thinkingContainer.value) {
      thinkingContainer.value.scrollTop = thinkingContainer.value.scrollHeight;
    }
  });
});

/** When streaming completes with a result, update the shared diagnosis store. */
watch(streamResult, (val) => {
  if (val) {
    diagnosis.value = val;
  }
});

/** Assisted iteration: pre-fill the additional-context box and open it. */
function onPrefillContext(text: string) {
  additionalContext.value = additionalContext.value ? `${additionalContext.value}\n\n${text}` : text;
  showAdditionalContext.value = true;
}

function buildPromptContext() {
  const parts: string[] = [];
  if (additionalContext.value.trim()) parts.push(additionalContext.value.trim());
  const filesMd = attachments.filesMarkdown();
  if (filesMd) parts.push(filesMd);
  return parts.join('\n\n');
}

async function diagnose(force = false) {
  await startStream({
    force,
    additionalContext: buildPromptContext() || undefined,
    images: allImages.value.length ? allImages.value : undefined,
  });
}

async function diagnoseFallback(force = false) {
  await runDiagnosis({
    force,
    additionalContext: buildPromptContext() || undefined,
    images: allImages.value.length ? allImages.value : undefined,
  });
}

function markDiagnosisFailed() {
  diagnosis.value = null;
}

function isStale(d: FailureDiagnosis) {
  return d.status === 'running' && Date.now() - new Date(d.updatedAt).getTime() > 5 * 60 * 1000;
}

function isStreaming() {
  return streamStatus.value === 'streaming';
}

function showDiagnoseButton() {
  return !isStreaming() && (!diagnosis.value || diagnosis.value.status === 'failed' || isStale(diagnosis.value));
}

function showResult() {
  return (
    !isStreaming() && diagnosis.value && (diagnosis.value.status === 'completed' || diagnosis.value.status === 'failed')
  );
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="pb-2 border-b border-default">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5">
          <UIcon name="i-lucide-sparkles" class="size-4 text-primary shrink-0" />
          <span class="text-sm font-semibold">Diagnosis</span>
          <HelpHint topic="cluster.diagnosis" />
          <span class="text-xs text-gray-400">
            &mdash;
            <UIcon name="i-lucide-triangle-alert" class="size-3 shrink-0 inline" />
            AI-generated, verify before applying
          </span>
        </div>
        <div class="flex items-center gap-1.5">
          <DiagnosisExportMenu :context-text="contextText" :diagnosis="diagnosis" :screenshots="allImages" />
          <UButton
            :icon="showAiContext ? 'i-lucide-eye-off' : 'i-lucide-eye'"
            size="xs"
            color="neutral"
            variant="outline"
            :loading="contextLoading"
            @click="showAiContext = !showAiContext"
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

    <!-- Context modal -->
    <DiagnosisContextModal
      :open="showAiContext"
      :sections="contextSections"
      :token-estimate="tokenEstimate"
      :loading="contextLoading"
      :focus-section="focusSection"
      :cited-sections="citedSections"
      @update:open="
        showAiContext = $event;
        if (!$event) focusSection = null;
      "
      @refresh="refreshContext"
    />

    <!-- AI configured: full panel -->
    <template v-if="aiStatus?.configured">
      <!-- Additional context (collapsible, collapsed by default) -->
      <div>
        <div class="flex items-center gap-1 mb-1">
          <button
            class="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-left"
            @click="showAdditionalContext = !showAdditionalContext"
          >
            <UIcon
              :name="showAdditionalContext ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              class="size-3.5"
            />
            Additional context
            <span v-if="attachedFiles.length || attachedImages.length || additionalContext.trim()" class="text-primary">
              ({{ attachedFiles.length + attachedImages.length + (additionalContext.trim() ? 1 : 0) }})
            </span>
          </button>
          <HelpHint topic="cluster.context-input" />
        </div>
        <div v-if="showAdditionalContext">
          <div
            class="rounded-lg border-2 transition-colors"
            :class="dragOver ? 'border-primary bg-primary/5 border-solid' : 'border-dashed border-default'"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @drop="onDrop"
          >
            <UTextarea
              v-model="additionalContext"
              placeholder="e.g. We deployed a new auth middleware yesterday\u2026"
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
              <UButton
                icon="i-lucide-paperclip"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="fileInputRef?.click()"
              >
                Attach files
              </UButton>
              <span v-if="dragOver" class="text-xs text-primary">Drop files here\u2026</span>
              <span v-else class="text-xs text-gray-400">or drag &amp; drop text files and images</span>
            </div>
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

      <!-- Attached images (manually dragged/uploaded) -->
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

      <!-- Screenshots from test evidence (auto-loaded) -->
      <DiagnosisScreenshots
        v-if="affectedTestCases?.length"
        :affected-test-cases="affectedTestCases"
        @update:images="testCaseImages = $event"
      />

      <!-- Diagnose button -->
      <div v-if="showDiagnoseButton()" class="pt-1">
        <UButton
          icon="i-lucide-sparkles"
          size="sm"
          color="primary"
          variant="solid"
          :loading="posting"
          @click="diagnose()"
        >
          Diagnose with AI
        </UButton>
      </div>

      <!-- Live thinking panel while streaming -->
      <div v-if="isStreaming()" class="rounded-lg border border-default overflow-hidden">
        <!-- Stage header -->
        <div class="flex items-center justify-between gap-2 px-3 py-2 bg-elevated/30 border-b border-default">
          <div class="flex items-center gap-2 text-sm text-gray-500">
            <UIcon name="i-lucide-loader-2" class="size-4 animate-spin text-primary" />
            <span>Analyzing failure cluster</span>
            <span v-if="streamStage" class="inline-flex items-center gap-1 text-xs text-gray-400">
              <UIcon name="i-lucide-workflow" class="size-3" />
              {{ streamStage === 'research' ? 'Researching patterns' : 'Diagnosing root cause' }}
            </span>
          </div>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            title="Cancel diagnosis"
            @click="cancelStream"
          />
        </div>

        <!-- Thinking tokens container -->
        <div
          ref="thinkingContainer"
          class="max-h-64 overflow-y-auto p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words text-gray-600 dark:text-gray-400 bg-elevated/10"
        >
          <template v-if="streamThinkingText">
            {{ streamThinkingText }}
            <span class="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-0.5 align-text-bottom" />
          </template>
          <template v-else>
            <span class="text-gray-400 italic">Waiting for model response\u2026</span>
          </template>
        </div>

        <!-- Token counter footer -->
        <div class="px-3 py-1.5 border-t border-default text-xs text-gray-400 flex items-center gap-2">
          <UIcon name="i-lucide-file-text" class="size-3" />
          <span>{{ streamThinkingText.length.toLocaleString() }} characters received</span>
        </div>
      </div>

      <!-- Stuck diagnosis: running from DB but not actively streaming (server crashed mid-stream) -->
      <div
        v-if="diagnosis?.status === 'running' && !isStale(diagnosis) && !isStreaming()"
        class="rounded-lg border border-warning/40 bg-warning/5 p-3 space-y-2"
      >
        <div class="flex items-center gap-2 text-sm">
          <UIcon name="i-lucide-alert-triangle" class="size-4 text-warning shrink-0" />
          <span class="font-medium text-warning-700 dark:text-warning-400">Diagnosis was interrupted</span>
        </div>
        <p class="text-xs text-gray-500">
          A previous diagnosis started but never completed — the server may have restarted. You can restart it below.
        </p>
        <div class="flex items-center gap-2 pt-1">
          <UButton
            icon="i-lucide-refresh-cw"
            size="xs"
            color="warning"
            variant="solid"
            :loading="posting"
            @click="diagnose(true)"
          >
            Restart diagnosis
          </UButton>
          <UButton size="xs" color="neutral" variant="ghost" :loading="posting" @click="markDiagnosisFailed">
            Dismiss
          </UButton>
        </div>
        <p class="text-xs text-gray-400">Started {{ formatRelativeTime(diagnosis.updatedAt) }}</p>
      </div>

      <!-- Streaming error banner -->
      <UAlert
        v-if="streamError"
        color="error"
        icon="i-lucide-alert-circle"
        title="Streaming diagnosis failed"
        :description="streamError"
        class="mt-2"
      >
        <template #actions>
          <UButton size="xs" color="neutral" variant="outline" @click="diagnoseFallback(true)">
            Retry (fallback)
          </UButton>
        </template>
      </UAlert>

      <!-- Diagnosis result -->
      <DiagnosisResult
        v-if="showResult()"
        :diagnosis="diagnosis"
        :last-seen-run-id="lastSeenRunId"
        @view-section="onViewSection"
        @prefill-context="onPrefillContext"
      />
    </template>

    <!-- AI not configured -->
    <template v-else>
      <div
        class="flex flex-col items-center justify-center p-8 text-center text-gray-400 border border-dashed border-default rounded-lg"
      >
        <UIcon name="i-lucide-sparkles" class="size-8 mb-2 opacity-30" />
        <p class="text-sm inline-flex items-center gap-1">
          AI diagnosis is not configured <HelpHint topic="cluster.ai-setup" />
        </p>
        <UButton to="/settings/ai" size="xs" color="neutral" variant="outline" class="mt-3">
          Configure in Settings
        </UButton>
        <p class="text-xs text-gray-400 mt-4 max-w-xs">
          Use the <strong>Show context</strong> button above to inspect the full diagnosis context and copy it for use
          with your own AI tool.
        </p>
      </div>
    </template>

    <!-- MCP link -->
    <div class="pt-1 text-center">
      <NuxtLink
        to="/mcp"
        class="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-primary transition-colors"
      >
        <UIcon name="i-lucide-bot" class="size-3" />
        Query this cluster from your AI agent via the MCP server
      </NuxtLink>
    </div>
  </div>
</template>
