<script setup lang="ts">
import type { FailureDiagnosis } from '~~/server/database/schema';

const props = defineProps<{
  clusterId?: number;
  lastSeenRunId?: number;
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

const showAiContext = ref(false);

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

function isStale(d: FailureDiagnosis) {
  return d.status === 'running' && Date.now() - new Date(d.updatedAt).getTime() > 5 * 60 * 1000;
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
          <span class="text-xs text-gray-400">
            &mdash;
            <UIcon name="i-lucide-triangle-alert" class="size-3 shrink-0 inline" />
            AI-generated, verify before applying
          </span>
        </div>
        <div class="flex items-center gap-1.5">
          <DiagnosisExportMenu :context-text="contextText" :diagnosis="diagnosis" />
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
      @update:open="showAiContext = $event"
      @refresh="refreshContext"
    />

    <!-- AI configured: full panel -->
    <template v-if="aiStatus?.configured">
      <!-- Additional context -->
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
            <UButton icon="i-lucide-paperclip" size="xs" color="neutral" variant="ghost" @click="fileInputRef?.click()">
              Attach files
            </UButton>
            <span v-if="dragOver" class="text-xs text-primary">Drop files here\u2026</span>
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

      <!-- Diagnose button -->
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
          <span>Analyzing failure cluster\u2026</span>
        </div>
      </div>

      <!-- Diagnosis result -->
      <DiagnosisResult :diagnosis="diagnosis" :last-seen-run-id="lastSeenRunId" />

      <div
        v-if="diagnosis?.status === 'running' && !isStale(diagnosis)"
        class="flex items-center gap-2 p-4 text-sm text-gray-500 border border-default rounded-lg"
      >
        <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
        <span>Analyzing failure cluster\u2026</span>
      </div>
    </template>

    <!-- AI not configured -->
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
