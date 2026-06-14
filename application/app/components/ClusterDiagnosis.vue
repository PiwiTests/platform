<script setup lang="ts">
import type { FailureDiagnosis } from '~~/server/database/schema'
import type { DiagnosisContextCoverage } from '~~/types/api'
import { formatRelativeTime } from '~/utils'

const props = defineProps<{
  clusterId: number
}>()

const { aiStatus } = useAiStatus()
const toast = useToast()

const diagnosis = ref<FailureDiagnosis | null>(null)
const savedBaseCommit = ref<string>('') // last value persisted to DB
const posting = ref(false)
const pollTimer = ref<ReturnType<typeof setInterval> | null>(null)

// Context preview
const contextText = ref<string | null>(null)
const coverage = ref<DiagnosisContextCoverage | null>(null)
const loadingContext = ref(false)

// Attachments + user inputs
const additionalContext = ref('')
const baseCommit = ref('')
const attachedFiles = ref<Array<{ name: string, content: string, size: number }>>([])
const attachedImages = ref<Array<{ name: string, mediaType: string, data: string, preview: string, size: number }>>([])
const fileInputRef = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)

// Commit browser
const commitBrowserOpen = ref(false)
const selectedCommitShas = ref<string[]>([])

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

// Live preview = base context from server + user additions (reactive to text/files)
const fullPreviewText = computed(() => {
  if (!contextText.value) return null
  const ctx = buildPromptContext()
  const parts = [contextText.value]
  if (ctx) parts.push(`## Additional Context Provided by User\n${ctx}`)
  if (attachedImages.value.length) {
    const label = attachedImages.value.length === 1 ? '1 image' : `${attachedImages.value.length} images`
    parts.push(`[${label} attached — sent as vision input, not shown in this preview]`)
  }
  return parts.join('\n\n')
})

// ── SCM coverage display ──────────────────────────────────────────────────────
const scmStatus = computed(() => {
  const scm = coverage.value?.scm
  if (!scm) return { color: 'text-gray-400', icon: 'i-lucide-git-branch', text: 'Git context unavailable', detail: '' }

  // Manual baseline was used (covers both "has last green" and "no last green" cases)
  if (scm.baseCommitUsed) {
    if (scm.filesCount === 0) {
      return { color: 'text-yellow-500', icon: 'i-lucide-git-branch-plus', text: `Manual baseline ${scm.baseCommitUsed.slice(0, 7)} · fetch failed`, detail: 'network error or missing SCM token (check AI settings)' }
    }
    const patchNote = scm.patchesOmitted ? ', no patches (diff too large)' : scm.patchesTruncated ? `, ${scm.patchedFilesCount} with patches (some cut)` : `, ${scm.patchedFilesCount} with patches`
    return {
      color: 'text-blue-500',
      icon: 'i-lucide-git-branch-plus',
      text: `Manual baseline ${scm.baseCommitUsed.slice(0, 7)} · ${scm.filesCount} files${patchNote}`,
      detail: scm.hasLastGreen ? 'overrides last passing run baseline' : 'no last passing run'
    }
  }

  if (!scm.hasLastGreen) return { color: 'text-gray-400', icon: 'i-lucide-git-branch', text: 'No last passing run', detail: 'enter a baseline commit below to enable diff' }
  if (!scm.hasCommitRange) return { color: 'text-gray-400', icon: 'i-lucide-git-branch', text: 'No commit range', detail: 'reporter did not send SCM metadata' }
  if (!scm.provider) return { color: 'text-yellow-500', icon: 'i-lucide-git-branch', text: 'Unsupported SCM host', detail: 'only GitHub, GitLab and Bitbucket are supported' }
  if (scm.filesCount === 0) return { color: 'text-yellow-500', icon: 'i-lucide-git-branch', text: `${scm.provider} · fetch failed`, detail: 'network error or missing SCM token (check AI settings)' }

  if (scm.patchesOmitted) {
    return { color: 'text-yellow-500', icon: 'i-lucide-git-branch', text: `${scm.provider} · ${scm.filesCount} files`, detail: 'diff too large — file list only, no patches' }
  }
  const patchNote = scm.patchesTruncated ? ', some patches cut (budget)' : ''
  const commitNote = scm.commitsCount > 0 ? ` · ${scm.commitsCount} commit${scm.commitsCount > 1 ? 's' : ''}` : ''
  return {
    color: 'text-green-500',
    icon: 'i-lucide-git-branch',
    text: `${scm.provider} · ${scm.filesCount} files · ${scm.patchedFilesCount} with patches${patchNote}${commitNote}`,
    detail: ''
  }
})

// ── Diagnosis flow ────────────────────────────────────────────────────────────
async function fetchDiagnosis() {
  try {
    const res = await $fetch<{ diagnosis: FailureDiagnosis | null, manualBaseCommit: string | null }>(
      `/api/failure-clusters/${props.clusterId}/diagnosis`
    )
    diagnosis.value = res.diagnosis
    // Pre-populate baseCommit from saved value on first load (don't overwrite if user already changed it)
    if (savedBaseCommit.value === baseCommit.value && res.manualBaseCommit) {
      savedBaseCommit.value = res.manualBaseCommit
      baseCommit.value = res.manualBaseCommit
    } else if (!savedBaseCommit.value) {
      savedBaseCommit.value = res.manualBaseCommit ?? ''
    }
  } catch { /* ignore */ }
}

async function persistBaseCommit(sha: string) {
  try {
    await $fetch(`/api/failure-clusters/${props.clusterId}/base-commit`, {
      method: 'PATCH',
      body: { commit: sha || null }
    })
    savedBaseCommit.value = sha
  } catch { /* ignore — non-critical */ }
}

async function fetchContext() {
  loadingContext.value = true
  contextText.value = null
  coverage.value = null
  try {
    const query: Record<string, string | string[]> = {}
    if (baseCommit.value.trim()) query.baseCommit = baseCommit.value.trim()
    if (selectedCommitShas.value.length) query.selectedCommitShas = selectedCommitShas.value
    const res = await $fetch<{ context: string, coverage: DiagnosisContextCoverage }>(
      `/api/failure-clusters/${props.clusterId}/context`,
      { query }
    )
    contextText.value = res.context
    coverage.value = res.coverage
  } catch {
    contextText.value = '(failed to load context)'
  } finally {
    loadingContext.value = false
  }
}

// Debounce context refresh when baseCommit changes (avoids SCM API spam while typing)
let baseCommitTimer: ReturnType<typeof setTimeout> | null = null
watch(baseCommit, (val) => {
  if (baseCommitTimer) clearTimeout(baseCommitTimer)
  baseCommitTimer = setTimeout(() => {
    fetchContext()
  }, 900)
  // Auto-save immediately when the value differs from what's in the DB
  if (val !== savedBaseCommit.value) persistBaseCommit(val)
})

watch(selectedCommitShas, () => {
  fetchContext()
}, { deep: true })

const baseCommitIsPinned = computed(() => !!savedBaseCommit.value)

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
    if (baseCommit.value.trim()) body.baseCommit = baseCommit.value.trim()
    if (selectedCommitShas.value.length) body.selectedCommitShas = selectedCommitShas.value
    if (attachedImages.value.length) {
      body.images = attachedImages.value.map(img => ({ name: img.name, mediaType: img.mediaType, data: img.data }))
    }
    diagnosis.value = await $fetch<FailureDiagnosis>(url, {
      method: 'POST',
      body: Object.keys(body).length ? body : undefined
    })
    if (diagnosis.value?.status === 'running') startPoll()
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode
    if (status === 409) startPoll()
    else toast.add({ title: 'Diagnosis failed', description: String((err as Error)?.message ?? err), color: 'error' })
  } finally {
    posting.value = false
  }
}

onMounted(() => {
  fetchDiagnosis()
  fetchContext()
})
onUnmounted(() => {
  stopPoll()
  if (baseCommitTimer) clearTimeout(baseCommitTimer)
})
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
    <div v-if="aiStatus?.configured" class="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      <!-- LEFT: context preview + input form -->
      <div class="space-y-3">
        <!-- Column header -->

        <div class="pb-2 border-b border-default">
          <!-- Title row -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
              <UIcon name="i-lucide-sparkles" class="size-4 text-primary shrink-0" />
              <span class="text-sm font-semibold">Error context</span>

              <span class="text-xs text-gray-400 items-center gap-1">
                &mdash;
                What will be sent to AI
              </span>
            </div>

            <UButton
              icon="i-lucide-refresh-cw"
              size="xs"
              color="neutral"
              variant="outline"
              :loading="loadingContext"
              class="ml-auto shrink-0"
              @click="fetchContext"
            >
              Refresh
            </UButton>
          </div>

          <!-- Baseline commit row -->
          <div class="flex items-center gap-2 mt-2 flex-wrap">
            <span class="text-xs text-gray-500 font-medium shrink-0">Baseline</span>
            <CommitPicker v-model="baseCommit" :cluster-id="clusterId" />
            <UTooltip v-if="baseCommitIsPinned" text="Baseline commit pinned for this cluster">
              <UIcon name="i-lucide-pin" class="size-3.5 text-primary shrink-0" />
            </UTooltip>
            <div class="flex items-center gap-1.5 ml-auto">
              <!-- Selected commits chip -->
              <div
                v-if="selectedCommitShas.length"
                class="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium"
              >
                <UIcon name="i-lucide-git-commit-horizontal" class="size-3" />
                <span>{{ selectedCommitShas.length }} commit{{ selectedCommitShas.length === 1 ? '' : 's' }}</span>
                <button class="ml-0.5 hover:opacity-70 transition-opacity" @click="selectedCommitShas = []">
                  <UIcon name="i-lucide-x" class="size-3" />
                </button>
              </div>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-list"
                @click="commitBrowserOpen = true"
              >
                Browse
              </UButton>
            </div>
          </div>
        </div>

        <!-- SCM coverage badge -->
        <div
          v-if="coverage"
          class="flex items-start gap-1.5 text-xs px-2 py-1.5 rounded-md bg-elevated border border-default"
        >
          <UIcon :name="scmStatus.icon" class="size-3.5 mt-0.5 shrink-0" :class="scmStatus.color" />
          <div>
            <span :class="scmStatus.color">{{ scmStatus.text }}</span>
            <span v-if="scmStatus.detail" class="text-gray-400 ml-1">— {{ scmStatus.detail }}</span>
          </div>
        </div>

        <!-- Live markdown preview -->
        <MarkdownPreview :text="fullPreviewText" :loading="loadingContext" />

        <!-- Additional context drop zone -->
        <div>
          <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            Additional context
          </label>
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
            <img :src="img.preview" :alt="img.name" class="h-16 w-16 object-cover rounded-lg border border-default">
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
            <span>Analyzing failure cluster…</span>
          </div>
        </div>
      </div>

      <!-- RIGHT: diagnosis result — capped at 60dvh so it always fits on screen -->
      <div class="xl:max-h-[60dvh] xl:overflow-y-auto xl:pr-1">
        <!-- Column header -->
        <div class="pb-2 border-b border-default">
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
              <UIcon name="i-lucide-sparkles" class="size-4 text-primary shrink-0" />
              <span class="text-sm font-semibold">AI diagnosis</span>
              <span class="text-xs text-gray-400 items-center gap-1">
                &mdash;
                <UIcon name="i-lucide-triangle-alert" class="size-3 shrink-0" />
                AI-generated, verify suggestions before applying
              </span>
            </div>
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

        <div class="space-y-3 mt-3">
          <!-- Running indicator (before result arrives) -->
          <div
            v-if="diagnosis?.status === 'running' && !isStale(diagnosis)"
            class="flex items-center gap-2 p-4 text-sm text-gray-500 border border-default rounded-lg"
          >
            <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
            <span>Analyzing failure cluster…</span>
          </div>

          <!-- Failed / stale -->
          <UAlert
            v-if="diagnosis && (diagnosis.status === 'failed' || isStale(diagnosis))"
            color="error"
            title="Diagnosis failed"
            :description="diagnosis.error || 'Unknown error'"
          />

          <!-- Completed -->
          <div
            v-if="diagnosis && diagnosis.status === 'completed'"
            class="space-y-3 rounded-lg border border-default p-4 bg-elevated/30"
          >
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

            <p v-if="diagnosis.summary" class="text-sm font-medium">
              {{ diagnosis.summary }}
            </p>

            <p v-if="diagnosis.rootCause" class="text-sm text-gray-600 dark:text-gray-400">
              {{ diagnosis.rootCause }}
            </p>

            <ul v-if="details?.evidence?.length" class="list-disc list-inside space-y-1">
              <li v-for="(e, i) in details.evidence" :key="i" class="text-sm text-gray-600 dark:text-gray-400">
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
              <code v-if="details.suggestedFix.file && !details.suggestedFix.patch" class="block text-xs font-mono mt-1 text-primary">{{ details.suggestedFix.file }}</code>

              <!-- Patch (preferred): diff-highlighted via MarkdownPreview -->
              <div v-if="details.suggestedFix.patch" class="mt-2">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-xs text-gray-500 font-mono">patch — apply with <code class="bg-muted px-1 rounded">git apply</code></span>
                  <UButton
                    icon="i-lucide-copy"
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    title="Copy patch"
                    @click="copyToClipboard(details.suggestedFix.patch)"
                  />
                </div>
                <MarkdownPreview :text="'```diff\n' + details.suggestedFix.patch + '\n```'" />
              </div>

              <!-- Fallback: plain code snippet when no patch -->
              <div v-else-if="details.suggestedFix.code" class="relative mt-2">
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

            <div class="text-xs text-gray-400 pt-1 border-t border-default">
              {{ diagnosis.model }} · {{ formatTokens(diagnosis.inputTokens, diagnosis.outputTokens) }} · {{ formatRelativeTime(diagnosis.updatedAt) }}
            </div>
          </div>

          <!-- Placeholder when no diagnosis yet -->
          <div
            v-if="!diagnosis"
            class="flex flex-col items-center justify-center p-8 text-center text-gray-400 border border-dashed border-default rounded-lg"
          >
            <UIcon name="i-lucide-sparkles" class="size-8 mb-2 opacity-30" />
            <p class="text-sm">
              Diagnosis will appear here
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <CommitBrowserModal
    v-model:open="commitBrowserOpen"
    :cluster-id="clusterId"
    :initial-selected="selectedCommitShas"
    @confirm="selectedCommitShas = $event"
  />
</template>
