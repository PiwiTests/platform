<script setup lang="ts">
import type { FailureDiagnosis } from '~~/server/database/schema'
import { formatRelativeTime } from '~/utils'

const props = defineProps<{
  clusterId: number
}>()

const { aiStatus } = useAiStatus()
const toast = useToast()

const diagnosis = ref<FailureDiagnosis | null>(null)
const posting = ref(false)
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)

// Context preview
const contextOpen = ref(false)
const contextText = ref<string | null>(null)
const loadingContext = ref(false)

// Attachments
const additionalContext = ref('')
const attachedFiles = ref<Array<{ name: string, content: string, size: number }>>([])
const attachedImages = ref<Array<{ name: string, mediaType: string, data: string, preview: string, size: number }>>([])
const fileInputRef = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)

const MAX_TEXT_BYTES = 200 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

function formatBytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const part = (reader.result as string).split(',')[1]
      if (part !== undefined) resolve(part)
      else reject(new Error('Failed to read file'))
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function processFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    if (SUPPORTED_IMAGE_TYPES.includes(file.type)) {
      if (file.size > MAX_IMAGE_BYTES) {
        toast.add({ title: 'Image too large', description: `${file.name} exceeds 5 MB`, color: 'error' })
        continue
      }
      const data = await fileToBase64(file)
      const preview = `data:${file.type};base64,${data}`
      attachedImages.value.push({ name: file.name, mediaType: file.type, data, preview, size: file.size })
    } else {
      if (file.size > MAX_TEXT_BYTES) {
        toast.add({ title: 'File too large', description: `${file.name} exceeds 200 KB`, color: 'error' })
        continue
      }
      const content = await file.text()
      attachedFiles.value.push({ name: file.name, content, size: file.size })
    }
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragOver.value = true
}

function onDragLeave(e: DragEvent) {
  if (!(e.currentTarget as HTMLElement)?.contains(e.relatedTarget as Node)) {
    dragOver.value = false
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false
  if (e.dataTransfer?.files?.length) processFiles(e.dataTransfer.files)
}

function removeFile(i: number) {
  attachedFiles.value.splice(i, 1)
}

function removeImage(i: number) {
  attachedImages.value.splice(i, 1)
}

function buildPromptContext() {
  const parts: string[] = []
  if (additionalContext.value.trim()) parts.push(additionalContext.value.trim())
  if (attachedFiles.value.length) {
    const blocks = attachedFiles.value.map(f => `### ${f.name}\n\`\`\`\n${f.content}\n\`\`\``)
    parts.push(`## Attached Files\n\n${blocks.join('\n\n')}`)
  }
  return parts.join('\n\n')
}

async function fetchDiagnosis() {
  try {
    diagnosis.value = await $fetch<FailureDiagnosis | null>(`/api/failure-clusters/${props.clusterId}/diagnosis`)
  } catch {
    // ignore
  }
}

async function fetchContext() {
  if (contextText.value !== null) return
  loadingContext.value = true
  try {
    const res = await $fetch<{ context: string }>(`/api/failure-clusters/${props.clusterId}/context`)
    contextText.value = res.context
  } catch {
    contextText.value = '(failed to load context)'
  } finally {
    loadingContext.value = false
  }
}

watch(contextOpen, (open) => {
  if (open) fetchContext()
})

function startPoll() {
  if (pollTimer.value) return
  let elapsed = 0
  pollTimer.value = setInterval(async () => {
    elapsed += 3000
    await fetchDiagnosis()
    if (!diagnosis.value || diagnosis.value.status !== 'running' || elapsed >= 120_000) stopPoll()
  }, 3000)
}

function stopPoll() {
  if (pollTimer.value) {
    clearInterval(pollTimer.value)
    pollTimer.value = null
  }
}

async function diagnose(force = false) {
  posting.value = true
  try {
    const url = force
      ? `/api/failure-clusters/${props.clusterId}/diagnose?force=true`
      : `/api/failure-clusters/${props.clusterId}/diagnose`
    const ctx = buildPromptContext()
    const body: Record<string, unknown> = {}
    if (ctx) body.additionalContext = ctx
    if (attachedImages.value.length) {
      body.images = attachedImages.value.map(img => ({
        name: img.name,
        mediaType: img.mediaType,
        data: img.data
      }))
    }
    diagnosis.value = await $fetch<FailureDiagnosis>(url, {
      method: 'POST',
      body: Object.keys(body).length ? body : undefined
    })
    if (diagnosis.value?.status === 'running') startPoll()
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode
    if (status === 409) {
      startPoll()
    } else {
      toast.add({ title: 'Diagnosis failed', description: String((err as Error)?.message ?? err), color: 'error' })
    }
  } finally {
    posting.value = false
  }
}

onMounted(fetchDiagnosis)
onUnmounted(stopPoll)
watch(diagnosis, (val) => {
  if (val?.status === 'running') startPoll()
  else stopPoll()
})

const categoryColors: Record<string, 'error' | 'warning' | 'info' | 'secondary' | 'neutral'> = {
  'app-bug': 'error',
  'test-bug': 'warning',
  'flaky-test': 'warning',
  'infrastructure': 'info',
  'environment': 'secondary',
  'unknown': 'neutral'
}

const confidenceColors: Record<string, 'success' | 'warning' | 'neutral'> = {
  high: 'success',
  medium: 'warning',
  low: 'neutral'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const details = computed(() => diagnosis.value?.details as any)

function formatTokens(i: number | null, o: number | null) {
  if (i == null && o == null) return ''
  return `${i ?? 0} in / ${o ?? 0} out tokens`
}

function isStale(d: FailureDiagnosis) {
  return d.status === 'running' && Date.now() - new Date(d.updatedAt).getTime() > 5 * 60 * 1000
}

function copyToClipboard(text: string | null) {
  if (text) window.navigator.clipboard?.writeText(text)
}
</script>

<template>
  <div class="space-y-4">
    <!-- Context preview + attachment UI -->
    <template v-if="aiStatus?.configured">
      <!-- Context preview collapsible -->
      <div class="rounded-lg border border-default overflow-hidden">
        <button
          class="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium bg-elevated hover:bg-accented transition-colors"
          @click="contextOpen = !contextOpen"
        >
          <span class="flex items-center gap-2">
            <UIcon name="i-lucide-file-text" class="size-4 text-gray-500" />
            Preview what will be sent to AI
          </span>
          <UIcon :name="contextOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-gray-400" />
        </button>
        <div v-if="contextOpen" class="p-4 border-t border-default">
          <div v-if="loadingContext" class="flex items-center gap-2 text-sm text-gray-500">
            <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
            <span>Loading context…</span>
          </div>
          <pre v-else class="text-xs font-mono bg-muted rounded p-3 overflow-x-auto max-h-96 whitespace-pre-wrap">{{ contextText }}</pre>
        </div>
      </div>

      <!-- Attachment area -->
      <div>
        <p class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
          Additional context
        </p>
        <p class="text-xs text-gray-500 mb-2">
          Appended to the AI prompt — add observations, paste snippets, or attach files and screenshots
        </p>

        <!-- Drop zone -->
        <div
          class="rounded-lg border-2 transition-colors"
          :class="dragOver ? 'border-primary bg-primary/5 border-solid' : 'border-dashed border-default'"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <UTextarea
            v-model="additionalContext"
            placeholder="e.g. We deployed a new auth middleware yesterday. This might be related to the redirect loop on /login…"
            :rows="4"
            class="w-full text-sm border-0 bg-transparent focus:ring-0"
          />

          <!-- Toolbar -->
          <div class="flex items-center gap-2 px-3 pb-2.5 pt-1 border-t border-default">
            <input
              ref="fileInputRef"
              type="file"
              multiple
              class="hidden"
              accept=".txt,.log,.md,.json,.ts,.js,.py,.sql,.xml,.yaml,.yml,.html,.css,.env,image/*"
              @change="processFiles(($event.target as HTMLInputElement).files!)"
            >
            <UButton
              icon="i-lucide-paperclip"
              size="xs"
              color="neutral"
              variant="ghost"
              @click="fileInputRef?.click()"
            >
              Attach files
            </UButton>
            <span v-if="dragOver" class="text-xs text-primary">Drop files here…</span>
            <span v-else class="text-xs text-gray-400">or drag &amp; drop text files and images</span>
          </div>
        </div>

        <!-- Attached text files -->
        <div v-if="attachedFiles.length" class="flex flex-wrap gap-2 mt-2">
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
        <div v-if="attachedImages.length" class="flex flex-wrap gap-2 mt-2">
          <div
            v-for="(img, i) in attachedImages"
            :key="i"
            class="relative group"
          >
            <img
              :src="img.preview"
              :alt="img.name"
              class="h-16 w-16 object-cover rounded-lg border border-default"
            >
            <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
              <button class="text-white" @click="removeImage(i)">
                <UIcon name="i-lucide-x" class="size-4" />
              </button>
            </div>
            <p class="text-xs text-gray-500 text-center mt-0.5 w-16 truncate">
              {{ img.name }}
            </p>
          </div>
        </div>
      </div>
    </template>

    <!-- Not configured + no diagnosis -->
    <template v-if="!aiStatus?.configured && !diagnosis" />

    <!-- Configured, no diagnosis yet -->
    <div v-else-if="!diagnosis && aiStatus?.configured">
      <UButton
        icon="i-lucide-sparkles"
        size="sm"
        color="primary"
        variant="soft"
        :loading="posting"
        @click="diagnose()"
      >
        Diagnose with AI
      </UButton>
    </div>

    <!-- Running -->
    <div
      v-else-if="diagnosis && diagnosis.status === 'running' && !isStale(diagnosis)"
      class="flex items-center gap-2 text-sm text-gray-500"
    >
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
      <span>Analyzing failure cluster… this can take a minute</span>
    </div>

    <!-- Completed -->
    <div
      v-else-if="diagnosis && diagnosis.status === 'completed'"
      class="space-y-3 rounded-lg border border-default p-4 bg-elevated/30"
    >
      <div class="flex flex-wrap items-center gap-1.5">
        <UIcon name="i-lucide-sparkles" class="size-4 text-primary shrink-0" />
        <span class="text-sm font-medium text-gray-700 dark:text-gray-300">AI Diagnosis</span>
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

      <p v-if="diagnosis.summary" class="text-sm font-medium">
        {{ diagnosis.summary }}
      </p>

      <p v-if="diagnosis.rootCause" class="text-sm text-gray-600 dark:text-gray-400">
        {{ diagnosis.rootCause }}
      </p>

      <ul v-if="details?.evidence?.length" class="list-disc list-inside space-y-1">
        <li
          v-for="(e, i) in details.evidence"
          :key="i"
          class="text-sm text-gray-600 dark:text-gray-400"
        >
          {{ e }}
        </li>
      </ul>

      <div v-if="details?.suggestedFix">
        <p class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Suggested fix
        </p>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ details.suggestedFix.description }}
        </p>
        <code v-if="details.suggestedFix.file" class="block text-xs font-mono mt-1 text-primary">{{ details.suggestedFix.file }}</code>
        <div v-if="details.suggestedFix.code" class="relative mt-2">
          <pre class="text-xs font-mono bg-muted rounded p-3 overflow-x-auto">{{ details.suggestedFix.code }}</pre>
          <UButton
            icon="i-lucide-copy"
            size="xs"
            color="neutral"
            variant="ghost"
            class="absolute top-1 right-1"
            title="Copy code"
            @click="copyToClipboard(details.suggestedFix.code)"
          />
        </div>
      </div>

      <ul v-if="details?.preventionTips?.length" class="space-y-1">
        <li class="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Prevention tips
        </li>
        <li
          v-for="(t, i) in details.preventionTips"
          :key="i"
          class="text-sm text-gray-600 dark:text-gray-400 flex gap-1.5"
        >
          <UIcon name="i-lucide-lightbulb" class="size-3.5 shrink-0 mt-0.5 text-yellow-500" />
          {{ t }}
        </li>
      </ul>

      <div class="flex items-center justify-between text-xs text-gray-400 pt-1 border-t border-default">
        <span>{{ diagnosis.model }} · {{ formatTokens(diagnosis.inputTokens, diagnosis.outputTokens) }} · {{ formatRelativeTime(diagnosis.updatedAt) }}</span>
        <UButton
          icon="i-lucide-refresh-cw"
          size="xs"
          color="neutral"
          variant="ghost"
          :loading="posting"
          @click="diagnose(true)"
        >
          Re-diagnose
        </UButton>
      </div>
    </div>

    <!-- Failed / stale -->
    <div v-else-if="diagnosis && (diagnosis.status === 'failed' || isStale(diagnosis))" class="space-y-2">
      <UAlert color="error" title="Diagnosis failed" :description="diagnosis.error || 'Unknown error'" />
      <UButton
        icon="i-lucide-refresh-cw"
        size="sm"
        color="neutral"
        variant="soft"
        :loading="posting"
        @click="diagnose(true)"
      >
        Retry
      </UButton>
    </div>
  </div>
</template>
